import asyncio
import os
import fal_client
from typing import AsyncIterator, Any
from providers.base import BaseProvider, ProviderInput, ProviderEvent
from services.model_service import get_fal_config


class FalProvider(BaseProvider):
    def __init__(self, api_key: str):
        self._api_key = api_key

    def _apply_output_params(self, arguments: dict[str, Any], input: ProviderInput, config: dict[str, Any]) -> None:
        translation = config.get("output_translation", {})
        for key, value in input.output.items():
            if value == "" or value is None:
                continue
            mode = translation.get(key, "passthrough")
            if mode == "passthrough":
                arguments[key] = value
            elif mode == "num_frames" and key == "duration":
                fps = int(input.parameters.get("fps", config.get("fps", 16)))
                arguments["num_frames"] = int(value) * fps
                arguments["fps"] = fps

    async def generate(self, input: ProviderInput) -> AsyncIterator[ProviderEvent]:
        os.environ["FAL_KEY"] = self._api_key

        model_id = input.parameters.get("_model_id", "wan-2.2")
        config = get_fal_config(model_id)
        if not config:
            yield ProviderEvent(type="failed", error=f"No fal.ai config for model {model_id}")
            return

        endpoint = config["i2v_endpoint"] if input.image_inputs else config["t2v_endpoint"]

        arguments: dict[str, Any] = {
            "prompt": input.prompt,
            **{k: v for k, v in input.parameters.items() if not k.startswith("_") and v != "" and v is not None},
        }

        if input.negative_prompt:
            arguments["negative_prompt"] = input.negative_prompt

        self._apply_output_params(arguments, input, config)

        # Upload images
        yield ProviderEvent(type="progress", progress=5, message="Uploading images...")
        role_params = config.get("role_params", {})
        for role, local_path in input.image_inputs.items():
            param_name = role_params.get(role)
            if param_name:
                url = await fal_client.upload_file_async(local_path)
                arguments[param_name] = url

        yield ProviderEvent(type="progress", progress=10, message="Submitting to fal.ai...")

        # Use subscribe_async with queue-based event bridging
        event_queue: asyncio.Queue[ProviderEvent | None] = asyncio.Queue()
        request_id_holder: list[str] = []

        async def on_enqueue(request_id: str) -> None:
            request_id_holder.append(request_id)
            await event_queue.put(ProviderEvent(
                type="submitted",
                request_id=request_id,
                endpoint=endpoint,
            ))

        async def on_queue_update(update: Any) -> None:
            if isinstance(update, fal_client.Queued):
                pos = update.position
                msg = f"In queue (position {pos})..." if pos > 0 else "Starting run..."
                await event_queue.put(ProviderEvent(type="progress", progress=20, message=msg))
            elif isinstance(update, fal_client.InProgress):
                logs = update.logs or []
                if logs:
                    msg = logs[-1].get("message", "Generating...")
                else:
                    msg = "Generating..."
                await event_queue.put(ProviderEvent(type="progress", progress=50, message=msg))

        async def run_subscribe() -> None:
            try:
                result = await fal_client.subscribe_async(
                    endpoint,
                    arguments=arguments,
                    with_logs=True,
                    on_enqueue=on_enqueue,
                    on_queue_update=on_queue_update,
                )
                if isinstance(result, dict) and "video" in result:
                    video_url = result["video"].get("url", "") if isinstance(result["video"], dict) else result["video"]
                    await event_queue.put(ProviderEvent(type="completed", video_url=video_url))
                else:
                    await event_queue.put(ProviderEvent(type="failed", error="Unexpected response from fal.ai"))
            except Exception as e:
                await event_queue.put(ProviderEvent(type="failed", error=str(e)))
            finally:
                await event_queue.put(None)  # sentinel

        # Run subscribe in background, yield events as they come
        task = asyncio.create_task(run_subscribe())

        try:
            while True:
                event = await event_queue.get()
                if event is None:
                    break
                yield event
                if event.type in ("completed", "failed"):
                    break
        finally:
            if not task.done():
                task.cancel()

    @staticmethod
    async def recover(api_key: str, request_id: str, endpoint: str) -> ProviderEvent:
        """Recover a job by its request_id. Returns completed or failed event."""
        os.environ["FAL_KEY"] = api_key
        try:
            handle = fal_client.AsyncRequestHandle(request_id=request_id, app_id=endpoint)
            status = await handle.status()

            if isinstance(status, fal_client.Completed):
                result = await handle.get()
                if isinstance(result, dict) and "video" in result:
                    video_url = result["video"].get("url", "") if isinstance(result["video"], dict) else result["video"]
                    return ProviderEvent(type="completed", video_url=video_url)
                return ProviderEvent(type="failed", error="Unexpected response from fal.ai")
            elif isinstance(status, (fal_client.Queued, fal_client.InProgress)):
                result = await handle.get()
                if isinstance(result, dict) and "video" in result:
                    video_url = result["video"].get("url", "") if isinstance(result["video"], dict) else result["video"]
                    return ProviderEvent(type="completed", video_url=video_url)
                return ProviderEvent(type="failed", error="Unexpected response from fal.ai")
            else:
                return ProviderEvent(type="failed", error="Unknown job status")
        except Exception as e:
            return ProviderEvent(type="failed", error=str(e))
