import json
import shutil
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import FileResponse
from config.settings import get_settings

router = APIRouter()


@router.get("/runs")
async def get_runs(request: Request, limit: int = 50, offset: int = 0, effect_id: str | None = None):
    history = request.app.state.history_service
    items = await history.get_all(limit=limit, offset=offset, effect_id=effect_id)
    total = await history.count(effect_id=effect_id)
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
        raise HTTPException(status_code=404, detail={"error": "Record not found", "code": "NOT_FOUND"})
    return record.to_dict()


@router.get("/runs/{item_id}/result")
async def get_run_result(item_id: str, request: Request):
    history = request.app.state.history_service
    record = await history.get_by_id(item_id)
    if not record:
        raise HTTPException(status_code=404, detail={"error": "Record not found", "code": "NOT_FOUND"})

    settings = get_settings()
    result_path = settings.user_data_dir / "runs" / item_id / "result.mp4"
    if not result_path.exists():
        raise HTTPException(status_code=404, detail={"error": "Result file not found", "code": "FILE_NOT_FOUND"})

    return FileResponse(result_path, media_type="video/mp4")


@router.delete("/runs/{item_id}")
async def delete_run(item_id: str, request: Request):
    history = request.app.state.history_service
    record = await history.get_by_id(item_id)
    if not record:
        raise HTTPException(status_code=404, detail={"error": "Record not found", "code": "NOT_FOUND"})
    if record.status == "processing":
        raise HTTPException(status_code=409, detail={"error": "Cannot delete a processing record", "code": "CONFLICT"})

    # Extract upload ref_ids from inputs and decrement refs
    storage = request.app.state.storage_service
    ref_ids: list[str] = []
    if record.inputs:
        try:
            raw = json.loads(record.inputs)
            # Support both structured format {"inputs": {...}} and flat format {...}
            inputs_data = raw.get("inputs", raw) if isinstance(raw, dict) else raw
            # Look up the effect manifest to determine which inputs are images
            loader = request.app.state.effect_loader
            loaded = loader.get_by_db_id(record.effect_id) or loader.get_loaded(record.effect_id)
            manifest = loaded.manifest if loaded else None
            if manifest:
                for key, field in manifest.inputs.items():
                    if field.type == "image" and key in inputs_data:
                        ref_ids.append(inputs_data[key])
        except (json.JSONDecodeError, TypeError, AttributeError):
            pass

    # Delete DB record first, then clean up files (best-effort)
    await history.delete(item_id)

    try:
        if ref_ids:
            await storage.decrement_refs_and_cleanup(ref_ids)
    except Exception:
        pass  # Ref cleanup is best-effort — record is already deleted

    settings = get_settings()
    run_folder = settings.user_data_dir / "runs" / item_id
    if run_folder.exists():
        shutil.rmtree(run_folder, ignore_errors=True)

    return {"ok": True}
