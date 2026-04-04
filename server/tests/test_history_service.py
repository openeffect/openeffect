"""Unit tests for HistoryService with in-memory SQLite."""
import asyncio
import json
from dataclasses import dataclass
from datetime import datetime, timezone

import aiosqlite
import pytest

from services.history_service import HistoryService, RunRecord

# SQL matching server/db/database.py
CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS runs (
    id                  TEXT PRIMARY KEY,
    effect_id           TEXT NOT NULL,
    effect_name         TEXT NOT NULL,
    model_id            TEXT NOT NULL,
    status              TEXT NOT NULL,
    progress            INTEGER DEFAULT 0,
    progress_msg        TEXT,
    video_url           TEXT,
    inputs              TEXT,
    error               TEXT,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    duration_ms         INTEGER,
    provider_request_id TEXT,
    provider_endpoint   TEXT
)
"""


@dataclass
class FakeJob:
    """Minimal stand-in for RunJob, matching attributes used by create_processing."""
    job_id: str
    effect_id: str
    effect_name: str
    model_id: str


@pytest.fixture
async def db_path(tmp_path):
    """Create a temporary DB file with the runs table."""
    path = tmp_path / "test_history.db"
    async with aiosqlite.connect(str(path)) as db:
        await db.execute(CREATE_TABLE_SQL)
        await db.commit()
    return path


@pytest.fixture
async def service(db_path):
    """Create a HistoryService pointing at the test DB."""
    svc = HistoryService(db_path)
    yield svc
    await svc.close()


def _make_job(job_id: str = "job-001", effect_id: str = "single-image/hdr",
              effect_name: str = "HDR", model_id: str = "wan-2.2") -> FakeJob:
    return FakeJob(job_id=job_id, effect_id=effect_id,
                   effect_name=effect_name, model_id=model_id)


class TestCreateProcessing:
    async def test_inserts_record_with_processing_status(self, service):
        job = _make_job("job-create-1")
        record = await service.create_processing(job)
        assert record.id == "job-create-1"
        assert record.status == "processing"
        assert record.effect_id == "single-image/hdr"
        assert record.effect_name == "HDR"
        assert record.model_id == "wan-2.2"

    async def test_sets_initial_progress(self, service):
        job = _make_job("job-create-2")
        record = await service.create_processing(job)
        assert record.progress == 0

    async def test_sets_timestamps(self, service):
        job = _make_job("job-create-3")
        record = await service.create_processing(job)
        assert record.created_at != ""
        assert record.updated_at != ""
        # Timestamps should be parseable ISO format
        dt = datetime.fromisoformat(record.created_at)
        assert dt.year >= 2024

    async def test_record_retrievable_after_create(self, service):
        job = _make_job("job-create-4")
        await service.create_processing(job)
        fetched = await service.get_by_id("job-create-4")
        assert fetched is not None
        assert fetched.id == "job-create-4"
        assert fetched.status == "processing"


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
        # updated_at should be >= created_at
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
        job = _make_job("job-complete-1")
        await service.create_processing(job)

        await service.complete("job-complete-1", "/videos/output.mp4", 5000)

        record = await service.get_by_id("job-complete-1")
        assert record is not None
        assert record.status == "completed"
        assert record.video_url == "/videos/output.mp4"
        assert record.duration_ms == 5000
        assert record.progress == 100

    async def test_clears_progress_message(self, service):
        job = _make_job("job-complete-2")
        await service.create_processing(job)
        await service.update_progress("job-complete-2", 50, "Working...")

        await service.complete("job-complete-2", "/out.mp4", 3000)

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
        # Create jobs in order
        for i in range(3):
            job = _make_job(f"job-order-{i}", effect_name=f"Effect {i}")
            await service.create_processing(job)

        items = await service.get_all()
        assert len(items) == 3
        # Most recent first (DESC order)
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
        # Create two processing jobs
        await service.create_processing(_make_job("job-active-1"))
        await service.create_processing(_make_job("job-active-2"))

        count = await service.active_count()
        assert count == 2

    async def test_excludes_completed_records(self, service):
        await service.create_processing(_make_job("job-ac-1"))
        await service.create_processing(_make_job("job-ac-2"))
        await service.complete("job-ac-1", "/out.mp4", 1000)

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
        await service.complete("job-az-1", "/out.mp4", 1000)

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
        await service.complete("job-ct-1", "/out.mp4", 1000)
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
        # Should not raise even when ID doesn't exist
        await service.delete("nonexistent-id")


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
        assert hasattr(record, "video_url")
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
            "id", "effect_id", "effect_name", "model_id", "status",
            "progress", "progress_msg", "video_url", "inputs",
            "error", "created_at", "updated_at", "duration_ms",
        }
        assert set(d.keys()) == expected_keys

    async def test_to_dict_parses_inputs_json(self, service):
        """inputs stored as JSON string should be returned as parsed dict."""
        inputs = {"prompt": "city night", "intensity": "0.8"}
        job = _make_job("job-inputs-parse")
        await service.create_processing(job, inputs_json=json.dumps(inputs))
        record = await service.get_by_id("job-inputs-parse")
        assert record is not None
        d = record.to_dict()
        assert isinstance(d["inputs"], dict)
        assert d["inputs"]["prompt"] == "city night"

    async def test_to_dict_handles_null_inputs(self, service):
        """Null inputs should return None in to_dict."""
        await service.create_processing(_make_job("job-null-inputs"))
        record = await service.get_by_id("job-null-inputs")
        assert record is not None
        d = record.to_dict()
        assert d["inputs"] is None

    async def test_to_dict_handles_malformed_inputs(self, service):
        """Malformed JSON string should be returned as-is, not crash."""
        job = _make_job("job-bad-json")
        await service.create_processing(job, inputs_json="not valid json {{{")
        record = await service.get_by_id("job-bad-json")
        assert record is not None
        d = record.to_dict()
        assert d["inputs"] == "not valid json {{{"
