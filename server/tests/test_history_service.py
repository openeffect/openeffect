"""Unit tests for HistoryService with a real SQLite DB."""
import json
from dataclasses import dataclass
from datetime import datetime, timezone

import pytest

from db.database import Database, init_db
from services.history_service import HistoryService, RunRecord


@dataclass
class FakeJob:
    """Minimal stand-in for RunJob, matching attributes used by create_processing."""
    job_id: str
    effect_id: str
    effect_name: str
    model_id: str


@pytest.fixture
async def service(tmp_path):
    path = tmp_path / "test_history.db"
    await init_db(path)
    db = Database(path)
    await db.connect()
    yield HistoryService(db)
    await db.close()


def _make_job(job_id: str = "job-001", effect_id: str = "single-image/hdr",
              effect_name: str = "HDR", model_id: str = "wan-2.7") -> FakeJob:
    return FakeJob(job_id=job_id, effect_id=effect_id,
                   effect_name=effect_name, model_id=model_id)


async def _plant_file(service, file_id: str, *, ref_count: int = 0) -> None:
    """Insert a synthetic live `files` row so create_processing/complete
    can bump its ref_count without `add_file` actually running."""
    async with service._db.transaction() as conn:
        await conn.execute(
            "INSERT INTO files (id, hash, kind, mime, ext, size, "
            "                   ref_count, created_at) "
            "VALUES (?, ?, 'image', 'image/png', 'png', 0, ?, ?)",
            (file_id, f"h-{file_id}", ref_count,
             datetime.now(timezone.utc).isoformat()),
        )


async def _file_ref_count(service, file_id: str) -> int | None:
    row = await service._db.fetchone(
        "SELECT ref_count FROM files WHERE id = ?", (file_id,),
    )
    return row[0] if row else None


class TestCreateProcessing:
    async def test_inserts_record_with_processing_status(self, service):
        job = _make_job("job-create-1")
        record = await service.create_processing(job)
        assert record.id == "job-create-1"
        assert record.status == "processing"
        assert record.effect_id == "single-image/hdr"
        assert record.effect_name == "HDR"
        assert record.model_id == "wan-2.7"

    async def test_sets_initial_progress(self, service):
        job = _make_job("job-create-2")
        record = await service.create_processing(job)
        assert record.progress == 0

    async def test_sets_timestamps(self, service):
        job = _make_job("job-create-3")
        record = await service.create_processing(job)
        assert record.created_at != ""
        assert record.updated_at != ""
        dt = datetime.fromisoformat(record.created_at)
        assert dt.year >= 2024

    async def test_record_retrievable_after_create(self, service):
        job = _make_job("job-create-4")
        await service.create_processing(job)
        fetched = await service.get_by_id("job-create-4")
        assert fetched is not None
        assert fetched.id == "job-create-4"
        assert fetched.status == "processing"

    async def test_bumps_input_refs_atomically(self, service):
        """Each `input_ids[i]`'s ref_count goes 0 → 1 inside the
        same transaction as the run row INSERT."""
        await _plant_file(service, "in-1")
        await _plant_file(service, "in-2")

        await service.create_processing(
            _make_job("job-with-inputs"),
            input_ids=["in-1", "in-2"],
        )

        assert await _file_ref_count(service, "in-1") == 1
        assert await _file_ref_count(service, "in-2") == 1

    async def test_rolls_back_when_input_tombstoned(self, service):
        """If any input is tombstoned, the whole transaction
        rolls back — no half-bumped state, no orphan run row."""
        await _plant_file(service, "in-live")
        await _plant_file(service, "in-tomb")
        async with service._db.transaction() as conn:
            await conn.execute(
                "UPDATE files SET ref_count = NULL WHERE id = ?", ("in-tomb",),
            )

        with pytest.raises(ValueError, match="no longer available"):
            await service.create_processing(
                _make_job("job-doomed"),
                input_ids=["in-live", "in-tomb"],
            )

        # First input's bump rolled back.
        assert await _file_ref_count(service, "in-live") == 0
        # No run row was inserted.
        assert await service.get_by_id("job-doomed") is None


class TestUpdateProgress:
    async def test_changes_progress_and_message(self, service):
        job = _make_job("job-progress-1")
        await service.create_processing(job)

        await service.update_progress("job-progress-1", 50, "Halfway there")

        record = await service.get_by_id("job-progress-1")
        assert record is not None
        assert record.progress == 50
        assert record.progress_msg == "Halfway there"

    async def test_updates_timestamp(self, service):
        job = _make_job("job-progress-2")
        original = await service.create_processing(job)

        await service.update_progress("job-progress-2", 75, "Almost done")

        record = await service.get_by_id("job-progress-2")
        assert record is not None
        assert record.updated_at >= original.created_at

    async def test_multiple_progress_updates(self, service):
        job = _make_job("job-progress-3")
        await service.create_processing(job)

        await service.update_progress("job-progress-3", 25, "Quarter")
        await service.update_progress("job-progress-3", 50, "Half")
        await service.update_progress("job-progress-3", 75, "Three quarters")

        record = await service.get_by_id("job-progress-3")
        assert record is not None
        assert record.progress == 75
        assert record.progress_msg == "Three quarters"


class TestComplete:
    async def test_sets_completed_status(self, service):
        await _plant_file(service, "out-1")
        job = _make_job("job-complete-1")
        await service.create_processing(job)

        await service.complete("job-complete-1", "out-1", 5000)

        record = await service.get_by_id("job-complete-1")
        assert record is not None
        assert record.status == "completed"
        assert record.output_id == "out-1"
        assert record.duration_ms == 5000
        assert record.progress == 100

    async def test_complete_bumps_output_ref_atomically(self, service):
        """The bump on `output_id` lives inside the same transaction
        as the run row UPDATE — no window where the run is completed
        but the file's ref_count is still 0."""
        await _plant_file(service, "out-bump", ref_count=0)
        job = _make_job("job-bump")
        await service.create_processing(job)

        await service.complete("job-bump", "out-bump", 1234)

        assert await _file_ref_count(service, "out-bump") == 1

    async def test_complete_with_empty_output_id_skips_bump(self, service):
        """Empty `output_id` (failed result download) stores NULL and
        skips the bump — the run still flips to completed."""
        job = _make_job("job-no-output")
        await service.create_processing(job)

        await service.complete("job-no-output", "", 100)

        record = await service.get_by_id("job-no-output")
        assert record is not None
        assert record.status == "completed"
        assert record.output_id is None

    async def test_complete_raises_when_output_tombstoned(self, service):
        """If the just-ingested output got tombstoned in the
        microseconds between `add_file` and `complete`, the bump
        guard fires and the transaction rolls back."""
        await _plant_file(service, "out-tomb")
        # Tombstone it manually
        async with service._db.transaction() as conn:
            await conn.execute(
                "UPDATE files SET ref_count = NULL WHERE id = ?", ("out-tomb",),
            )
        job = _make_job("job-doomed")
        await service.create_processing(job)

        with pytest.raises(ValueError, match="no longer available"):
            await service.complete("job-doomed", "out-tomb", 100)

        # Run row stayed at processing — caller's responsibility to
        # mark it failed if appropriate.
        record = await service.get_by_id("job-doomed")
        assert record is not None
        assert record.status == "processing"

    async def test_clears_progress_message(self, service):
        await _plant_file(service, "out-2")
        job = _make_job("job-complete-2")
        await service.create_processing(job)
        await service.update_progress("job-complete-2", 50, "Working...")

        await service.complete("job-complete-2", "out-2", 3000)

        record = await service.get_by_id("job-complete-2")
        assert record is not None
        assert record.progress_msg is None


