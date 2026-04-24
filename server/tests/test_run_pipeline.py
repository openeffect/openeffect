"""Integration tests for the run pipeline with a mocked provider."""
import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from db.database import Database, init_db
from effects.validator import EffectManifest, GenerationConfig, InputFieldSchema
from schemas.run import RunRequest
from services.effect_loader import EffectLoaderService, LoadedEffect
from services.history_service import HistoryService, RunRecord
from services.run_service import RunJob, RunService

# ─── Fixtures ────────────────────────────────────────────────────────────────

def _make_manifest() -> EffectManifest:
    return EffectManifest(
        id="test-effect",
        namespace="test",
        name="Test Effect",
        description="Test",
        type="animation",
        inputs={
            "image": InputFieldSchema(type="image", role="start_frame", required=True, label="Photo"),
            "prompt": InputFieldSchema(
                type="text", role="prompt_input", required=False,
                label="Prompt", multiline=False,
            ),
        },
        generation=GenerationConfig(prompt="Test {{ prompt }}"),
    )


def _make_loaded(manifest: EffectManifest, db_id: str = "test-uuid-001") -> LoadedEffect:
    return LoadedEffect(
        manifest=manifest,
        db_id=db_id,
        full_id=f"{manifest.namespace}/{manifest.id}",
        assets_dir=Path("/tmp/test-assets"),
        source="local",
    )




@pytest.fixture
async def database(tmp_path):
    path = tmp_path / "test.db"
    await init_db(path)
    db = Database(path)
    await db.connect()
    yield db
    await db.close()


@pytest.fixture
async def history(database):
    return HistoryService(database)


@pytest.fixture
def effect_loader():
    manifest = _make_manifest()
    loaded = _make_loaded(manifest)
    loader = MagicMock(spec=EffectLoaderService)
    loader.get_by_db_id.return_value = loaded
    loader.get_loaded.return_value = loaded
    return loader


@pytest.fixture
def storage():
    svc = MagicMock()
    svc.increment_ref = AsyncMock()
    svc.get_upload_path.return_value = Path("/tmp/fake-image.jpg")
    return svc


@pytest.fixture
def model_service():
    return MagicMock()


@pytest.fixture
def config_service():
    svc = MagicMock()
    svc.get_api_key.return_value = "test-key"
    return svc


@pytest.fixture
def run_service(effect_loader, config_service, history, storage, model_service):
    return RunService(
        effect_loader=effect_loader,
        config_service=config_service,
        history_service=history,
        storage_service=storage,
        model_service=model_service,
    )


# ─── Tests ───────────────────────────────────────────────────────────────────

class TestStartRun:
    async def test_creates_job_and_returns_id(self, run_service, history, tmp_path):
        with patch.object(RunRecord, 'run_folder', return_value=tmp_path / "run"):
            job_id = await run_service.start(RunRequest(
                effect_id="test-uuid-001",
                model_id="wan-2.7",
                provider_id="fal",
                inputs={"prompt": "hello"},
                output={},
            ))
        assert job_id is not None
        assert len(job_id) > 0

        # Check DB record was created
        record = await history.get_by_id(job_id)
        assert record is not None
        assert record.status == "processing"
        assert record.effect_name == "Test Effect"

    async def test_stores_inputs_as_structured_json(self, run_service, history, tmp_path):
        with patch.object(RunRecord, 'run_folder', return_value=tmp_path / "run"):
            job_id = await run_service.start(RunRequest(
                effect_id="test-uuid-001",
                model_id="wan-2.7",
                provider_id="fal",
                inputs={"prompt": "city night"},
                output={"duration": 5},
                user_params={"guidance_scale": 3.5},
            ))

        record = await history.get_by_id(job_id)
        data = json.loads(record.inputs)
        # Raw user inputs are stored field-keyed so a form can re-hydrate them
        assert data["inputs"]["prompt"] == "city night"
        assert data["output"]["duration"] == 5
        assert data["user_params"]["guidance_scale"] == 3.5
        # model_inputs holds the normalized, resolved shape (prompt templates expanded)
        assert "model_inputs" in data
        assert data["model_inputs"]["prompt"] == "Test city night"  # template "Test {{ prompt }}" resolved
        assert "negative_prompt" in data["model_inputs"]

    async def test_rejects_unknown_effect(self, run_service):
        run_service._effect_loader.get_by_db_id.return_value = None
        run_service._effect_loader.get_loaded.return_value = None

        with pytest.raises(ValueError, match="Effect not found"):
            await run_service.start(RunRequest(
                effect_id="nonexistent",
                model_id="wan-2.7",
                provider_id="fal",
                inputs={},
                output={},
            ))

    async def test_rejects_incompatible_model(self, run_service):
        # kling-3.0 doesn't support end_frame, but our test manifest only has start_frame
        # so all models are compatible. Let's test with a truly incompatible scenario.
        # Create a manifest with only prompt_input (no image) — all models work.
        # Instead, test with a model ID that doesn't exist at all.
        with pytest.raises(ValueError, match="not compatible"):
            await run_service.start(RunRequest(
                effect_id="test-uuid-001",
                model_id="nonexistent-model",
                provider_id="fal",
                inputs={},
                output={},
            ))

    async def test_increments_ref_count_for_image_inputs(self, run_service, storage, tmp_path):
        with patch.object(RunRecord, 'run_folder', return_value=tmp_path / "run"):
            await run_service.start(RunRequest(
                effect_id="test-uuid-001",
                model_id="wan-2.7",
                provider_id="fal",
                inputs={"image": "ref-123", "prompt": "test"},
                output={},
            ))

        storage.increment_ref.assert_called_once_with("ref-123")


