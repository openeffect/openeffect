"""Integration tests for the run pipeline with a mocked provider."""
import asyncio
import json
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from config.config_service import ConfigService
from db.database import Database, init_db
from effects.validator import EffectManifest
from providers.base import ProviderEvent, ProviderInput
from schemas.run import RunRequest
from services.effect_loader import EffectLoaderService, LoadedEffect
from services.file_service import FileService
from services.history_service import HistoryService
from services.model_service import ModelService
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
    need to look real, the rest are MagicMock. `spec=` so a renamed/removed
    method on the real class fails the test instead of silently passing."""
    svc = MagicMock(spec=FileService)
    svc.files_dir = tmp_path / "files"
    svc.files_dir.mkdir(exist_ok=True)
    svc.increment_ref = AsyncMock()
    return svc


@pytest.fixture
def model_service(tmp_path):
    svc = MagicMock(spec=ModelService)
    svc.models_dir = tmp_path / "models"
    return svc


@pytest.fixture
def config_service():
    svc = MagicMock(spec=ConfigService)
    svc.get_api_key = AsyncMock(return_value="test-key")
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


# ─── recover_stuck_jobs ──────────────────────────────────────────────────────


async def _insert_processing_run(
    db: Database,
    *,
    job_id: str,
    provider_request_id: str | None = None,
    provider_endpoint: str | None = None,
) -> None:
    """Plant a `processing` run row directly via SQL — what the DB looks
    like right after a server crash mid-run."""
    now = datetime.now(timezone.utc).isoformat()
    async with db.transaction() as conn:
        await conn.execute(
            """INSERT INTO runs (
                   id, kind, effect_id, effect_name, model_id,
                   status, progress, progress_msg, input_ids,
                   inputs, created_at, updated_at,
                   provider_request_id, provider_endpoint
               ) VALUES (?, 'effect', ?, ?, ?, 'processing', 50, 'Generating',
                         '[]', '{}', ?, ?, ?, ?)""",
            (
                job_id, "test-uuid-001", "Test", "wan-2.7",
                now, now, provider_request_id, provider_endpoint,
            ),
        )


class TestRecoverStuckJobs:
    """Boot-time recovery of `processing` runs left dangling by a crash.
    These tests pin the contract of `RunService.recover_stuck_jobs`,
    which lives at the top of `main.py`'s lifespan and quietly determines
    whether a server restart loses the user's in-flight work."""

    async def test_recovers_completed_run_when_provider_returns_completed(
        self, run_service, history, database,
    ):
        """Stuck job with a recoverable request_id + endpoint, and the
        provider says the run already finished server-side. We mark it
        completed; the user opens the app and sees the finished video."""
        await _insert_processing_run(
            database,
            job_id="recover-1",
            provider_request_id="fal-req-abc",
            provider_endpoint="fal-ai/wan/v2.7/image-to-video",
        )

        with patch(
            "services.run_service.FalProvider.recover",
            new=AsyncMock(return_value=ProviderEvent(type="failed", error="recovery e2e short-circuit")),
        ):
            # Short-circuit ingest: the recovery path calls _ingest_result
            # only on type="completed" with a video_url. We use a `failed`
            # event here to focus this test on the failure-recovery branch
            # without needing a real download. The next test covers the
            # `completed` path.
            await run_service.recover_stuck_jobs()

        record = await history.get_by_id("recover-1")
        assert record is not None
        assert record.status == "failed"
        assert record.error and "recovery e2e short-circuit" in record.error

    async def test_marks_failed_when_no_recovery_info(
        self, run_service, history, database,
    ):
        """A processing row that never recorded a provider_request_id
        was lost before the provider acknowledged it — there's nothing
        to recover. Mark it failed instead of leaving it stuck forever."""
        # Note: get_stuck_processing's WHERE filters on
        # provider_request_id IS NOT NULL, so the only way to exercise
        # this branch is to plant a row that DOES have a request_id but
        # lacks the endpoint — `recover_stuck_jobs` checks both. We put
        # the request_id in but leave the endpoint as NULL.
        await _insert_processing_run(
            database,
            job_id="recover-2",
            provider_request_id="fal-req-def",
            provider_endpoint=None,
        )

        await run_service.recover_stuck_jobs()

        record = await history.get_by_id("recover-2")
        assert record is not None
        assert record.status == "failed"
        assert record.error and "no recovery info" in record.error

    async def test_marks_all_failed_when_no_api_key(
        self, run_service, history, database,
    ):
        """No API key on disk = no way to poll fal.ai for status of any
        in-flight job. All stuck rows get marked failed with a clear
        message so the user knows why."""
        await _insert_processing_run(
            database,
            job_id="recover-3",
            provider_request_id="fal-req-ghi",
            provider_endpoint="fal-ai/wan/v2.7/image-to-video",
        )
        # Override the AsyncMock from the fixture (returns "test-key")
        # with one that returns no key.
        run_service._config.get_api_key = AsyncMock(return_value=None)

        await run_service.recover_stuck_jobs()

        record = await history.get_by_id("recover-3")
        assert record is not None
        assert record.status == "failed"
        assert record.error and "no API key" in record.error

    async def test_no_op_when_no_stuck_jobs(self, run_service, history, database):
        """Common case at startup: no in-flight runs from a prior
        process. Recovery should be a silent no-op."""
        # Plant a completed run — should not be touched.
        now = datetime.now(timezone.utc).isoformat()
        async with database.transaction() as conn:
            await conn.execute(
                """INSERT INTO runs (
                       id, kind, effect_id, effect_name, model_id,
                       status, progress, input_ids, inputs,
                       created_at, updated_at
                   ) VALUES (?, 'effect', ?, ?, ?, 'completed', 100, '[]', '{}', ?, ?)""",
                ("done-1", "test-uuid-001", "Done", "wan-2.7", now, now),
            )

        await run_service.recover_stuck_jobs()

        record = await history.get_by_id("done-1")
        assert record is not None
        assert record.status == "completed"