class TestFail:
    async def test_sets_failed_status_and_error(self, service):
        job = _make_job("job-fail-1")
        await service.create_processing(job)

        await service.fail("job-fail-1", "API timeout")

        record = await service.get_by_id("job-fail-1")
        assert record is not None
        assert record.status == "failed"
        assert record.error == "API timeout"

    async def test_clears_progress_message_on_fail(self, service):
        job = _make_job("job-fail-2")
        await service.create_processing(job)
        await service.update_progress("job-fail-2", 30, "Processing...")

        await service.fail("job-fail-2", "Out of memory")

        record = await service.get_by_id("job-fail-2")
        assert record is not None
        assert record.progress_msg is None


class TestGetAll:
    async def test_returns_empty_list_when_no_records(self, service):
        items = await service.get_all()
        assert items == []

    async def test_returns_records_ordered_by_created_at_desc(self, service):
        for i in range(3):
            job = _make_job(f"job-order-{i}", effect_name=f"Effect {i}")
            await service.create_processing(job)

        items = await service.get_all()
        assert len(items) == 3
        assert items[0].id == "job-order-2"
        assert items[1].id == "job-order-1"
        assert items[2].id == "job-order-0"

    async def test_respects_limit(self, service):
        for i in range(5):
            job = _make_job(f"job-limit-{i}")
            await service.create_processing(job)

        items = await service.get_all(limit=3)
        assert len(items) == 3

    async def test_respects_offset(self, service):
        for i in range(5):
            job = _make_job(f"job-offset-{i}")
            await service.create_processing(job)

        items = await service.get_all(limit=10, offset=3)
        assert len(items) == 2

    async def test_limit_and_offset_together(self, service):
        for i in range(10):
            job = _make_job(f"job-paging-{i}")
            await service.create_processing(job)

        page = await service.get_all(limit=3, offset=2)
        assert len(page) == 3

    async def test_returns_run_record_instances(self, service):
        job = _make_job("job-type-check")
        await service.create_processing(job)

        items = await service.get_all()
        assert len(items) == 1
        assert isinstance(items[0], RunRecord)

    async def test_filters_by_effect_id(self, service):
        await service.create_processing(_make_job("job-e1", effect_id="openeffect/hdr"))
        await service.create_processing(_make_job("job-e2", effect_id="openeffect/glow"))
        await service.create_processing(_make_job("job-e3", effect_id="openeffect/hdr"))

        items = await service.get_all(effect_id="openeffect/hdr")
        assert len(items) == 2
        assert all(item.effect_id == "openeffect/hdr" for item in items)

    async def test_filter_returns_empty_for_unknown_effect(self, service):
        await service.create_processing(_make_job("job-f1", effect_id="openeffect/hdr"))
        items = await service.get_all(effect_id="openeffect/nonexistent")
        assert items == []


class TestActiveCount:
    async def test_counts_processing_records(self, service):
        await service.create_processing(_make_job("job-active-1"))
        await service.create_processing(_make_job("job-active-2"))

        count = await service.active_count()
        assert count == 2

    async def test_excludes_completed_records(self, service):
        await service.create_processing(_make_job("job-ac-1"))
        await service.create_processing(_make_job("job-ac-2"))
        # Empty `output_id` skips the ref bump — these tests only care
        # about the status flip, not the output binding.
        await service.complete("job-ac-1", "", 1000)

        count = await service.active_count()
        assert count == 1

    async def test_excludes_failed_records(self, service):
        await service.create_processing(_make_job("job-af-1"))
        await service.create_processing(_make_job("job-af-2"))
        await service.fail("job-af-1", "Error")

        count = await service.active_count()
        assert count == 1

    async def test_zero_when_none_processing(self, service):
        await service.create_processing(_make_job("job-az-1"))
        await service.complete("job-az-1", "", 1000)

        count = await service.active_count()
        assert count == 0


