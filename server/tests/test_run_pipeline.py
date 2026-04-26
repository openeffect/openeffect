"""Integration tests for the run pipeline with a mocked provider."""
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from db.database import Database, init_db
from effects.validator import EffectManifest
from schemas.run import RunRequest
from services.effect_loader import EffectLoaderService, LoadedEffect
from services.history_service import HistoryService
from services.run_service import RunJob, RunService
from tests._factories import make_manifest

# ─── Fixtures ────────────────────────────────────────────────────────────────

def _make_manifest() -> EffectManifest:
    return make_manifest(
        id="test/test-effect", category="animation",
        inputs={
            "image": {"type": "image", "role": "start_frame", "required": True, "label": "Photo"},
            "prompt": {"type": "text", "required": False, "label": "Prompt", "multiline": False},
        },
        generation={"prompt": "Test {{ prompt }}"},
    )


def _make_loaded(manifest: EffectManifest, effect_id: str = "test-uuid-001") -> LoadedEffect:
    return LoadedEffect(
        manifest=manifest,
        id=effect_id,
        full_id=manifest.full_id,
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
    loader.get_by_id.return_value = loaded
    loader.get_loaded.return_value = loaded
    return loader


@pytest.fixture
def files(tmp_path):
    """A FileService stand-in — only the methods the run pipeline calls
    need to look real, the rest are MagicMock."""
    svc = MagicMock()
    svc.files_dir = tmp_path / "files"
    svc.files_dir.mkdir(exist_ok=True)
    svc.increment_ref = AsyncMock()
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
def run_service(effect_loader, config_service, history, files, model_service):
    return RunService(
        effect_loader=effect_loader,
        config_service=config_service,
        history_service=history,
        file_service=files,
        model_service=model_service,
    )


# ─── Tests ───────────────────────────────────────────────────────────────────

class TestStartRun:
    async def test_creates_job_and_returns_id(self, run_service, history):
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

    async def test_stores_inputs_as_structured_json(self, run_service, history):
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
        run_service._effect_loader.get_by_id.return_value = None
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
        # Our test manifest has start_frame only, so every real model is
        # compatible — test with a model ID that doesn't exist at all.
        with pytest.raises(ValueError, match="not compatible"):
            await run_service.start(RunRequest(
                effect_id="test-uuid-001",
                model_id="nonexistent-model",
                provider_id="fal",
                inputs={},
                output={},
            ))

    async def test_increments_ref_count_for_image_inputs(self, run_service, database):
        """Bumping happens atomically inside `history.create_processing`
        (same transaction as the run row INSERT). Plant a live file row
        for the input id, kick off `start`, verify the ref_count moved."""
        from datetime import datetime, timezone
        async with database.transaction() as conn:
            await conn.execute(
                "INSERT INTO files (id, hash, kind, mime, ext, size, variants, "
                "                   ref_count, created_at) "
                "VALUES (?, ?, 'image', 'image/png', 'png', 0, '[]', 0, ?)",
                ("abc123hash", "h-abc", datetime.now(timezone.utc).isoformat()),
            )

        await run_service.start(RunRequest(
            effect_id="test-uuid-001",
            model_id="wan-2.7",
            provider_id="fal",
            inputs={"image": "abc123hash", "prompt": "test"},
            output={},
        ))

        row = await database.fetchone(
            "SELECT ref_count FROM files WHERE id = ?", ("abc123hash",),
        )
        assert row is not None
        assert row["ref_count"] == 1


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
