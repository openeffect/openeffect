import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config.settings import get_settings
from db.database import Database


@dataclass
class RunRecord:
    id: str
    model_id: str
    status: str
    kind: str = "effect"
    effect_id: str | None = None
    effect_name: str | None = None
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
        parsed_inputs = None
        if self.inputs:
            try:
                parsed_inputs = json.loads(self.inputs)
            except (json.JSONDecodeError, TypeError):
                parsed_inputs = self.inputs

        return {
            "id": self.id,
            "kind": self.kind,
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
    def __init__(self, db: Database):
        self._db = db

    async def close(self) -> None:
        """Kept for API compatibility; the Database lifecycle is owned by the caller."""
        pass

    async def create_processing(self, job: Any, inputs_json: str | None = None, kind: str = "effect") -> RunRecord:
        now = datetime.now(timezone.utc).isoformat()
        async with self._db.transaction() as conn:
            await conn.execute(
                """INSERT INTO runs (
                       id, kind, effect_id, effect_name, model_id,
                       status, progress, progress_msg, inputs, created_at, updated_at
                   ) VALUES (?, ?, ?, ?, ?, 'processing', 0, 'Starting...', ?, ?, ?)""",
                (job.job_id, kind, job.effect_id, job.effect_name, job.model_id, inputs_json, now, now),
            )
        return RunRecord(
            id=job.job_id, kind=kind, effect_id=job.effect_id, effect_name=job.effect_name,
            model_id=job.model_id, status="processing", inputs=inputs_json,
            created_at=now, updated_at=now,
        )

    async def update_progress(self, job_id: str, progress: int, msg: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        async with self._db.transaction() as conn:
            await conn.execute(
                "UPDATE runs SET progress=?, progress_msg=?, updated_at=? WHERE id=?",
                (progress, msg, now, job_id),
            )

    async def set_provider_request(self, job_id: str, request_id: str, endpoint: str) -> None:
        async with self._db.transaction() as conn:
            await conn.execute(
                "UPDATE runs SET provider_request_id=?, provider_endpoint=? WHERE id=?",
                (request_id, endpoint, job_id),
            )

    async def get_stuck_processing(self) -> list[RunRecord]:
        """Get all processing records that have a provider_request_id (recoverable)."""
        rows = await self._db.fetchall(
            "SELECT * FROM runs WHERE status='processing' AND provider_request_id IS NOT NULL"
        )
        return [RunRecord(**dict(row)) for row in rows]

    async def complete(self, job_id: str, video_url: str, duration_ms: int) -> None:
        now = datetime.now(timezone.utc).isoformat()
        async with self._db.transaction() as conn:
            await conn.execute(
                """UPDATE runs
                   SET status='completed', video_url=?, duration_ms=?,
                       progress=100, progress_msg=NULL, updated_at=?
                   WHERE id=?""",
                (video_url, duration_ms, now, job_id),
            )

    async def fail(self, job_id: str, error: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        async with self._db.transaction() as conn:
            await conn.execute(
                "UPDATE runs SET status='failed', error=?, progress_msg=NULL, updated_at=? WHERE id=?",
                (error, now, job_id),
            )

    async def get_all(
        self,
        limit: int = 50,
        offset: int = 0,
        effect_id: str | None = None,
        kind: str | None = None,
    ) -> list[RunRecord]:
        limit = max(1, min(limit, 1000))
        offset = max(0, offset)
        clauses: list[str] = []
        params: list[Any] = []
        if effect_id:
            clauses.append("effect_id=?")
            params.append(effect_id)
        if kind:
            clauses.append("kind=?")
            params.append(kind)
        where = f"WHERE {' AND '.join(clauses)} " if clauses else ""
        params.extend([limit, offset])
        rows = await self._db.fetchall(
            f"SELECT * FROM runs {where}ORDER BY created_at DESC LIMIT ? OFFSET ?",
            tuple(params),
        )
        return [RunRecord(**dict(row)) for row in rows]

    async def get_by_id(self, job_id: str) -> RunRecord | None:
        row = await self._db.fetchone("SELECT * FROM runs WHERE id=?", (job_id,))
        if row:
            return RunRecord(**dict(row))
        return None

    async def count(self, effect_id: str | None = None, kind: str | None = None) -> int:
        clauses: list[str] = []
        params: list[Any] = []
        if effect_id:
            clauses.append("effect_id=?")
            params.append(effect_id)
        if kind:
            clauses.append("kind=?")
            params.append(kind)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        row = await self._db.fetchone(f"SELECT COUNT(*) FROM runs {where}", tuple(params))
        return row[0] if row else 0

    async def active_count(self) -> int:
        row = await self._db.fetchone("SELECT COUNT(*) FROM runs WHERE status='processing'")
        return row[0] if row else 0

    async def delete(self, job_id: str) -> None:
        async with self._db.transaction() as conn:
            await conn.execute("DELETE FROM runs WHERE id=?", (job_id,))
