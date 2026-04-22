"""Integration tests for API routes using FastAPI TestClient."""
import asyncio
import io
from contextlib import asynccontextmanager
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from config.config_service import ConfigService
from db.database import Database, init_db
from routes import register_routes
from services.effect_loader import EffectLoaderService
from services.history_service import HistoryService
from services.install_service import InstallService
from services.model_service import ModelService
from services.storage_service import StorageService


@pytest.fixture
def client(tmp_path):
    """Build a test FastAPI app whose Database is opened inside the TestClient
    event loop (via a test lifespan) so aiosqlite's loop-bound connection
    doesn't try to cross loops."""
    db_path = tmp_path / "test.db"
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir()
    effects_dir = tmp_path / "effects"
    effects_dir.mkdir()
    models_dir = tmp_path / "models"
    models_dir.mkdir()

    # Schema creation is one-shot; run it on a throwaway loop before TestClient starts
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
        app.state.storage_service = StorageService(uploads_dir, database)

        yield
        await database.close()

    app = FastAPI(title="OpenEffect", version="0.1.0", lifespan=_lifespan)
    register_routes(app)

    with TestClient(app) as c:
        yield c


class TestHealthRoute:
    def test_health_returns_ok(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data == {"status": "ok", "version": "0.1.0"}

    def test_health_content_type(self, client):
        resp = client.get("/api/health")
        assert "application/json" in resp.headers["content-type"]


class TestEffectsRoute:
    def test_effects_returns_list(self, client):
        resp = client.get("/api/effects")
        assert resp.status_code == 200
        data = resp.json()
        assert "effects" in data
        assert isinstance(data["effects"], list)

    def test_effects_empty_when_no_effects_dir(self, client):
        resp = client.get("/api/effects")
        data = resp.json()
        assert data["effects"] == []

    def test_get_nonexistent_effect_returns_404(self, client):
        resp = client.get("/api/effects/single-image/nonexistent")
        assert resp.status_code == 404


class TestConfigRoute:
    def test_get_config_has_expected_fields(self, client):
        resp = client.get("/api/config")
        assert resp.status_code == 200
        data = resp.json()
        assert "has_api_key" in data
        assert isinstance(data["has_api_key"], bool)
        assert "theme" in data
        assert "keyring_available" in data
        assert isinstance(data["keyring_available"], bool)
        # Dropped surface: these fields no longer exist
        assert "default_model" not in data
        assert "history_limit" not in data

    def test_get_config_never_exposes_api_key(self, client):
        resp = client.get("/api/config")
        data = resp.json()
        assert "fal_api_key" not in data

    def test_get_config_has_api_key_false_by_default(self, client):
        resp = client.get("/api/config")
        data = resp.json()
        assert data["has_api_key"] is False

    def test_get_config_includes_available_models(self, client):
        resp = client.get("/api/config")
        data = resp.json()
        assert "available_models" in data
        assert isinstance(data["available_models"], list)

    def test_patch_config_persists_theme(self, client):
        resp = client.patch("/api/config", json={"theme": "light"})
        assert resp.status_code == 200
        data = resp.json()
        assert data["theme"] == "light"

        # Verify persistence via GET
        resp2 = client.get("/api/config")
        assert resp2.json()["theme"] == "light"

    def test_patch_config_returns_public_config(self, client):
        resp = client.patch("/api/config", json={"fal_api_key": "test_key_123"})
        assert resp.status_code == 200
        data = resp.json()
        # Should return public config, not the raw key
        assert "fal_api_key" not in data
        assert data["has_api_key"] is True


class TestRunsRoute:
    def test_runs_empty_on_start(self, client):
        resp = client.get("/api/runs")
        assert resp.status_code == 200
        data = resp.json()
        assert data == {"items": [], "total": 0, "active_count": 0}

    def test_runs_respects_limit_and_offset_params(self, client):
        resp = client.get("/api/runs?limit=10&offset=0")
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []

    def test_runs_supports_effect_id_filter(self, client):
        resp = client.get("/api/runs?effect_id=openeffect/hdr")
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []

    def test_delete_nonexistent_run_returns_404(self, client):
        resp = client.delete("/api/runs/nonexistent-id-12345")
        assert resp.status_code == 404
        data = resp.json()
        assert data["detail"]["code"] == "NOT_FOUND"

    def test_get_nonexistent_run_returns_404(self, client):
        resp = client.get("/api/runs/nonexistent-id-12345")
        assert resp.status_code == 404
        data = resp.json()
        assert data["detail"]["code"] == "NOT_FOUND"


_MAGIC: dict[str, bytes] = {
    "image/png":  b"\x89PNG\r\n\x1a\n",
    "image/jpeg": b"\xff\xd8\xff\xe0",
    "image/gif":  b"GIF89a",
    "image/webp": b"RIFF\x00\x00\x00\x00WEBP",
    "video/mp4":  b"\x00\x00\x00\x20ftypisom",
    "video/webm": b"\x1a\x45\xdf\xa3",
}


def _bytes_for(content_type: str, size: int = 100) -> bytes:
    """Magic-byte prefix matching `content_type` + `size` filler bytes.
    Uploads without a matching signature are rejected by the sniffer."""
    return _MAGIC[content_type] + b"\x00" * size


class TestUploadRoute:
    def _make_image_bytes(self, size: int = 100) -> bytes:
        """Create minimal valid PNG-like bytes for testing."""
        return _bytes_for("image/png", size)

    def test_upload_valid_image(self, client):
        content = self._make_image_bytes()
        resp = client.post(
            "/api/upload",
            files={"file": ("test_image.png", io.BytesIO(content), "image/png")},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "ref_id" in data
        # ref_id is a UUID
        assert "-" in data["ref_id"]
        assert data["filename"] == "test_image.png"
        assert data["mime_type"] == "image/png"
        assert data["size_bytes"] == len(content)
        assert data["thumbnails"]["512"].endswith("/512.png")
        assert data["thumbnails"]["2048"].endswith("/2048.png")

    def test_upload_returns_uuid_ref_id(self, client):
        content = _bytes_for("image/jpeg")
        resp = client.post(
            "/api/upload",
            files={"file": ("photo.jpg", io.BytesIO(content), "image/jpeg")},
        )
        data = resp.json()
        ref_id = data["ref_id"]
        # Should be a UUID like "a1b2c3d4-e5f6-7890-abcd-1234567890ab"
        parts = ref_id.split("-")
        assert len(parts) == 5

    def test_upload_deduplication(self, client):
        """Uploading the same content twice should return the same ref_id."""
        content = self._make_image_bytes(200)
        resp1 = client.post(
            "/api/upload",
            files={"file": ("first.png", io.BytesIO(content), "image/png")},
        )
        resp2 = client.post(
            "/api/upload",
            files={"file": ("second.png", io.BytesIO(content), "image/png")},
        )
        assert resp1.status_code == 200
        assert resp2.status_code == 200
        # Same content = same hash = same ref_id
        assert resp1.json()["ref_id"] == resp2.json()["ref_id"]
        # But original filenames differ
        assert resp1.json()["filename"] == "first.png"
        assert resp2.json()["filename"] == "second.png"

    def test_upload_unsupported_type_returns_415(self, client):
        resp = client.post(
            "/api/upload",
            files={"file": ("doc.pdf", io.BytesIO(b"fake pdf"), "application/pdf")},
        )
        assert resp.status_code == 415
        data = resp.json()
        assert data["detail"]["code"] == "UNSUPPORTED_TYPE"

    def test_upload_jpeg_accepted(self, client):
        content = _bytes_for("image/jpeg")
        resp = client.post(
            "/api/upload",
            files={"file": ("photo.jpg", io.BytesIO(content), "image/jpeg")},
        )
        assert resp.status_code == 200

    def test_upload_webp_accepted(self, client):
        content = _bytes_for("image/webp")
        resp = client.post(
            "/api/upload",
            files={"file": ("photo.webp", io.BytesIO(content), "image/webp")},
        )
        assert resp.status_code == 200

    def test_upload_gif_accepted(self, client):
        content = _bytes_for("image/gif")
        resp = client.post(
            "/api/upload",
            files={"file": ("anim.gif", io.BytesIO(content), "image/gif")},
        )
        assert resp.status_code == 200

    def test_upload_mp4_accepted(self, client):
        content = _bytes_for("video/mp4")
        resp = client.post(
            "/api/upload",
            files={"file": ("video.mp4", io.BytesIO(content), "video/mp4")},
        )
        assert resp.status_code == 200

    def test_upload_text_plain_rejected(self, client):
        resp = client.post(
            "/api/upload",
            files={"file": ("notes.txt", io.BytesIO(b"hello"), "text/plain")},
        )
        assert resp.status_code == 415

    def test_upload_preserves_filename(self, client):
        content = _bytes_for("image/webp")
        resp = client.post(
            "/api/upload",
            files={"file": ("image.webp", io.BytesIO(content), "image/webp")},
        )
        data = resp.json()
        assert data["filename"] == "image.webp"

    def test_upload_no_file_returns_422(self, client):
        resp = client.post("/api/upload")
        assert resp.status_code == 422

    def test_serve_uploaded_file(self, client):
        """Uploaded files should be retrievable via GET /api/uploads/{uuid}/{variant}."""
        content = self._make_image_bytes(150)
        resp = client.post(
            "/api/upload",
            files={"file": ("serve_test.png", io.BytesIO(content), "image/png")},
        )
        assert resp.status_code == 200
        ref_id = resp.json()["ref_id"]

        # Fetch the preview variant
        resp2 = client.get(f"/api/uploads/{ref_id}/512")
        assert resp2.status_code == 200

    def test_serve_nonexistent_file_returns_404(self, client):
        resp = client.get("/api/uploads/nonexistent-uuid/512")
        assert resp.status_code == 404

    def test_serve_path_traversal_rejected(self, client):
        resp = client.get("/api/uploads/../../etc/passwd/512")
        assert resp.status_code in (400, 404)
