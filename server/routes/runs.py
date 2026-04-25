import json

from fastapi import APIRouter, Request

from routes._errors import conflict, not_found

router = APIRouter()


@router.get("/runs")
async def get_runs(
    request: Request,
    limit: int = 50,
    offset: int = 0,
    effect_id: str | None = None,
    kind: str | None = None,
    status: str | None = None,
):
    history = request.app.state.history_service
    items = await history.get_all(
        limit=limit, offset=offset, effect_id=effect_id, kind=kind, status=status,
    )
    total = await history.count(effect_id=effect_id, kind=kind)
    active_count = await history.active_count()
    return {
        "items": [item.to_dict() for item in items],
        "total": total,
        "active_count": active_count,
    }


@router.get("/runs/{item_id}")
async def get_run(item_id: str, request: Request):
    history = request.app.state.history_service
    record = await history.get_by_id(item_id)
    if not record:
        raise not_found("Record not found")
    return record.to_dict()


@router.delete("/runs/{item_id}")
async def delete_run(item_id: str, request: Request):
    """Delete a run and decrement refs on every file it referenced.
    The record's `input_ids` array tracks inputs explicitly; the output
    is on `output_id`. Files dropped to ref_count=0 get swept by the
    file reaper on its next cycle."""
    history = request.app.state.history_service
    record = await history.get_by_id(item_id)
    if not record:
        raise not_found("Record not found")
    if record.status == "processing":
        raise conflict("Cannot delete a processing record")

    files_service = request.app.state.file_service

    ids: list[str] = []
    if record.input_ids:
        try:
            parsed = json.loads(record.input_ids)
            if isinstance(parsed, list):
                ids.extend(i for i in parsed if isinstance(i, str) and i)
        except (json.JSONDecodeError, TypeError):
            pass
    if record.output_id:
        ids.append(record.output_id)

    # Delete DB record first, then drop refs (best-effort).
    await history.delete(item_id)

    try:
        if ids:
            await files_service.decrement_refs(ids)
    except Exception:
        pass  # ref cleanup is best-effort — record is already deleted
    return {"ok": True}
