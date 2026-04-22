from fastapi import APIRouter, Request

router = APIRouter()


@router.get("/models")
async def list_models(request: Request):
    model_service = request.app.state.model_service
    config = request.app.state.config_service
    return {"models": model_service.get_available_models(await config.get_api_key())}
