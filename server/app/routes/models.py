import json
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()


class InstallRequest(BaseModel):
    model_id: str


@router.get("/models")
async def list_models(request: Request):
    model_service = request.app.state.model_service
    config = request.app.state.config_service
    return {"models": model_service.get_available_models(config.get_api_key())}


@router.post("/models/install")
async def install_model(req: InstallRequest, request: Request):
    model_service = request.app.state.model_service
    try:
        install_job_id = await model_service.install(req.model_id)
        return {"install_job_id": install_job_id, "status": "started"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"error": str(e), "code": "INVALID_MODEL"})


@router.get("/models/install/{install_job_id}/stream")
async def stream_install(install_job_id: str, request: Request):
    model_service = request.app.state.model_service

    async def event_stream():
        async for event in model_service.stream_install(install_job_id):
            yield f"event: {event['event']}\ndata: {json.dumps(event['data'])}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive"},
    )