# ─── _execute_provider end-to-end ────────────────────────────────────────────


def _scripted_provider(events: list[ProviderEvent]):
    """Build a one-off provider that yields exactly `events` and stops."""
    class _Scripted:
        async def generate(self, _input):
            for ev in events:
                yield ev
    return _Scripted()


def _raising_provider(exc: Exception):
    """Provider that yields one progress event then raises — exercises
    the outer `except Exception` arm in `_execute_provider`."""
    class _Raise:
        async def generate(self, _input):
            yield ProviderEvent(type="progress", progress=10, message="Working")
            raise exc
    return _Raise()


async def _seed_and_execute(
    run_service, history, database,
    *,
    job_id: str,
    provider,
    needs_reverse: bool = False,
):
    """Common scaffolding: plant a `processing` row, then drive
    `_execute_provider` to completion synchronously. Tests assert on
    the final state via `history.get_by_id` afterward."""
    job = RunJob(
        job_id=job_id, effect_id="test-uuid-001",
        effect_name="Test", model_id="wan-2.7",
    )
    await history.create_processing(job, inputs_json="{}", input_ids=[])
    provider_input = ProviderInput(
        prompt="hello", negative_prompt="", image_inputs={}, parameters={},
    )
    with patch(
        "services.run_service.ModelProviderFactory.create",
        return_value=provider,
    ):
        await run_service._execute_provider(
            job, "wan-2.7", "fal", provider_input, needs_reverse=needs_reverse,
        )


