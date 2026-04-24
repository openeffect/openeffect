"""HTTP-level tests for POST /api/effects/install (URL) and
POST /api/effects/install/upload (ZIP). install_service is mocked so
these exercise FastAPI's body-parsing path, not the real install work —
regression guard against mixing a Pydantic body with UploadFile on one
handler, which silently dropped JSON requests to `body = None`."""
import asyncio
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from db.database import Database, init_db
from routes import register_routes
from services.effect_loader import EffectLoaderService


@pytest.fixture
def client(tmp_path):
    db_path = tmp_path / "test.db"
    asyncio.run(init_db(db_path))
    database = Database(db_path)

    install_service = MagicMock()
    install_service.install_from_url = AsyncMock(return_value=["me/hello"])
    install_service.install_from_archive = AsyncMock(return_value=["me/hello"])

    effect_loader = MagicMock(spec=EffectLoaderService)
    effect_loader.reload = AsyncMock()

    @asynccontextmanager
    async def _lifespan(app: FastAPI):
        await database.connect()
        app.state.database = database
        app.state.install_service = install_service
        app.state.effect_loader = effect_loader
        app.state.config_service = MagicMock(get_api_key=AsyncMock(return_value="k"))
        app.state.settings = MagicMock()
        app.state.storage_service = MagicMock()
        app.state.history_service = MagicMock()
        app.state.model_service = MagicMock()
        app.state.run_service = MagicMock()
        yield
        await database.close()

    app = FastAPI(lifespan=_lifespan)
    register_routes(app)
    with TestClient(app) as c:
        yield c, install_service


class TestInstallFromUrl:
    def test_json_body_routes_to_install_from_url(self, client):
        c, svc = client
        resp = c.post("/api/effects/install", json={"url": "https://example.com/m.yaml"})
        assert resp.status_code == 200
        assert resp.json() == {"installed": ["me/hello"]}
        svc.install_from_url.assert_awaited_once_with("https://example.com/m.yaml", overwrite=False)
        svc.install_from_archive.assert_not_awaited()

    def test_overwrite_query_param_forwarded(self, client):
        c, svc = client
        resp = c.post("/api/effects/install?overwrite=true", json={"url": "https://example.com/m.yaml"})
        assert resp.status_code == 200
        svc.install_from_url.assert_awaited_once_with("https://example.com/m.yaml", overwrite=True)

    def test_missing_body_returns_422(self, client):
        c, _ = client
        resp = c.post("/api/effects/install")
        assert resp.status_code == 422

    def test_body_without_url_returns_422(self, client):
        c, _ = client
        resp = c.post("/api/effects/install", json={})
        assert resp.status_code == 422


class TestInstallFromUpload:
    def test_multipart_file_routes_to_install_from_archive(self, client):
        c, svc = client
        resp = c.post(
            "/api/effects/install/upload",
            files={"file": ("e.zip", b"PK\x03\x04fake", "application/zip")},
        )
        assert resp.status_code == 200
        svc.install_from_archive.assert_awaited_once()
        svc.install_from_url.assert_not_awaited()

    def test_missing_file_returns_422(self, client):
        c, _ = client
        resp = c.post("/api/effects/install/upload")
        assert resp.status_code == 422
