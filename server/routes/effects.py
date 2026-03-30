from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import FileResponse

router = APIRouter()


@router.get("/effects")
async def list_effects(request: Request):
    loader = request.app.state.effect_loader
    effects = loader.get_all()
    return {"effects": [e.model_dump() for e in effects]}


@router.get("/effects/{effect_type}/{effect_name}")
async def get_effect(effect_type: str, effect_name: str, request: Request):
    loader = request.app.state.effect_loader
    effect_id = f"{effect_type}/{effect_name}"
    effect = loader.get_by_id(effect_id)
    if not effect:
        raise HTTPException(status_code=404, detail={"error": "Effect not found", "code": "EFFECT_NOT_FOUND"})
    return effect.model_dump()


@router.get("/effects/{effect_type}/{effect_name}/assets/{filename}")
async def get_effect_asset(effect_type: str, effect_name: str, filename: str, request: Request):
    loader = request.app.state.effect_loader
    effect_id = f"{effect_type}/{effect_name}"
    asset_path = loader.get_asset_path(effect_id, filename)
    if not asset_path:
        raise HTTPException(status_code=404, detail={"error": "Asset not found", "code": "ASSET_NOT_FOUND"})
    return FileResponse(asset_path)
