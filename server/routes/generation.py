import json
from fastapi import APIRouter, Request, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

router = APIRouter()


class GenerationRequest(BaseModel):
    effect_id: str
    model_id: str
    inputs: dict[str, str]
    output: dict[str, str | int]
    user_params: dict[str, float | int | str] | None = None


@router.post("/generate")
async def start_generation(req: GenerationRequest, request: Request):
    gen_service = request.app.state.generation_service
    try:
        job_id = await gen_service.start(req)
        return {"job_id": job_id, "status": "queued"}
    except ValueError as e:
        raise HTTPException(status_code=422, detail={"error": str(e), "code": "INVALID_REQUEST"})
    except PermissionError as e:
        raise HTTPException(status_code=401, detail={"error": str(e), "code": "NO_API_KEY"})


@router.get("/generate/{job_id}/stream")
async def stream_generation(job_id: str, request: Request):
    gen_service = request.app.state.generation_service

    async def event_stream():
        async for event in gen_service.stream(job_id):
            yield f"event: {event['event']}\ndata: {json.dumps(event['data'])}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )
