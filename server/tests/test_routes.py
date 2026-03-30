"""Integration tests for API routes using FastAPI TestClient."""
import asyncio
import io
import json
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


@pytest.fixture
def client(tmp_path):
    """Create a test FastAPI app with all services wired to tmp_path."""
    db_path = tmp_path / "test.db"
    config_path = tmp_path / "config.json"
    tmp_dir = tmp_path / "tmp"
    tmp_dir.mkdir()
    effects_dir = tmp_path / "effects"
    effects_dir.mkdir()
    models_dir = tmp_path / "models"
    models_dir.mkdir()

    # Initialize DB synchronously via asyncio.run
    asyncio.run(init_db(db_path))

    app = FastAPI(title="OpenEffect", version="0.1.0")
    register_routes(app)

    # Build services with test paths
    config_service = ConfigService(config_path)
    effect_loader = EffectLoaderService(effects_dir)
    asyncio.run(effect_loader.load_all())
    storage_service = StorageService(tmp_dir)
    history_service = HistoryService(db_path)
    model_service = ModelService(models_dir)

    # Mock settings with minimal attributes needed by the config route
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

    # Cleanup
    asyncio.run(history_service.close())


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
        assert "default_model" in data
        assert "theme" in data
        assert "history_limit" in data

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


class TestHistoryRoute:
    def test_history_empty_on_start(self, client):
        resp = client.get("/api/history")
        assert resp.status_code == 200
        data = resp.json()
        assert data == {"items": [], "total": 0, "active_count": 0}

    def test_history_respects_limit_and_offset_params(self, client):
        resp = client.get("/api/history?limit=10&offset=0")
        assert resp.status_code == 200
        data = resp.json()
        assert data["items"] == []

    def test_delete_nonexistent_history_returns_404(self, client):
        resp = client.delete("/api/history/nonexistent-id-12345")
        assert resp.status_code == 404
        data = resp.json()
        assert data["detail"]["code"] == "NOT_FOUND"


class TestUploadRoute:
    def _make_image_bytes(self, size: int = 100) -> bytes:
        """Create minimal valid PNG-like bytes for testing."""
        return b"\x89PNG\r\n\x1a\n" + b"\x00" * size

    def test_upload_valid_image(self, client):
        content = self._make_image_bytes()
        resp = client.post(
            "/api/upload",
            files={"file": ("test_image.png", io.BytesIO(content), "image/png")},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "ref_id" in data
        assert data["filename"] == "test_image.png"
        assert data["mime_type"] == "image/png"
        assert data["size_bytes"] == len(content)

    def test_upload_returns_uuid_ref_id(self, client):
        content = self._make_image_bytes()
        resp = client.post(
            "/api/upload",
            files={"file": ("photo.jpg", io.BytesIO(content), "image/jpeg")},
        )
        data = resp.json()
        ref_id = data["ref_id"]
        # Should be a valid UUID format (8-4-4-4-12 hex)
        parts = ref_id.split("-")
        assert len(parts) == 5

    def test_upload_unsupported_type_returns_415(self, client):
        resp = client.post(
            "/api/upload",
            files={"file": ("doc.pdf", io.BytesIO(b"fake pdf"), "application/pdf")},
        )
        assert resp.status_code == 415
        data = resp.json()
        assert data["detail"]["code"] == "UNSUPPORTED_TYPE"

    def test_upload_jpeg_accepted(self, client):
        content = self._make_image_bytes()
        resp = client.post(
            "/api/upload",
            files={"file": ("photo.jpg", io.BytesIO(content), "image/jpeg")},
        )
        assert resp.status_code == 200

    def test_upload_webp_accepted(self, client):
        content = self._make_image_bytes()
        resp = client.post(
            "/api/upload",
            files={"file": ("photo.webp", io.BytesIO(content), "image/webp")},
        )
        assert resp.status_code == 200

    def test_upload_gif_accepted(self, client):
        content = self._make_image_bytes()
        resp = client.post(
            "/api/upload",
            files={"file": ("anim.gif", io.BytesIO(content), "image/gif")},
        )
        assert resp.status_code == 200

    def test_upload_mp4_accepted(self, client):
        content = b"\x00" * 200
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

    def test_upload_preserves_extension(self, client):
        content = self._make_image_bytes()
        resp = client.post(
            "/api/upload",
            files={"file": ("image.webp", io.BytesIO(content), "image/webp")},
        )
        data = resp.json()
        assert data["filename"] == "image.webp"

    def test_upload_no_file_returns_422(self, client):
        resp = client.post("/api/upload")
        assert resp.status_code == 422