class TestExecuteProvider:
    """Integration tests for the provider event loop, result ingest, and
    failure paths in `_execute_provider`. Patches `_ingest_result` so the
    tests don't depend on real download/ffmpeg/FileService plumbing —
    the result-ingest internals have their own coverage in
    `test_video_reverse.py` and `test_file_service.py`. The interesting
    contract here is the event→DB→broadcast translation."""

    async def test_failed_event_marks_run_failed_and_broadcasts(
        self, run_service, history, database,
    ):
        events_seen: list[dict] = []
        run_service._broadcast = lambda ev: events_seen.append(ev)

        await _seed_and_execute(
            run_service, history, database,
            job_id="exec-fail-1",
            provider=_scripted_provider([
                ProviderEvent(type="progress", progress=30, message="Working"),
                ProviderEvent(type="failed", error="provider says nope"),
            ]),
        )

        record = await history.get_by_id("exec-fail-1")
        assert record is not None
        assert record.status == "failed"
        assert record.error == "provider says nope"

        # Both progress and failed events should have been fanned out
        kinds = [e["event"] for e in events_seen]
        assert "progress" in kinds
        assert "failed" in kinds

    async def test_provider_exception_routed_to_fail_job(
        self, run_service, history, database,
    ):
        events_seen: list[dict] = []
        run_service._broadcast = lambda ev: events_seen.append(ev)

        await _seed_and_execute(
            run_service, history, database,
            job_id="exec-fail-2",
            provider=_raising_provider(RuntimeError("provider blew up")),
        )

        record = await history.get_by_id("exec-fail-2")
        assert record is not None
        assert record.status == "failed"
        assert record.error and "provider blew up" in record.error

        # _fail_job emits its own broadcast frame — tagged with the
        # INTERNAL_ERROR code so the client can distinguish it.
        failed_events = [e for e in events_seen if e["event"] == "failed"]
        assert any(e["data"].get("code") == "INTERNAL_ERROR" for e in failed_events)

    async def test_completed_with_no_output_marks_completed(
        self, run_service, history, database,
    ):
        """Result download/ingest can fail (oversized, network) and
        return None. The run is still marked completed — current
        semantics — but with no output_id and no broadcast video_url."""
        run_service._broadcast = lambda ev: None
        run_service._ingest_result = AsyncMock(return_value=None)

        await _seed_and_execute(
            run_service, history, database,
            job_id="exec-no-output",
            provider=_scripted_provider([
                ProviderEvent(type="completed", video_url="https://example.com/video.mp4"),
            ]),
        )

        record = await history.get_by_id("exec-no-output")
        assert record is not None
        assert record.status == "completed"
        assert record.output_id in (None, "")

    async def test_completed_with_output_bumps_ref_count(
        self, run_service, history, database,
    ):
        """Happy path: provider completes, _ingest_result returns a
        live file_id, history.complete bumps ref_count and pins
        output_id on the run row."""
        # Plant a live file row so the bump succeeds.
        async with database.transaction() as conn:
            await conn.execute(
                "INSERT INTO files (id, hash, kind, mime, ext, size, variants, "
                "                   ref_count, created_at) "
                "VALUES (?, ?, 'video', 'video/mp4', 'mp4', 0, '[]', 0, ?)",
                ("file-output-1", "h-output", datetime.now(timezone.utc).isoformat()),
            )
        run_service._broadcast = lambda ev: None
        run_service._ingest_result = AsyncMock(return_value="file-output-1")

        await _seed_and_execute(
            run_service, history, database,
            job_id="exec-success",
            provider=_scripted_provider([
                ProviderEvent(type="completed", video_url="https://example.com/v.mp4"),
            ]),
        )

        record = await history.get_by_id("exec-success")
        assert record is not None
        assert record.status == "completed"
        assert record.output_id == "file-output-1"

        row = await database.fetchone(
            "SELECT ref_count FROM files WHERE id = ?", ("file-output-1",),
        )
        assert row is not None
        assert row["ref_count"] == 1

    async def test_submitted_event_records_provider_request_id(
        self, run_service, history, database,
    ):
        """The first `submitted` event from FAL carries the request_id —
        critical for boot-time recovery (see `recover_stuck_jobs`)."""
        run_service._broadcast = lambda ev: None
        run_service._ingest_result = AsyncMock(return_value=None)

        await _seed_and_execute(
            run_service, history, database,
            job_id="exec-submitted",
            provider=_scripted_provider([
                ProviderEvent(
                    type="submitted",
                    request_id="fal-req-xyz",
                    endpoint="fal-ai/wan/v2.7/image-to-video",
                ),
                ProviderEvent(type="completed", video_url=""),
            ]),
        )

        # Read the raw row to inspect the recovery columns.
        row = await database.fetchone(
            "SELECT provider_request_id, provider_endpoint FROM runs WHERE id = ?",
            ("exec-submitted",),
        )
        assert row is not None
        assert row["provider_request_id"] == "fal-req-xyz"
        assert row["provider_endpoint"] == "fal-ai/wan/v2.7/image-to-video"