class TestBroadcast:
    """The multiplexed /api/runs/stream endpoint fans out via _broadcast.
    Verify every registered subscriber sees every event."""

    async def test_two_subscribers_receive_same_event(self, run_service):
        # Register two consumers, emit one broadcast, drain one event from each.
        queue_a = asyncio.Queue[dict]()
        queue_b = asyncio.Queue[dict]()
        run_service._broadcast_queues.add(queue_a)
        run_service._broadcast_queues.add(queue_b)

        run_service._broadcast({"event": "progress", "data": {"job_id": "x", "progress": 42}})

        ev_a = await asyncio.wait_for(queue_a.get(), timeout=0.5)
        ev_b = await asyncio.wait_for(queue_b.get(), timeout=0.5)
        assert ev_a == ev_b == {"event": "progress", "data": {"job_id": "x", "progress": 42}}

    async def test_subscriber_added_after_event_misses_it(self, run_service):
        """Broadcast doesn't buffer history — late subscribers see future events only."""
        queue_a = asyncio.Queue[dict]()
        run_service._broadcast_queues.add(queue_a)
        run_service._broadcast({"event": "progress", "data": {"job_id": "x", "progress": 10}})

        queue_b = asyncio.Queue[dict]()
        run_service._broadcast_queues.add(queue_b)
        run_service._broadcast({"event": "progress", "data": {"job_id": "x", "progress": 20}})

        # A got both, B got only the second.
        assert (await queue_a.get())["data"]["progress"] == 10
        assert (await queue_a.get())["data"]["progress"] == 20
        assert (await queue_b.get())["data"]["progress"] == 20
        assert queue_b.empty()

    async def test_full_subscriber_is_skipped_not_blocking(self, run_service):
        """A QueueFull on one subscriber must not stall the event path."""
        slow = asyncio.Queue[dict](maxsize=1)
        fast = asyncio.Queue[dict](maxsize=10)
        slow.put_nowait({"event": "seed", "data": {}})  # fill slow to capacity
        run_service._broadcast_queues.add(slow)
        run_service._broadcast_queues.add(fast)

        run_service._broadcast({"event": "progress", "data": {"job_id": "x", "progress": 55}})

        assert fast.qsize() == 1
        # Slow is still full with its seed; the broadcast silently dropped for it.
        assert slow.qsize() == 1


class TestJobEviction:
    async def test_completed_job_evicted_after_delay(self, run_service):
        """Finished jobs should be cleaned from _jobs dict."""
        job = RunJob(job_id="evict-test", effect_id="e", effect_name="E", model_id="m")
        job.status = "completed"
        run_service._jobs["evict-test"] = job

        run_service._schedule_eviction("evict-test", delay=0.1)
        await asyncio.sleep(0.2)

        assert "evict-test" not in run_service._jobs

    async def test_processing_job_not_evicted(self, run_service):
        """Processing jobs should NOT be evicted."""
        job = RunJob(job_id="keep-test", effect_id="e", effect_name="E", model_id="m")
        job.status = "processing"
        run_service._jobs["keep-test"] = job

        run_service._schedule_eviction("keep-test", delay=0.1)
        await asyncio.sleep(0.2)

        assert "keep-test" in run_service._jobs
