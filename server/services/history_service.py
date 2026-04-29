import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from core.states import RunKind, RunStatus
from db.database import Database
from schemas.file_ref import FileRef, build_file_ref
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
    payload: str | None = None          # JSON: {record_version, inputs, model_inputs?, params}
    error: str | None = None
    created_at: str = ""
    updated_at: str = ""
    duration_ms: int | None = None
    provider_request_id: str | None = None
    provider_endpoint: str | None = None

    def to_dict(self, file_refs: dict[str, FileRef] | None = None) -> dict[str, Any]:
        """Serialize for the API. `file_refs` maps file_id → FileRef and
        is the result of a batched JOIN done by HistoryService. Pass None
        for paths that don't need file resolution (e.g., the recovery
        path that only reads `provider_request_id` / `provider_endpoint`)
        - output and input_files come back empty in that case."""
        refs = file_refs or {}

        parsed_payload: Any = None
        if self.payload:
            try:
                parsed_payload = json.loads(self.payload)
            except (json.JSONDecodeError, TypeError):
                parsed_payload = self.payload

        # input_files: keys are the input role (start_frame, end_frame, etc.);
        # values are FileRefs. Effect runs carry both a role-keyed `model_inputs`
        # (canonical, what was sent to the model) and a form-keyed `inputs` (the
        # manifest field values, kept for "Open in form" restore). Picking
        # `model_inputs` first avoids surfacing the same image twice. Playground
        # runs only carry `inputs`, already role-keyed.
        input_files: dict[str, dict[str, Any]] = {}
        if isinstance(parsed_payload, dict):
            section: dict[str, Any] | None = None
            mi = parsed_payload.get("model_inputs")
            if isinstance(mi, dict):
                section = mi
            elif isinstance(parsed_payload.get("inputs"), dict):
                section = parsed_payload["inputs"]
            if section is not None:
                for k, v in section.items():
                    if isinstance(v, str) and v in refs:
                        input_files[k] = refs[v].model_dump()

        output: dict[str, Any] | None = None
        if self.output_id and self.output_id in refs:
            output = refs[self.output_id].model_dump()

        return {
            "id": self.id,
            "kind": self.kind,
            "effect_id": self.effect_id,
            "effect_name": self.effect_name,
            "model_id": self.model_id,
            "status": self.status,
            "progress": self.progress,
            "progress_msg": self.progress_msg,
            "output": output,
            "input_files": input_files,
            "payload": parsed_payload,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "duration_ms": self.duration_ms,
        }


# `r.*` is enough - file metadata comes via the batched lookup in
# `_resolve_files`, not a per-row LEFT JOIN.
_RUN_SELECT = "SELECT r.* FROM runs r "


def _row_to_record(row: Any) -> RunRecord:
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
        payload=data.get("payload"),
        error=data.get("error"),
        created_at=data.get("created_at", ""),
        updated_at=data.get("updated_at", ""),
        duration_ms=data.get("duration_ms"),
        provider_request_id=data.get("provider_request_id"),
        provider_endpoint=data.get("provider_endpoint"),
    )


class HistoryService:
    def __init__(self, db: Database):
        self._db = db

    async def close(self) -> None:
        """Kept for API compatibility; the Database lifecycle is owned by the caller."""
        pass

    async def _resolve_files(
        self, records: list[RunRecord],
    ) -> dict[str, FileRef]:
        """Single SELECT to fetch every file row referenced by any record
        in the page (output_id + each row's input_ids[]). Returns a
        `file_id → FileRef` lookup the records can hand to `to_dict`.

        Replaces the per-row LEFT JOIN we used to do in `_RUN_SELECT` -
        we now need full file metadata (kind, mime, ext, size) for both
        the output AND each input, so doing it in one batched query
        keeps the list endpoint at O(2) DB calls regardless of page
        size or input fan-out."""
        all_ids: set[str] = set()
        for record in records:
            if record.output_id:
                all_ids.add(record.output_id)
            if record.input_ids:
                try:
                    arr = json.loads(record.input_ids)
                    if isinstance(arr, list):
                        all_ids.update(s for s in arr if isinstance(s, str))
                except (json.JSONDecodeError, TypeError):
                    pass

        if not all_ids:
            return {}

        placeholders = ",".join("?" * len(all_ids))
        rows = await self._db.fetchall(
            f"SELECT id, kind, mime, ext, size FROM files WHERE id IN ({placeholders})",
            tuple(all_ids),
        )
        return {
            row["id"]: build_file_ref(
                id=row["id"], kind=row["kind"], mime=row["mime"],
                ext=row["ext"], size=row["size"],
            )
            for row in rows
        }

    async def serialize(self, record: RunRecord) -> dict[str, Any]:
        """Convenience for single-record callers: resolve files then `to_dict`."""
        refs = await self._resolve_files([record])
        return record.to_dict(refs)

    async def serialize_many(self, records: list[RunRecord]) -> list[dict[str, Any]]:
        """Convenience for paginated callers: one batched lookup, all records."""
        refs = await self._resolve_files(records)
        return [r.to_dict(refs) for r in records]

    async def create_processing(
        self,
        job: Any,
        payload_json: str | None = None,
        input_ids: list[str] | None = None,
        kind: RunKind = "effect",
    ) -> RunRecord:
        """Create a processing run row, bumping `ref_count` on every
        input file in the same transaction. If any input is no longer
        available (tombstoned by the GC reaper while the user was
        composing the request), the whole transaction rolls back -
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
                       payload, created_at, updated_at
                   ) VALUES (?, ?, ?, ?, ?, 'processing', 0, 'Starting...', ?, ?, ?, ?)""",
                (job.job_id, kind, job.effect_id, job.effect_name, job.model_id,
                 ids_json, payload_json, now, now),
            )
        return RunRecord(
            id=job.job_id, kind=kind, effect_id=job.effect_id, effect_name=job.effect_name,
            model_id=job.model_id, status="processing", payload=payload_json,
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
        string when the result download failed - in that case we
        store NULL and skip the bump.

        If the bump fails (the just-ingested output was somehow
        tombstoned in the microseconds between `add_file` and now),
        the transaction rolls back and the run stays at processing -
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
        files at `ref_count > 0` forever - the orphan reaper would
        never touch them."""
        async with self._db.transaction() as conn:
            cursor = await conn.execute(
                "SELECT input_ids, output_id FROM runs WHERE id = ?",
                (job_id,),
            )
            row = await cursor.fetchone()
            if row is None:
                return  # idempotent - nothing to delete

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
