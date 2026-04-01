import json
import shutil
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import FileResponse
from config.settings import get_settings

router = APIRouter()


@router.get("/generations")
async def get_generations(request: Request, limit: int = 50, offset: int = 0):
    history = request.app.state.history_service
    items = await history.get_all(limit=limit, offset=offset)
    total = await history.count()
    active_count = await history.active_count()
    return {
        "items": [item.to_dict() for item in items],
        "total": total,
        "active_count": active_count,
    }


@router.get("/generations/{item_id}")
async def get_generation(item_id: str, request: Request):
    history = request.app.state.history_service
    record = await history.get_by_id(item_id)
    if not record:
        raise HTTPException(status_code=404, detail={"error": "Record not found", "code": "NOT_FOUND"})
    return record.to_dict()


@router.get("/generations/{item_id}/result")
async def get_generation_result(item_id: str, request: Request):
    history = request.app.state.history_service
    record = await history.get_by_id(item_id)
    if not record:
        raise HTTPException(status_code=404, detail={"error": "Record not found", "code": "NOT_FOUND"})

    settings = get_settings()
    result_path = settings.user_data_dir / "generations" / item_id / "result.mp4"
    if not result_path.exists():
        raise HTTPException(status_code=404, detail={"error": "Result file not found", "code": "FILE_NOT_FOUND"})

    return FileResponse(result_path, media_type="video/mp4")


@router.delete("/generations/{item_id}")
async def delete_generation(item_id: str, request: Request):
    history = request.app.state.history_service
    record = await history.get_by_id(item_id)
    if not record:
        raise HTTPException(status_code=404, detail={"error": "Record not found", "code": "NOT_FOUND"})
    if record.status == "processing":
        raise HTTPException(status_code=409, detail={"error": "Cannot delete a processing record", "code": "CONFLICT"})

    # Extract upload hashes from manifest_json and decrement refs
    storage = request.app.state.storage_service
    ref_ids: list[str] = []
    if record.manifest_json:
        try:
            manifest_data = json.loads(record.manifest_json)
            inputs = manifest_data.get("request", {}).get("inputs", {})
            effect_data = manifest_data.get("effect", {})
            effect_inputs = effect_data.get("inputs", {})
            for key, value in inputs.items():
                input_def = effect_inputs.get(key, {})
                input_type = input_def.get("type", "") if isinstance(input_def, dict) else ""
                if input_type == "image" and isinstance(value, str):
                    ref_ids.append(value)
        except (json.JSONDecodeError, TypeError, AttributeError):
            pass

    if ref_ids:
        await storage.decrement_refs_and_cleanup(ref_ids)

    await history.delete(item_id)

    # Clean up the generation folder
    settings = get_settings()
    gen_folder = settings.user_data_dir / "generations" / item_id
    if gen_folder.exists():
        shutil.rmtree(gen_folder)

    return {"ok": True}
