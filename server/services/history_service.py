import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from core.states import RunKind, RunStatus
from db.database import Database
from services.file_service import FileService


@dataclass
class RunRecord:
    id: str
    model_id: str
    status: RunStatus
    kind: RunKind = "effect"
    effect_id: str | None = None
    effect_name: str | None = None
    progress: int = 0
    progress_msg: str | None = None
    input_ids: str | None = None        # JSON list of files.id
    output_id: str | None = None
    inputs: str | None = None
    error: str | None = None
    created_at: str = ""
    updated_at: str = ""
    duration_ms: int | None = None
    provider_request_id: str | None = None
    provider_endpoint: str | None = None
    # Result-file metadata (joined from `files` on output_id) — populated
    # by query helpers so the serializer can compose URLs without a second
    # round trip.
    output_ext: str | None = None

    def to_dict(self) -> dict[str, Any]:
        parsed_inputs = None
        if self.inputs:
            try:
                parsed_inputs = json.loads(self.inputs)
            except (json.JSONDecodeError, TypeError):
                parsed_inputs = self.inputs

        # The 512.webp poster is guaranteed to exist whenever an
        # `output_id` is present — every video the file store accepts
        # produces both 512.webp and 1024.webp during ingest.
        video_url: str | None = None
        if self.output_id and self.output_ext:
            video_url = f"/api/files/{self.output_id}/original.{self.output_ext}"

        return {
            "id": self.id,
            "kind": self.kind,
            "effect_id": self.effect_id,
            "effect_name": self.effect_name,
            "model_id": self.model_id,
            "status": self.status,
            "progress": self.progress,
            "progress_msg": self.progress_msg,
            "video_url": video_url,
            "output_id": self.output_id,
            "inputs": parsed_inputs,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "duration_ms": self.duration_ms,
        }


# Columns used everywhere we read a run row that needs to be serialized.
# Keeps the JOIN shape consistent across `get_by_id`, `get_all`, etc.
_RUN_SELECT = (
    "SELECT r.*, f.ext AS output_ext "
    "FROM runs r "
    "LEFT JOIN files f ON f.id = r.output_id "
)


def _row_to_record(row: Any) -> RunRecord:
    """Build a RunRecord from a row that includes the LEFT JOIN column
    `output_ext` (the result file's canonical extension)."""
    data = dict(row)
    return RunRecord(
        id=data["id"],
        model_id=data["model_id"],
        status=data["status"],
        kind=data.get("kind", "effect"),
        effect_id=data.get("effect_id"),
        effect_name=data.get("effect_name"),
        progress=data.get("progress", 0),
        progress_msg=data.get("progress_msg"),
        input_ids=data.get("input_ids"),
        output_id=data.get("output_id"),
        inputs=data.get("inputs"),
        error=data.get("error"),
        created_at=data.get("created_at", ""),
        updated_at=data.get("updated_at", ""),
        duration_ms=data.get("duration_ms"),
        provider_request_id=data.get("provider_request_id"),
        provider_endpoint=data.get("provider_endpoint"),
        output_ext=data.get("output_ext"),
    )


