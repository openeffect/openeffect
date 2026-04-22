"""Security-focused tests for the upload endpoint."""
import asyncio
import io
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from config.config_service import ConfigService
from core.limits import MAX_IMAGE_SIZE
from db.database import Database, init_db
from routes import register_routes
from services.effect_loader import EffectLoaderService
from services.history_service import HistoryService
from services.install_service import InstallService
from services.model_service import ModelService
from services.storage_service import StorageService


@pytest.fixture
def storage_dir(tmp_path):
    """Return the uploads storage directory for inspecting saved files."""
    d = tmp_path / "uploads"
    d.mkdir()
    return d


@pytest.fixture
def client(tmp_path, storage_dir):
    """Build a test app; the Database connection opens inside TestClient's
    loop via lifespan so aiosqlite's loop-bound connection doesn't cross
    loops."""
    db_path = tmp_path / "test.db"
    effects_dir = tmp_path / "effects"
    effects_dir.mkdir()
    models_dir = tmp_path / "models"
    models_dir.mkdir()

    asyncio.run(init_db(db_path))
    database = Database(db_path)

    @asynccontextmanager
    async def _lifespan(app: FastAPI):
        await database.connect()

        install_service = InstallService(database, effects_dir)
        effect_loader = EffectLoaderService(install_service)
        await effect_loader.load_all()

        app.state.settings = MagicMock(update_version="")
        app.state.config_service = ConfigService(database)
        app.state.install_service = install_service
        app.state.effect_loader = effect_loader
        app.state.run_service = MagicMock()
        app.state.history_service = HistoryService(database)
        app.state.model_service = ModelService(models_dir)
        app.state.storage_service = StorageService(storage_dir, database)

        yield
        await database.close()

    app = FastAPI(title="OpenEffect", version="0.1.0", lifespan=_lifespan)
    register_routes(app)

    with TestClient(app) as c:
        yield c


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
        resp = client.get("/api/uploads/../../../etc/passwd/512")
        assert resp.status_code in (400, 404)

    def test_serve_backslash_traversal_rejected(self, client):
        """GET /api/uploads/ with backslash traversal should be rejected."""
        resp = client.get("/api/uploads/..\\..\\etc\\passwd/512")
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


_PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


class TestContentTypeValidation:
    def test_wrong_content_type_header_rejected(self, client):
        """File claims image/jpeg but ships plain text — rejected by the
        magic-byte sniff."""
        text_content = b"This is definitely not a JPEG image at all."
        resp = client.post(
            "/api/upload",
            files={"file": ("fake.jpg", io.BytesIO(text_content), "image/jpeg")},
        )
        assert resp.status_code == 415
        assert resp.json()["detail"]["code"] == "UNSUPPORTED_TYPE"

    # An empty-content-type guard lives in the handler, but httpx always
    # fills one in from the filename extension — so exercising that branch
    # end-to-end through TestClient isn't reachable. The intent is still
    # covered by `test_wrong_content_type_header_rejected` above.

class TestFileSizeLimits:
    def test_image_at_exact_cap_accepted(self, client):
        """An image exactly at MAX_IMAGE_SIZE is accepted. Prepend PNG
        magic so the sniffer doesn't reject before we hit the size
        check."""
        content = _PNG_MAGIC + b"\x00" * (MAX_IMAGE_SIZE - len(_PNG_MAGIC))
        resp = client.post(
            "/api/upload",
            files={"file": ("big.png", io.BytesIO(content), "image/png")},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["size_bytes"] == MAX_IMAGE_SIZE

    def test_image_one_byte_over_cap_rejected(self, client):
        """An image one byte over MAX_IMAGE_SIZE is rejected with 413."""
        content = _PNG_MAGIC + b"\x00" * (MAX_IMAGE_SIZE - len(_PNG_MAGIC) + 1)
        resp = client.post(
            "/api/upload",
            files={"file": ("toobig.png", io.BytesIO(content), "image/png")},
        )
        assert resp.status_code == 413
        assert resp.json()["detail"]["code"] == "FILE_TOO_LARGE"

    def test_video_larger_than_image_cap_accepted(self, client):
        """Videos get their own (higher) cap. A payload that would be
        rejected as an image is fine as a video."""
        # MP4 magic at offset 4 + filler just over the image cap
        content = b"\x00\x00\x00\x20ftypisom" + b"\x00" * (MAX_IMAGE_SIZE + 1024)
        resp = client.post(
            "/api/upload",
            files={"file": ("clip.mp4", io.BytesIO(content), "video/mp4")},
        )
        assert resp.status_code == 200

    def test_empty_file_rejected(self, client):
        """A zero-byte file can't carry a magic signature — rejected by the
        sniffer rather than accepted-at-zero-size."""
        resp = client.post(
            "/api/upload",
            files={"file": ("empty.png", io.BytesIO(b""), "image/png")},
        )
        assert resp.status_code == 415
        assert resp.json()["detail"]["code"] == "UNSUPPORTED_TYPE"
