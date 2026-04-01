from pathlib import Path
from fastapi import APIRouter, Request, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from pydantic import BaseModel

router = APIRouter()


class InstallUrlRequest(BaseModel):
    url: str


def _serialize_effect(loaded) -> dict:
    """Serialize a LoadedEffect with pre-resolved asset URLs."""
    data = loaded.manifest.model_dump()
    uuid = Path(loaded.assets_dir).name

    # Pre-resolve asset URLs
    if data.get("assets"):
        if data["assets"].get("preview"):
            data["assets"]["preview"] = f"/api/effects/assets/{uuid}/{data['assets']['preview']}"
        if data["assets"].get("inputs"):
            data["assets"]["inputs"] = {
                key: f"/api/effects/assets/{uuid}/{filename}"
                for key, filename in data["assets"]["inputs"].items()
            }

    data["source"] = loaded.source
    return data


@router.get("/effects")
async def list_effects(request: Request):
    loader = request.app.state.effect_loader
    effects = loader.get_all_with_meta()
    return {"effects": [_serialize_effect(e) for e in effects]}


@router.get("/effects/assets/{uuid}/{filename}")
async def get_effect_asset(uuid: str, filename: str, request: Request):
    loader = request.app.state.effect_loader
    asset_path = loader.get_asset_path(uuid, filename)
    if not asset_path:
        raise HTTPException(status_code=404, detail={"error": "Asset not found", "code": "ASSET_NOT_FOUND"})
    return FileResponse(asset_path)


@router.get("/effects/{namespace}/{effect_id}")
async def get_effect(namespace: str, effect_id: str, request: Request):
    loader = request.app.state.effect_loader
    full_id = f"{namespace}/{effect_id}"
    loaded = loader.get_loaded(full_id)
    if not loaded:
        raise HTTPException(status_code=404, detail={"error": "Effect not found", "code": "EFFECT_NOT_FOUND"})
    return _serialize_effect(loaded)


@router.post("/effects/install")
async def install_effect(request: Request, body: InstallUrlRequest | None = None, file: UploadFile | None = File(None)):
    install_service = request.app.state.install_service
    loader = request.app.state.effect_loader

    try:
        if body and body.url:
            installed = await install_service.install_from_url(body.url)
        elif file and file.filename:
            content = await file.read()
            installed = await install_service.install_from_archive(content)
        else:
            raise HTTPException(status_code=400, detail={"error": "Provide url or file", "code": "INVALID_REQUEST"})

        await loader.reload()
        return {"installed": installed}
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"error": str(e), "code": "INSTALL_ERROR"})


@router.delete("/effects/{namespace}/{effect_id}")
async def uninstall_effect(namespace: str, effect_id: str, request: Request):
    install_service = request.app.state.install_service
    loader = request.app.state.effect_loader

    try:
        await install_service.uninstall(namespace, effect_id)
        await loader.reload()
        return {"ok": True}
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"error": str(e), "code": "UNINSTALL_ERROR"})


@router.post("/effects/{namespace}/{effect_id}/update")
async def update_effect(namespace: str, effect_id: str, request: Request):
    install_service = request.app.state.install_service
    try:
        result = await install_service.check_for_update(namespace, effect_id)
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"error": str(e), "code": "UPDATE_ERROR"})
