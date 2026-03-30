import aiosqlite
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


@dataclass
class GenerationRecord:
    id: str
    effect_id: str
    effect_name: str
    model_id: str
    status: str
    progress: int = 0
    progress_msg: str | None = None
    video_url: str | None = None
    thumbnail_url: str | None = None
    inputs_json: str | None = None
    prompt_used: str | None = None
    error: str | None = None
    created_at: str = ""
    updated_at: str = ""
    duration_ms: int | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "effect_id": self.effect_id,
            "effect_name": self.effect_name,
            "model_id": self.model_id,
            "status": self.status,
            "progress": self.progress,
            "progress_msg": self.progress_msg,
            "video_url": self.video_url,
            "thumbnail_url": self.thumbnail_url,
            "inputs_summary": self.inputs_json or "",
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "duration_ms": self.duration_ms,
        }


class HistoryService:
    def __init__(self, db_path: Path):
        self._db_path = db_path
        self._db: aiosqlite.Connection | None = None

    async def _get_db(self) -> aiosqlite.Connection:
        if self._db is None:
            self._db = await aiosqlite.connect(str(self._db_path))
            self._db.row_factory = aiosqlite.Row
        return self._db

    async def create_processing(self, job: Any) -> GenerationRecord:
        now = datetime.now(timezone.utc).isoformat()
        db = await self._get_db()
        await db.execute(
            """INSERT INTO generations (id, effect_id, effect_name, model_id, status, progress, progress_msg, created_at, updated_at)
               VALUES (?, ?, ?, ?, 'processing', 0, 'Starting...', ?, ?)""",
            (job.job_id, job.effect_id, job.effect_name, job.model_id, now, now),
        )
        await db.commit()
        return GenerationRecord(
            id=job.job_id, effect_id=job.effect_id, effect_name=job.effect_name,
            model_id=job.model_id, status="processing", created_at=now, updated_at=now,
        )

    async def update_progress(self, job_id: str, progress: int, msg: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        db = await self._get_db()
        await db.execute(
            "UPDATE generations SET progress=?, progress_msg=?, updated_at=? WHERE id=?",
            (progress, msg, now, job_id),
        )
        await db.commit()

    async def complete(self, job_id: str, video_url: str, duration_ms: int) -> None:
        now = datetime.now(timezone.utc).isoformat()
        db = await self._get_db()
        await db.execute(
            "UPDATE generations SET status='completed', video_url=?, duration_ms=?, progress=100, progress_msg=NULL, updated_at=? WHERE id=?",
            (video_url, duration_ms, now, job_id),
        )
        await db.commit()

    async def fail(self, job_id: str, error: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        db = await self._get_db()
        await db.execute(
            "UPDATE generations SET status='failed', error=?, progress_msg=NULL, updated_at=? WHERE id=?",
            (error, now, job_id),
        )
        await db.commit()

    async def get_all(self, limit: int = 50, offset: int = 0) -> list[GenerationRecord]:
        db = await self._get_db()
        cursor = await db.execute(
            "SELECT * FROM generations ORDER BY created_at DESC LIMIT ? OFFSET ?",
            (limit, offset),
        )
        rows = await cursor.fetchall()
        return [GenerationRecord(**dict(row)) for row in rows]

    async def get_by_id(self, job_id: str) -> GenerationRecord | None:
        db = await self._get_db()
        cursor = await db.execute("SELECT * FROM generations WHERE id=?", (job_id,))
        row = await cursor.fetchone()
        if row:
            return GenerationRecord(**dict(row))
        return None

    async def count(self) -> int:
        db = await self._get_db()
        cursor = await db.execute("SELECT COUNT(*) FROM generations")
        row = await cursor.fetchone()
        return row[0] if row else 0

    async def active_count(self) -> int:
        db = await self._get_db()
        cursor = await db.execute("SELECT COUNT(*) FROM generations WHERE status='processing'")
        row = await cursor.fetchone()
        return row[0] if row else 0

    async def delete(self, job_id: str) -> None:
        db = await self._get_db()
        await db.execute("DELETE FROM generations WHERE id=?", (job_id,))
        await db.commit()