class TestCount:
    async def test_total_count(self, service):
        for i in range(4):
            await service.create_processing(_make_job(f"job-count-{i}"))

        total = await service.count()
        assert total == 4

    async def test_count_includes_all_statuses(self, service):
        await service.create_processing(_make_job("job-ct-1"))
        await service.create_processing(_make_job("job-ct-2"))
        await service.complete("job-ct-1", "", 1000)
        await service.fail("job-ct-2", "Error")

        total = await service.count()
        assert total == 2

    async def test_count_by_effect_id(self, service):
        await service.create_processing(_make_job("job-ce-1", effect_id="openeffect/hdr"))
        await service.create_processing(_make_job("job-ce-2", effect_id="openeffect/glow"))
        await service.create_processing(_make_job("job-ce-3", effect_id="openeffect/hdr"))

        total = await service.count(effect_id="openeffect/hdr")
        assert total == 2


class TestDelete:
    async def test_removes_record(self, service):
        await service.create_processing(_make_job("job-del-1"))
        await service.delete("job-del-1")

        record = await service.get_by_id("job-del-1")
        assert record is None

    async def test_delete_reduces_count(self, service):
        await service.create_processing(_make_job("job-del-c1"))
        await service.create_processing(_make_job("job-del-c2"))
        await service.delete("job-del-c1")

        total = await service.count()
        assert total == 1

    async def test_delete_nonexistent_does_not_error(self, service):
        await service.delete("nonexistent-id")

    async def test_decrements_input_and_output_refs_atomically(self, service):
        """Delete drops the run row and decrements every file it
        referenced (`input_ids` + `output_id`) in one transaction."""
        await _plant_file(service, "in-a")
        await _plant_file(service, "in-b")
        await _plant_file(service, "out-x")

        await service.create_processing(
            _make_job("job-refs"),
            input_ids=["in-a", "in-b"],
        )
        await service.complete("job-refs", "out-x", 100)

        # All three at ref_count=1 after create+complete.
        assert await _file_ref_count(service, "in-a") == 1
        assert await _file_ref_count(service, "in-b") == 1
        assert await _file_ref_count(service, "out-x") == 1

        await service.delete("job-refs")

        # Run gone, every ref dropped back to 0.
        assert await service.get_by_id("job-refs") is None
        assert await _file_ref_count(service, "in-a") == 0
        assert await _file_ref_count(service, "in-b") == 0
        assert await _file_ref_count(service, "out-x") == 0


class TestGetById:
    async def test_returns_none_for_nonexistent_id(self, service):
        result = await service.get_by_id("does-not-exist")
        assert result is None

    async def test_returns_record_for_existing_id(self, service):
        await service.create_processing(_make_job("job-get-1"))
        record = await service.get_by_id("job-get-1")
        assert record is not None
        assert record.id == "job-get-1"

    async def test_returned_record_has_all_fields(self, service):
        await service.create_processing(_make_job("job-fields"))
        record = await service.get_by_id("job-fields")
        assert record is not None
        assert hasattr(record, "id")
        assert hasattr(record, "effect_id")
        assert hasattr(record, "effect_name")
        assert hasattr(record, "model_id")
        assert hasattr(record, "status")
        assert hasattr(record, "progress")
        assert hasattr(record, "output_id")
        assert hasattr(record, "input_ids")
        assert hasattr(record, "error")
        assert hasattr(record, "created_at")
        assert hasattr(record, "updated_at")


class TestRunRecordToDict:
    async def test_to_dict_returns_expected_keys(self, service):
        await service.create_processing(_make_job("job-dict-1"))
        record = await service.get_by_id("job-dict-1")
        assert record is not None
        d = record.to_dict()
        expected_keys = {
            "id", "kind", "effect_id", "effect_name", "model_id", "status",
            "progress", "progress_msg",
            "output", "input_files", "payload",
            "error", "created_at", "updated_at", "duration_ms",
        }
        assert set(d.keys()) == expected_keys

    async def test_to_dict_parses_payload_json(self, service):
        inputs = {"prompt": "city night", "intensity": "0.8"}
        job = _make_job("job-inputs-parse")
        await service.create_processing(job, payload_json=json.dumps(inputs))
        record = await service.get_by_id("job-inputs-parse")
        assert record is not None
        d = record.to_dict()
        assert isinstance(d["payload"], dict)
        assert d["payload"]["prompt"] == "city night"

    async def test_to_dict_handles_null_inputs(self, service):
        await service.create_processing(_make_job("job-null-inputs"))
        record = await service.get_by_id("job-null-inputs")
        assert record is not None
        d = record.to_dict()
        assert d["payload"] is None

    async def test_to_dict_handles_malformed_inputs(self, service):
        job = _make_job("job-bad-json")
        await service.create_processing(job, payload_json="not valid json {{{")
        record = await service.get_by_id("job-bad-json")
        assert record is not None
        d = record.to_dict()
        assert d["payload"] == "not valid json {{{"