class HistoryService:
    def __init__(self, db: Database):
        self._db = db

    async def close(self) -> None:
        """Kept for API compatibility; the Database lifecycle is owned by the caller."""
        pass

    async def create_processing(
        self,
        job: Any,
        inputs_json: str | None = None,
        input_ids: list[str] | None = None,
        kind: RunKind = "effect",
    ) -> RunRecord:
        """Create a processing run row, bumping `ref_count` on every
        input file in the same transaction. If any input is no longer
        available (tombstoned by the GC reaper while the user was
        composing the request), the whole transaction rolls back —
        we never end up with bumped refs and no run row, or a run row
        whose inputs got reaped under it."""
        now = datetime.now(timezone.utc).isoformat()
        ids_json = json.dumps(input_ids) if input_ids else None
        async with self._db.transaction() as conn:
            for fid in input_ids or []:
                try:
                    await FileService.bump_ref_in_tx(conn, fid)
                except ValueError:
                    raise ValueError(
                        f"Input file {fid[:8]}… is no longer available"
                    ) from None
            await conn.execute(
                """INSERT INTO runs (
                       id, kind, effect_id, effect_name, model_id,
                       status, progress, progress_msg, input_ids,
                       inputs, created_at, updated_at
                   ) VALUES (?, ?, ?, ?, ?, 'processing', 0, 'Starting...', ?, ?, ?, ?)""",
                (job.job_id, kind, job.effect_id, job.effect_name, job.model_id,
                 ids_json, inputs_json, now, now),
            )
        return RunRecord(
            id=job.job_id, kind=kind, effect_id=job.effect_id, effect_name=job.effect_name,
            model_id=job.model_id, status="processing", inputs=inputs_json,
            input_ids=ids_json, created_at=now, updated_at=now,
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
            f"{_RUN_SELECT} WHERE r.status='processing' AND r.provider_request_id IS NOT NULL"
        )
        return [_row_to_record(row) for row in rows]

    async def complete(self, job_id: str, output_id: str, duration_ms: int) -> None:
        """Mark a run completed and bump `ref_count` on the output
        file in the same transaction. `output_id` may be the empty
        string when the result download failed — in that case we
        store NULL and skip the bump.

        If the bump fails (the just-ingested output was somehow
        tombstoned in the microseconds between `add_file` and now),
        the transaction rolls back and the run stays at processing —
        the caller can then mark it failed."""
        now = datetime.now(timezone.utc).isoformat()
        normalized_id = output_id or None
        async with self._db.transaction() as conn:
            if normalized_id:
                try:
                    await FileService.bump_ref_in_tx(conn, normalized_id)
                except ValueError:
                    raise ValueError(
                        f"Output file {normalized_id[:8]}… is no longer available"
                    ) from None
            await conn.execute(
                """UPDATE runs
                   SET status='completed', output_id=?, duration_ms=?,
                       progress=100, progress_msg=NULL, updated_at=?
                   WHERE id=?""",
                (normalized_id, duration_ms, now, job_id),
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
        kind: RunKind | None = None,
        status: RunStatus | None = None,
    ) -> list[RunRecord]:
        limit = max(1, min(limit, 1000))
        offset = max(0, offset)
        clauses: list[str] = []
        params: list[Any] = []
        if effect_id:
            clauses.append("r.effect_id=?")
            params.append(effect_id)
        if kind:
            clauses.append("r.kind=?")
            params.append(kind)
        if status:
            clauses.append("r.status=?")
            params.append(status)
        where = f"WHERE {' AND '.join(clauses)} " if clauses else ""
        params.extend([limit, offset])
        rows = await self._db.fetchall(
            f"{_RUN_SELECT} {where}ORDER BY r.created_at DESC LIMIT ? OFFSET ?",
            tuple(params),
        )
        return [_row_to_record(row) for row in rows]

    async def get_by_id(self, job_id: str) -> RunRecord | None:
        row = await self._db.fetchone(f"{_RUN_SELECT} WHERE r.id=?", (job_id,))
        if row:
            return _row_to_record(row)
        return None

    async def count(self, effect_id: str | None = None, kind: RunKind | None = None) -> int:
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
        """Delete a run row and decrement `ref_count` on every file
        it referenced (`input_ids` + `output_id`) in the same
        transaction. Without this atomic pairing a crash between the
        DELETE and a separate decrement would strand input/output
        files at `ref_count > 0` forever — the orphan reaper would
        never touch them."""
        async with self._db.transaction() as conn:
            cursor = await conn.execute(
                "SELECT input_ids, output_id FROM runs WHERE id = ?",
                (job_id,),
            )
            row = await cursor.fetchone()
            if row is None:
                return  # idempotent — nothing to delete

            ids: list[str] = []
            if row["input_ids"]:
                try:
                    parsed = json.loads(row["input_ids"])
                    if isinstance(parsed, list):
                        ids.extend(i for i in parsed if isinstance(i, str) and i)
                except (json.JSONDecodeError, TypeError):
                    pass
            if row["output_id"]:
                ids.append(row["output_id"])

            await conn.execute("DELETE FROM runs WHERE id = ?", (job_id,))

            for fid in ids:
                await FileService.drop_ref_in_tx(conn, fid)
