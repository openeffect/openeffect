"""Integration tests for API routes using FastAPI TestClient."""
import asyncio
import io
from contextlib import asynccontextmanager
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from config.config_service import ConfigService
from db.database import Database, init_db
from routes import register_routes
from services.effect_loader import EffectLoaderService
from services.file_service import FileService
from services.history_service import HistoryService
from services.install_service import InstallService
from services.model_service import ModelService


def _png_bytes(size: tuple[int, int] = (32, 32)) -> bytes:
    img = Image.new("RGB", size, color=(120, 60, 30))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
def client(tmp_path):
    """Build a test FastAPI app whose Database is opened inside the TestClient
    event loop (via a test lifespan) so aiosqlite's loop-bound connection
    doesn't try to cross loops."""
    db_path = tmp_path / "test.db"
    files_dir = tmp_path / "files"
    files_dir.mkdir()
    models_dir = tmp_path / "models"
    models_dir.mkdir()

    # Schema creation is one-shot; run it on a throwaway loop before TestClient starts
    asyncio.run(init_db(db_path))

    database = Database(db_path)

    @asynccontextmanager
    async def _lifespan(app: FastAPI):
        await database.connect()

        file_service = FileService(files_dir, database)
        install_service = InstallService(database, file_service)
        effect_loader = EffectLoaderService(install_service, database)
        await effect_loader.load_all()

        app.state.settings = MagicMock(update_version="")
        app.state.config_service = ConfigService(database)
        app.state.install_service = install_service
        app.state.effect_loader = effect_loader
        app.state.run_service = MagicMock()
        app.state.history_service = HistoryService(database)
        app.state.model_service = ModelService(models_dir)
        app.state.file_service = file_service

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


class TestFilesRoute:
    def test_upload_valid_image(self, client):
        png = _png_bytes()
        resp = client.post(
            "/api/files",
            files={"file": ("test.png", io.BytesIO(png), "image/png")},
        )
        assert resp.status_code == 200
        data = resp.json()
        # FileRef shape: {id, kind, mime, size, url, thumbnails}
        assert "id" in data
        # uuid7-shaped: dashes in the canonical layout
        assert "-" in data["id"]
        # hash is server-internal — never returned to clients
        assert "hash" not in data
        # ext is encoded in `url`, no longer a top-level field
        assert "ext" not in data
        assert data["kind"] == "image"
        assert data["mime"] == "image/png"
        assert data["size"] == len(png)
        assert data["url"] == f"/api/files/{data['id']}/original.png"
        assert data["thumbnails"] == {
            "512":  f"/api/files/{data['id']}/512.webp",
            "1024": f"/api/files/{data['id']}/1024.webp",
        }

    def test_upload_deduplication(self, client):
        """Uploading the same content twice should return the same id —
        the second upload finds the existing row by hash and returns it."""
        png = _png_bytes()
        resp1 = client.post(
            "/api/files",
            files={"file": ("first.png", io.BytesIO(png), "image/png")},
        )
        resp2 = client.post(
            "/api/files",
            files={"file": ("second.png", io.BytesIO(png), "image/png")},
        )
        assert resp1.status_code == 200
        assert resp2.status_code == 200
        assert resp1.json()["id"] == resp2.json()["id"]

    def test_upload_unsupported_type_returns_415(self, client):
        resp = client.post(
            "/api/files",
            files={"file": ("doc.pdf", io.BytesIO(b"fake pdf"), "application/pdf")},
        )
        assert resp.status_code == 415
        data = resp.json()
        assert data["detail"]["code"] == "UNSUPPORTED_TYPE"

    def test_upload_text_plain_rejected(self, client):
        resp = client.post(
            "/api/files",
            files={"file": ("notes.txt", io.BytesIO(b"hello"), "text/plain")},
        )
        assert resp.status_code == 415

    def test_upload_no_file_returns_422(self, client):
        resp = client.post("/api/files")
        assert resp.status_code == 422

    def test_serve_uploaded_file(self, client):
        """Uploaded files should be retrievable via GET /api/files/{id}/{filename}."""
        png = _png_bytes()
        resp = client.post(
            "/api/files",
            files={"file": ("serve.png", io.BytesIO(png), "image/png")},
        )
        assert resp.status_code == 200
        file_id = resp.json()["id"]

        resp2 = client.get(f"/api/files/{file_id}/512.webp")
        assert resp2.status_code == 200

        resp3 = client.get(f"/api/files/{file_id}/original.png")
        assert resp3.status_code == 200

    def test_serve_nonexistent_file_returns_404(self, client):
        resp = client.get("/api/files/nonexistent-id/512.webp")
        assert resp.status_code == 404

    def test_serve_unknown_variant_returns_404(self, client):
        png = _png_bytes()
        resp = client.post(
            "/api/files",
            files={"file": ("v.png", io.BytesIO(png), "image/png")},
        )
        file_id = resp.json()["id"]
        resp2 = client.get(f"/api/files/{file_id}/9999.webp")
        assert resp2.status_code == 404
