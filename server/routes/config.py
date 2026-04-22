from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter()


class ConfigPatch(BaseModel):
    model_config = {"extra": "forbid"}
    fal_api_key: str | None = None
    theme: str | None = None


async def _public_config(request: Request) -> dict:
    config = request.app.state.config_service
    model_service = request.app.state.model_service
    settings = request.app.state.settings

    public = await config.get_public_config()
    public["available_models"] = model_service.get_available_models(await config.get_api_key())
    public["update_available"] = settings.update_version or None
    return public


@router.get("/config")
async def get_config(request: Request):
    return await _public_config(request)


@router.patch("/config")
async def update_config(patch: ConfigPatch, request: Request):
    config = request.app.state.config_service
    updates = {k: v for k, v in patch.model_dump().items() if v is not None}
    await config.update(updates)
    return await _public_config(request)
