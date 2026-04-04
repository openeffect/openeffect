import json
import aiosqlite
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config.settings import get_settings


@dataclass
class RunRecord:
    id: str
    effect_id: str
    effect_name: str
    model_id: str
    status: str
    progress: int = 0
    progress_msg: str | None = None
    video_url: str | None = None
    inputs: str | None = None
    error: str | None = None
    created_at: str = ""
    updated_at: str = ""
    duration_ms: int | None = None
    provider_request_id: str | None = None
    provider_endpoint: str | None = None

    def to_dict(self) -> dict[str, Any]:
        # Parse inputs from JSON string to dict for output
        parsed_inputs = None
        if self.inputs:
            try:
                parsed_inputs = json.loads(self.inputs)
            except (json.JSONDecodeError, TypeError):
                parsed_inputs = self.inputs

        return {
            "id": self.id,
            "effect_id": self.effect_id,
            "effect_name": self.effect_name,
            "model_id": self.model_id,
            "status": self.status,
            "progress": self.progress,
            "progress_msg": self.progress_msg,
            "video_url": self.video_url,
            "inputs": parsed_inputs,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "duration_ms": self.duration_ms,
        }

    @staticmethod
    def run_folder(job_id: str) -> Path:
        settings = get_settings()
        return settings.user_data_dir / "runs" / job_id


class HistoryService:
    def __init__(self, db_path: Path):
        self._db_path = db_path
        self._db: aiosqlite.Connection | None = None

    async def _get_db(self) -> aiosqlite.Connection:
        if self._db is None:
            self._db = await aiosqlite.connect(str(self._db_path))
            self._db.row_factory = aiosqlite.Row
        return self._db

    async def close(self) -> None:
        if self._db is not None:
            await self._db.close()
            self._db = None

    async def create_processing(self, job: Any, inputs_json: str | None = None) -> RunRecord:
        now = datetime.now(timezone.utc).isoformat()
        db = await self._get_db()
        await db.execute(
            """INSERT INTO runs (id, effect_id, effect_name, model_id, status, progress, progress_msg, inputs, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'processing', 0, 'Starting...', ?, ?, ?)""",
            (job.job_id, job.effect_id, job.effect_name, job.model_id, inputs_json, now, now),
        )
        await db.commit()
        return RunRecord(
            id=job.job_id, effect_id=job.effect_id, effect_name=job.effect_name,
            model_id=job.model_id, status="processing", inputs=inputs_json,
            created_at=now, updated_at=now,
        )

    async def update_progress(self, job_id: str, progress: int, msg: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        db = await self._get_db()
        await db.execute(
            "UPDATE runs SET progress=?, progress_msg=?, updated_at=? WHERE id=?",
            (progress, msg, now, job_id),
        )
        await db.commit()

    async def set_provider_request(self, job_id: str, request_id: str, endpoint: str) -> None:
        db = await self._get_db()
        await db.execute(
            "UPDATE runs SET provider_request_id=?, provider_endpoint=? WHERE id=?",
            (request_id, endpoint, job_id),
        )
        await db.commit()

    async def get_stuck_processing(self) -> list[RunRecord]:
        """Get all processing records that have a provider_request_id (recoverable)."""
        db = await self._get_db()
        cursor = await db.execute(
            "SELECT * FROM runs WHERE status='processing' AND provider_request_id IS NOT NULL"
        )
        rows = await cursor.fetchall()
        return [RunRecord(**dict(row)) for row in rows]

    async def complete(self, job_id: str, video_url: str, duration_ms: int) -> None:
        now = datetime.now(timezone.utc).isoformat()
        db = await self._get_db()
        await db.execute(
            "UPDATE runs SET status='completed', video_url=?, duration_ms=?, progress=100, progress_msg=NULL, updated_at=? WHERE id=?",
            (video_url, duration_ms, now, job_id),
        )
        await db.commit()

    async def fail(self, job_id: str, error: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        db = await self._get_db()
        await db.execute(
            "UPDATE runs SET status='failed', error=?, progress_msg=NULL, updated_at=? WHERE id=?",
            (error, now, job_id),
        )
        await db.commit()

    async def get_all(self, limit: int = 50, offset: int = 0, effect_id: str | None = None) -> list[RunRecord]:
        limit = max(1, min(limit, 1000))
        offset = max(0, offset)
        db = await self._get_db()
        if effect_id:
            cursor = await db.execute(
                "SELECT * FROM runs WHERE effect_id=? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (effect_id, limit, offset),
            )
        else:
            cursor = await db.execute(
                "SELECT * FROM runs ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            )
        rows = await cursor.fetchall()
        return [RunRecord(**dict(row)) for row in rows]

    async def get_by_id(self, job_id: str) -> RunRecord | None:
        db = await self._get_db()
        cursor = await db.execute("SELECT * FROM runs WHERE id=?", (job_id,))
        row = await cursor.fetchone()
        if row:
            return RunRecord(**dict(row))
        return None

    async def count(self, effect_id: str | None = None) -> int:
        db = await self._get_db()
        if effect_id:
            cursor = await db.execute("SELECT COUNT(*) FROM runs WHERE effect_id=?", (effect_id,))
        else:
            cursor = await db.execute("SELECT COUNT(*) FROM runs")
        row = await cursor.fetchone()
        return row[0] if row else 0

    async def active_count(self) -> int:
        db = await self._get_db()
        cursor = await db.execute("SELECT COUNT(*) FROM runs WHERE status='processing'")
        row = await cursor.fetchone()
        return row[0] if row else 0

    async def delete(self, job_id: str) -> None:
        db = await self._get_db()
        await db.execute("DELETE FROM runs WHERE id=?", (job_id,))
        await db.commit()
