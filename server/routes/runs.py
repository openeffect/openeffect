from fastapi import APIRouter, Request

from routes._errors import ErrorCode, conflict, not_found

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
    serialized = await history.serialize_many(items)
    total = await history.count(effect_id=effect_id, kind=kind)
    active_count = await history.active_count()
    return {
        "runs": serialized,
        "total": total,
        "active_count": active_count,
    }


@router.get("/runs/{run_id}")
async def get_run(run_id: str, request: Request):
    history = request.app.state.history_service
    record = await history.get_by_id(run_id)
    if not record:
        raise not_found("Record not found", ErrorCode.RUN_NOT_FOUND)
    return await history.serialize(record)


@router.delete("/runs/{run_id}")
async def delete_run(run_id: str, request: Request):
    """Delete a run row and decrement refs on every file it
    referenced. Both the row delete and the ref decrements happen
    inside `history.delete`'s transaction so a crash can't leave
    files with phantom refs from a now-gone run."""
    history = request.app.state.history_service
    record = await history.get_by_id(run_id)
    if not record:
        raise not_found("Record not found", ErrorCode.RUN_NOT_FOUND)
    if record.status == "processing":
        raise conflict("Cannot delete a processing record")

    await history.delete(run_id)
    return {"ok": True}
