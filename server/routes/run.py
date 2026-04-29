import json

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from routes._errors import ErrorCode, unauthorized, unprocessable
from schemas.run import PlaygroundRunRequest, RunRequest

router = APIRouter()


@router.post("/run")
async def start_run(req: RunRequest, request: Request):
    run_service = request.app.state.run_service
    history = request.app.state.history_service
    try:
        run_id = await run_service.start(req)
        record = await history.get_by_id(run_id)
        serialized = await history.serialize(record) if record else None
        return {"run_id": run_id, "record": serialized}
    except ValueError as e:
        raise unprocessable(str(e), ErrorCode.INVALID_REQUEST)
    except PermissionError as e:
        raise unauthorized(str(e), ErrorCode.NO_API_KEY)


@router.post("/playground/run")
async def start_playground_run(req: PlaygroundRunRequest, request: Request):
    run_service = request.app.state.run_service
    history = request.app.state.history_service
    try:
        run_id = await run_service.start_playground(req)
        record = await history.get_by_id(run_id)
        serialized = await history.serialize(record) if record else None
        return {"run_id": run_id, "record": serialized}
    except ValueError as e:
        raise unprocessable(str(e), ErrorCode.INVALID_REQUEST)
    except PermissionError as e:
        raise unauthorized(str(e), ErrorCode.NO_API_KEY)


@router.get("/runs/stream")
async def stream_runs(request: Request):
    """Multiplexed SSE — one connection, all in-flight runs. Each `data`
    payload carries its own `run_id` so the client can route events to
    the right store entry. The client holds this open for as long as it's
    tracking any run and closes it when its tracked set empties."""
    run_service = request.app.state.run_service

    async def event_stream():
        async for event in run_service.stream_all():
            yield f"event: {event['event']}\ndata: {json.dumps(event['data'])}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "Connection": "keep-alive", "X-Accel-Buffering": "no"},
    )
