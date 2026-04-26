"""HTTP-level tests for /api/run and /api/playground/run.

A stub `ModelProviderFactory.create` returns a `FakeProvider` whose event
stream is set per-test, so we can exercise the route shape without touching
fal.ai.
"""
import asyncio
import time
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from db.database import Database, init_db
from effects.validator import EffectManifest, GenerationConfig, InputFieldSchema
from providers.base import ProviderEvent
from routes import register_routes
from services.effect_loader import EffectLoaderService, LoadedEffect
from services.file_service import FileService
from services.history_service import HistoryService
from services.install_service import InstallService
from services.model_service import ModelService
from services.run_service import RunService


class FakeProvider:
    """Canned provider used by these tests. Put events on the class attr
    `next_events`; instances yield them verbatim from `generate()`."""
    next_events: list[ProviderEvent] = []

    def __init__(self, *_, **__):
        pass

    async def generate(self, _input):
        for e in FakeProvider.next_events:
            yield e


def _make_manifest() -> EffectManifest:
    return EffectManifest.model_validate({
        "manifest_version": 1,
        "id": "openeffect/hdr",
        "name": "HDR",
        "description": "Test",
        "category": "animation",
        "inputs": {
            # EffectManifest's validator requires a start_frame image input
            "image": InputFieldSchema(
                type="image", role="start_frame", required=True, label="Photo",
            ),
            "prompt": InputFieldSchema(
                type="text", required=True,
                label="Prompt", multiline=False, max_length=500,
            ),
        },
        "generation": GenerationConfig(prompt="Make {{ prompt }}"),
    })


@pytest.fixture
def client(tmp_path):
    """Build a test app with a preloaded effect (no install round-trip) and
    FakeProvider wired in for anything the route triggers."""
    db_path = tmp_path / "test.db"
    files_dir = tmp_path / "files"
    files_dir.mkdir()
    models_dir = tmp_path / "models"
    models_dir.mkdir()

    asyncio.run(init_db(db_path))
    database = Database(db_path)

    manifest = _make_manifest()
    loaded = LoadedEffect(
        manifest=manifest,
        id="test-uuid-001",
        full_id="openeffect/hdr",
        source="official",
    )

    def _by_id(effect_id):
        return loaded if effect_id == "test-uuid-001" else None

    def _by_full(full_id):
        return loaded if full_id in ("test-uuid-001", "openeffect/hdr") else None

    effect_loader = MagicMock(spec=EffectLoaderService)
    effect_loader.get_by_id.side_effect = _by_id
    effect_loader.get_loaded.side_effect = _by_full

    # config_service is used via `await config.get_api_key()` now — AsyncMock
    # so the coroutine form works.
    config_service = MagicMock()
    config_service.get_api_key = AsyncMock(return_value="test-key")

    @asynccontextmanager
    async def _lifespan(app: FastAPI):
        await database.connect()

        file_service = FileService(files_dir, database)
        install_service = InstallService(database, file_service)
        history_service = HistoryService(database)
        model_service = ModelService(models_dir)

        app.state.settings = MagicMock(update_version="", user_data_dir=tmp_path)
        app.state.database = database
        app.state.config_service = config_service
        app.state.install_service = install_service
        app.state.effect_loader = effect_loader
        app.state.file_service = file_service
        app.state.history_service = history_service
        app.state.model_service = model_service
        app.state.run_service = RunService(
            effect_loader=effect_loader,
            config_service=config_service,
            history_service=history_service,
            file_service=file_service,
            model_service=model_service,
        )
        yield
        await database.close()

    app = FastAPI(lifespan=_lifespan)
    register_routes(app)

    # Any ModelProviderFactory.create call — on either the effect or
    # playground path — returns a FakeProvider.
    with patch(
        "services.run_service.ModelProviderFactory.create",
        side_effect=lambda *a, **kw: FakeProvider(),
    ):
        with TestClient(app) as c:
            yield c


def _wait_for_record(client, job_id: str, statuses=("completed", "failed"), timeout=2.0):
    """Poll the DB-backed `/api/runs/{id}` until the record settles into one
    of `statuses` or we give up. Background tasks may finish before or after
    the POST returns, so tests that care about final state poll here."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = client.get(f"/api/runs/{job_id}")
        if resp.status_code == 200 and resp.json()["status"] in statuses:
            return resp.json()
        time.sleep(0.05)
    return None


# ─── POST /api/run ───────────────────────────────────────────────────────────


class TestStartRun:
    def test_happy_path_returns_job_id_and_record(self, client):
        FakeProvider.next_events = [
            ProviderEvent(type="progress", progress=50, message="Generating..."),
            ProviderEvent(type="completed", video_url=""),
        ]
        resp = client.post("/api/run", json={
            "effect_id": "test-uuid-001",
            "model_id": "wan-2.7",
            "provider_id": "fal",
            "inputs": {"prompt": "a cat"},
            "output": {},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert isinstance(data["job_id"], str) and data["job_id"]
        # Record is created synchronously in `start()`, so even if the
        # background task hasn't run yet, the record exists at processing.
        assert data["record"]["status"] in ("processing", "completed")
        assert data["record"]["model_id"] == "wan-2.7"
        assert data["record"]["effect_name"] == "HDR"

    def test_unknown_effect_returns_422(self, client):
        resp = client.post("/api/run", json={
            "effect_id": "does-not-exist",
            "model_id": "wan-2.7",
            "provider_id": "fal",
            "inputs": {},
            "output": {},
        })
        assert resp.status_code == 422
        body = resp.json()
        assert body["detail"]["code"] == "INVALID_REQUEST"
        assert "Effect not found" in body["detail"]["error"]

    def test_incompatible_model_returns_422(self, client):
        # Inputs satisfy the manifest — we want the model check to fire, not
        # our required-field check (which would shadow it if inputs were empty).
        resp = client.post("/api/run", json={
            "effect_id": "test-uuid-001",
            "model_id": "not-a-real-model",
            "provider_id": "fal",
            "inputs": {"prompt": "a cat"},
            "output": {},
        })
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "INVALID_REQUEST"

    def test_text_exceeds_max_length_returns_422(self, client):
        resp = client.post("/api/run", json={
            "effect_id": "test-uuid-001",
            "model_id": "wan-2.7",
            "provider_id": "fal",
            "inputs": {"prompt": "x" * 501},
            "output": {},
        })
        assert resp.status_code == 422
        body = resp.json()
        assert body["detail"]["code"] == "INVALID_REQUEST"
        assert "at most 500 characters" in body["detail"]["error"]

    def test_missing_required_input_returns_422(self, client):
        resp = client.post("/api/run", json={
            "effect_id": "test-uuid-001",
            "model_id": "wan-2.7",
            "provider_id": "fal",
            "inputs": {},  # 'prompt' is required
            "output": {},
        })
        assert resp.status_code == 422
        body = resp.json()
        assert body["detail"]["code"] == "INVALID_REQUEST"
        assert "Required input 'Prompt'" in body["detail"]["error"]


# ─── POST /api/playground/run ────────────────────────────────────────────────


class TestStartPlaygroundRun:
    def test_happy_path(self, client):
        FakeProvider.next_events = [ProviderEvent(type="completed", video_url="")]
        resp = client.post("/api/playground/run", json={
            "model_id": "wan-2.7",
            "provider_id": "fal",
            "prompt": "make it pop",
            "output": {},
            "user_params": {},
            "image_inputs": {},
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["job_id"]
        assert data["record"]["kind"] == "playground"

    def test_empty_prompt_returns_422(self, client):
        resp = client.post("/api/playground/run", json={
            "model_id": "wan-2.7",
            "provider_id": "fal",
            "prompt": "",
            "output": {},
            "user_params": {},
            "image_inputs": {},
        })
        assert resp.status_code == 422
        body = resp.json()
        assert body["detail"]["code"] == "INVALID_REQUEST"
        assert "Prompt is required" in body["detail"]["error"]

    def test_unknown_model_returns_422(self, client):
        resp = client.post("/api/playground/run", json={
            "model_id": "bogus-model",
            "provider_id": "fal",
            "prompt": "hi",
            "output": {},
            "user_params": {},
            "image_inputs": {},
        })
        assert resp.status_code == 422
        assert resp.json()["detail"]["code"] == "INVALID_REQUEST"


