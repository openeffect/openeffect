"""Security-focused tests for the upload endpoint."""
import io
import asyncio
import pytest
from pathlib import Path
from unittest.mock import MagicMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from routes import register_routes
from config.config_service import ConfigService
from services.effect_loader import EffectLoaderService
from services.history_service import HistoryService
from services.storage_service import StorageService
from services.model_service import ModelService
from db.database import init_db
from routes.uploads import MAX_SIZE


@pytest.fixture
def storage_dir(tmp_path):
    """Return the uploads storage directory for inspecting saved files."""
    d = tmp_path / "uploads"
    d.mkdir()
    return d


@pytest.fixture
def client(tmp_path, storage_dir):
    """Create a test app with storage pointing at tmp_path."""
    db_path = tmp_path / "test.db"
    config_path = tmp_path / "config.json"
    effects_dir = tmp_path / "effects"
    effects_dir.mkdir()
    models_dir = tmp_path / "models"
    models_dir.mkdir()

    asyncio.run(init_db(db_path))

    app = FastAPI(title="OpenEffect", version="0.1.0")
    register_routes(app)

    config_service = ConfigService(config_path)
    effect_loader = EffectLoaderService(effects_dir)
    asyncio.run(effect_loader.load_all())
    storage_service = StorageService(storage_dir, db_path)
    history_service = HistoryService(db_path)
    model_service = ModelService(models_dir)

    settings = MagicMock()
    settings.update_version = ""

    app.state.settings = settings
    app.state.config_service = config_service
    app.state.effect_loader = effect_loader
    app.state.generation_service = MagicMock()
    app.state.history_service = history_service
    app.state.model_service = model_service
    app.state.storage_service = storage_service

    with TestClient(app) as c:
        yield c

    asyncio.run(history_service.close())


class TestPathTraversal:
    def test_traversal_filename_stays_in_uploads(self, client, storage_dir):
        """A filename like ../../../etc/passwd must not write outside the storage dir."""
        content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 50
        resp = client.post(
            "/api/upload",
            files={"file": ("../../../etc/passwd", io.BytesIO(content), "image/png")},
        )
        # The upload should either succeed safely or reject the filename.
        # If it succeeds, the file must be inside storage_dir.
        if resp.status_code == 200:
            # Verify no file was created outside storage_dir
            assert not Path("/etc/passwd").exists() or Path("/etc/passwd").stat().st_size != len(content)
            # All files in storage_dir should be hash-based, not the traversal filename
            saved_files = [f for f in storage_dir.iterdir() if not f.name.endswith(".tmp")]
            for f in saved_files:
                assert ".." not in f.name

    def test_traversal_with_backslashes(self, client, storage_dir):
        """Windows-style path traversal should also be safe."""
        content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 50
        resp = client.post(
            "/api/upload",
            files={"file": ("..\\..\\..\\etc\\passwd", io.BytesIO(content), "image/png")},
        )
        if resp.status_code == 200:
            saved_files = [f for f in storage_dir.iterdir() if not f.name.endswith(".tmp")]
            for f in saved_files:
                resolved = f.resolve()
                assert str(resolved).startswith(str(storage_dir.resolve()))

    def test_serve_path_traversal_rejected(self, client):
        """GET /api/uploads/ with traversal components should be rejected."""
        resp = client.get("/api/uploads/../../../etc/passwd")
        assert resp.status_code in (400, 404)

    def test_serve_backslash_traversal_rejected(self, client):
        """GET /api/uploads/ with backslash traversal should be rejected."""
        resp = client.get("/api/uploads/..\\..\\etc\\passwd")
        assert resp.status_code in (400, 404)


