from fastapi import APIRouter, Request, HTTPException

router = APIRouter()


@router.get("/history")
async def get_history(request: Request, limit: int = 50, offset: int = 0):
    history = request.app.state.history_service
    items = await history.get_all(limit=limit, offset=offset)
    total = await history.count()
    active_count = await history.active_count()
    return {
        "items": [item.to_dict() for item in items],
        "total": total,
        "active_count": active_count,
    }


@router.delete("/history/{item_id}")
async def delete_history(item_id: str, request: Request):
    history = request.app.state.history_service
    record = await history.get_by_id(item_id)
    if not record:
        raise HTTPException(status_code=404, detail={"error": "Record not found", "code": "NOT_FOUND"})
    if record.status == "processing":
        raise HTTPException(status_code=409, detail={"error": "Cannot delete a processing record", "code": "CONFLICT"})
    await history.delete(item_id)
    return {"ok": True}