class TestInputFiles:
    """Pin the role-vs-form-key dedup behavior. Effect runs persist BOTH
    `model_inputs` (role-keyed) AND `inputs` (manifest-form-keyed) maps
    that alias the same file UUIDs — emitting both would surface the
    same image twice (once as `start_frame`, once as the manifest's
    field name like `image`)."""

    async def test_effect_run_emits_role_keyed_only(self, service):
        """Effect run: prefer `model_inputs` (canonical role keys).
        The form-keyed `inputs` map aliases the same uuid and would
        produce a duplicate thumbnail in the UI if also emitted."""
        await _plant_file(service, "file-A")
        job = _make_job("job-effect-1")
        # Same shape `run_service.start` writes: `inputs` carries the
        # manifest's input field name (`image`); `model_inputs` carries
        # the canonical role (`start_frame`); both point at the same
        # file_id.
        payload_json = json.dumps({
            "inputs": {"image": "file-A", "prompt": "hello"},
            "model_inputs": {
                "prompt": "hello",
                "negative_prompt": "",
                "start_frame": "file-A",
            },
            "params": {},
        })
        await service.create_processing(
            job, payload_json=payload_json, input_ids=["file-A"],
        )
        record = await service.get_by_id("job-effect-1")
        assert record is not None
        d = await service.serialize(record)

        # Exactly one entry, keyed by the role (not the manifest's field name).
        assert set(d["input_files"].keys()) == {"start_frame"}
        assert d["input_files"]["start_frame"]["id"] == "file-A"

    async def test_playground_run_uses_inputs_section(self, service):
        """Playground runs persist only `inputs` (no `model_inputs`),
        already role-keyed. Verify that path resolves correctly."""
        await _plant_file(service, "file-B")
        job = _make_job("job-pg-1", effect_id=None, effect_name=None)
        payload_json = json.dumps({
            "inputs": {
                "prompt": "hello",
                "negative_prompt": "",
                "start_frame": "file-B",
            },
            "params": {},
        })
        await service.create_processing(
            job, payload_json=payload_json, input_ids=["file-B"],
            kind="playground",
        )
        record = await service.get_by_id("job-pg-1")
        assert record is not None
        d = await service.serialize(record)

        assert set(d["input_files"].keys()) == {"start_frame"}
        assert d["input_files"]["start_frame"]["id"] == "file-B"

    async def test_two_distinct_image_inputs_both_appear(self, service):
        """Effect with both start_frame and end_frame: both surface,
        keyed by their respective roles."""
        await _plant_file(service, "file-start")
        await _plant_file(service, "file-end")
        job = _make_job("job-effect-2")
        payload_json = json.dumps({
            "inputs": {"start": "file-start", "end": "file-end", "prompt": "x"},
            "model_inputs": {
                "prompt": "x",
                "negative_prompt": "",
                "start_frame": "file-start",
                "end_frame": "file-end",
            },
            "params": {},
        })
        await service.create_processing(
            job, payload_json=payload_json,
            input_ids=["file-start", "file-end"],
        )
        record = await service.get_by_id("job-effect-2")
        assert record is not None
        d = await service.serialize(record)

        assert set(d["input_files"].keys()) == {"start_frame", "end_frame"}
        assert d["input_files"]["start_frame"]["id"] == "file-start"
        assert d["input_files"]["end_frame"]["id"] == "file-end"