class TestMaliciousFilenames:
    def test_null_byte_in_filename(self, client, storage_dir):
        """Null bytes in filenames should not cause crashes."""
        content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 50
        resp = client.post(
            "/api/upload",
            files={"file": ("image\x00.png", io.BytesIO(content), "image/png")},
        )
        # Should either succeed safely or reject
        assert resp.status_code in (200, 400, 415, 422)
        if resp.status_code == 200:
            saved_files = [f for f in storage_dir.iterdir() if not f.name.endswith(".tmp")]
            for f in saved_files:
                assert "\x00" not in f.name

    def test_empty_filename(self, client, storage_dir):
        """An empty filename should still produce a valid ref_id."""
        content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 50
        resp = client.post(
            "/api/upload",
            files={"file": ("", io.BytesIO(content), "image/png")},
        )
        # The upload handler should handle empty filenames gracefully
        if resp.status_code == 200:
            data = resp.json()
            assert "ref_id" in data
            assert len(data["ref_id"]) > 0
            # ref_id should be a hash filename
            assert "." in data["ref_id"]

    def test_very_long_filename(self, client, storage_dir):
        """A 1000-char filename should not crash the server."""
        long_name = "a" * 995 + ".png"
        content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 50
        resp = client.post(
            "/api/upload",
            files={"file": (long_name, io.BytesIO(content), "image/png")},
        )
        # Should either succeed (using hash-based storage name) or reject gracefully
        assert resp.status_code in (200, 400, 413, 422)
        if resp.status_code == 200:
            data = resp.json()
            # The stored filename is hash-based, so storage should be fine
            assert "ref_id" in data
            saved_files = [f for f in storage_dir.iterdir() if not f.name.endswith(".tmp")]
            for f in saved_files:
                # Stored name should be hash-based, not the original long name
                assert len(f.name) < 200

    def test_filename_with_special_chars(self, client, storage_dir):
        """Filenames with special characters should be handled safely."""
        content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 50
        resp = client.post(
            "/api/upload",
            files={"file": ("img;rm -rf /.png", io.BytesIO(content), "image/png")},
        )
        if resp.status_code == 200:
            data = resp.json()
            assert "ref_id" in data


class TestContentTypeValidation:
    def test_wrong_content_type_header(self, client):
        """File claims image/jpeg but is actually plain text."""
        text_content = b"This is definitely not a JPEG image at all."
        resp = client.post(
            "/api/upload",
            files={"file": ("fake.jpg", io.BytesIO(text_content), "image/jpeg")},
        )
        # The current implementation only checks content_type header, not magic bytes.
        # This test documents the behavior: the server trusts the content-type.
        assert resp.status_code == 200

    def test_no_content_type_accepted(self, client):
        """Upload with no content_type should not be rejected as unsupported."""
        content = b"\x89PNG\r\n\x1a\n" + b"\x00" * 50
        resp = client.post(
            "/api/upload",
            files={"file": ("image.png", io.BytesIO(content), None)},
        )
        # When content_type is None/empty, the check `if file.content_type and ...`
        # skips validation, so the upload proceeds.
        assert resp.status_code == 200


class TestFileSizeLimits:
    def test_file_at_exact_max_size_accepted(self, client):
        """A file exactly at MAX_SIZE should be accepted."""
        content = b"\x00" * MAX_SIZE
        resp = client.post(
            "/api/upload",
            files={"file": ("big.png", io.BytesIO(content), "image/png")},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["size_bytes"] == MAX_SIZE

    def test_file_one_byte_over_max_rejected(self, client):
        """A file one byte over MAX_SIZE should be rejected with 413."""
        content = b"\x00" * (MAX_SIZE + 1)
        resp = client.post(
            "/api/upload",
            files={"file": ("toobig.png", io.BytesIO(content), "image/png")},
        )
        assert resp.status_code == 413
        data = resp.json()
        assert data["detail"]["code"] == "FILE_TOO_LARGE"

    def test_empty_file_accepted(self, client):
        """A zero-byte file should be accepted (not over the limit)."""
        resp = client.post(
            "/api/upload",
            files={"file": ("empty.png", io.BytesIO(b""), "image/png")},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["size_bytes"] == 0
