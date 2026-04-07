import json
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()


class RunRequest(BaseModel):
    effect_id: str
    model_id: str
    provider_id: str  # "fal" or "local"
    inputs: dict[str, str]
    output: dict[str, str | int]
    user_params: dict[str, float | int | str] | None = None


class PlaygroundRunRequest(BaseModel):
    model_id: str
    provider_id: str = "fal"
    prompt: str
    negative_prompt: str = ""
    image_inputs: dict[str, str] = {}  # role -> ref_id
    output: dict[str, str | int] = {}
    user_params: dict[str, float | int | str | bool] = {}


@router.post("/run")
async def start_run(req: RunRequest, request: Request):
    run_service = request.app.state.run_service
    try:
        job_id = await run_service.start(req)
        return {"job_id": job_id, "status": "queued"}
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": str(e), "code": "INVALID_REQUEST"})
    except PermissionError as e:
        raise HTTPException(status_code=401, detail={"error": str(e), "code": "NO_API_KEY"})


@router.post("/playground/run")
async def start_playground_run(req: PlaygroundRunRequest, request: Request):
    run_service = request.app.state.run_service
    try:
        job_id = await run_service.start_playground(req)
        return {"job_id": job_id, "status": "queued"}
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": str(e), "code": "INVALID_REQUEST"})
    except PermissionError as e:
        raise HTTPException(status_code=401, detail={"error": str(e), "code": "NO_API_KEY"})


@router.get("/run/{job_id}/stream")
async def stream_run(job_id: str, request: Request):
    run_service = request.app.state.run_service

    async def event_stream():
        async for event in run_service.stream(job_id):
            yield f"event: {event['event']}\ndata: {json.dumps(event['data'])}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )
