from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter()


class ConfigPatch(BaseModel):
    fal_api_key: str | None = None
    default_model: str | None = None
    theme: str | None = None
    history_limit: int | None = None


@router.get("/config")
async def get_config(request: Request):
    config = request.app.state.config_service
    model_service = request.app.state.model_service
    settings = request.app.state.settings

    public = config.get_public_config()
    public["available_models"] = model_service.get_available_models(config.get_api_key())
    public["update_available"] = settings.update_version or None
    return public


@router.patch("/config")
async def update_config(patch: ConfigPatch, request: Request):
    config = request.app.state.config_service
    updates = {k: v for k, v in patch.model_dump().items() if v is not None}
    return config.update(updates)
