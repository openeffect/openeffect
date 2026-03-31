import asyncio
import os
import fal_client
from typing import AsyncIterator, Any
from providers.base import BaseProvider, ProviderInput, ProviderEvent


# Aspect ratio → (width, height) for models that use pixel dimensions
RATIO_TO_RESOLUTION: dict[str, tuple[int, int]] = {
    "9:16": (480, 832),
    "16:9": (832, 480),
    "1:1": (640, 640),
}

MODEL_CONFIG: dict[str, dict[str, Any]] = {
    "wan-2.2": {
        "i2v_endpoint": "fal-ai/wan/v2.2-a14b/image-to-video",
        "t2v_endpoint": "fal-ai/wan/v2.2-a14b/text-to-video",
        "role_params": {
            "start_frame": "image_url",
        },
        "output_translation": {
            "aspect_ratio": "resolution",
            "duration": "num_frames",
        },
        "fps": 16,
    },
    "kling-v3": {
        "i2v_endpoint": "fal-ai/kling-video/v3/pro/image-to-video",
        "t2v_endpoint": "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
        "role_params": {
            "start_frame": "image_url",
            "end_frame": "tail_image_url",
        },
        "output_translation": {
            "aspect_ratio": "passthrough",
            "duration": "passthrough",
        },
    },
}


class FalProvider(BaseProvider):
    def __init__(self, api_key: str):
        self._api_key = api_key

    def _apply_output_params(self, arguments: dict[str, Any], input: ProviderInput, config: dict[str, Any]) -> None:
        translation = config.get("output_translation", {})
        for key, value in input.output.items():
            mode = translation.get(key, "passthrough")
            if mode == "passthrough":
                arguments[key] = value
            elif mode == "resolution" and key == "aspect_ratio":
                w, h = RATIO_TO_RESOLUTION.get(str(value), (640, 640))
                arguments["width"] = w
                arguments["height"] = h
            elif mode == "num_frames" and key == "duration":
                fps = int(input.parameters.get("fps", config.get("fps", 16)))
                arguments["num_frames"] = int(value) * fps
                arguments["fps"] = fps

    async def generate(self, input: ProviderInput) -> AsyncIterator[ProviderEvent]:
        os.environ["FAL_KEY"] = self._api_key

        model_id = input.parameters.get("_model_id", "wan-2.2")
        config = MODEL_CONFIG.get(model_id, MODEL_CONFIG["wan-2.2"])

        endpoint = config["i2v_endpoint"] if input.image_inputs else config["t2v_endpoint"]

        arguments: dict[str, Any] = {
            "prompt": input.prompt,
            **{k: v for k, v in input.parameters.items() if not k.startswith("_")},
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

        # Submit job (non-blocking)
        yield ProviderEvent(type="progress", progress=10, message="Submitting to fal.ai...")
        handle = await fal_client.submit_async(endpoint, arguments=arguments)

        # Yield the request_id so it can be stored for crash recovery
        yield ProviderEvent(
            type="submitted",
            request_id=handle.request_id,
            endpoint=endpoint,
        )

        # Poll for status
        yield ProviderEvent(type="progress", progress=15, message="Waiting for fal.ai...")

        try:
            while True:
                status = await handle.status()

                if isinstance(status, fal_client.Queued):
                    pos = status.position
                    msg = f"In queue (position {pos})..." if pos > 0 else "Starting generation..."
                    yield ProviderEvent(type="progress", progress=20, message=msg)
                elif isinstance(status, fal_client.InProgress):
                    logs = status.logs or []
                    msg = logs[-1].get("message", "Generating...") if logs else "Generating..."
                    yield ProviderEvent(type="progress", progress=50, message=msg)
                elif isinstance(status, fal_client.Completed):
                    break

                await asyncio.sleep(1)

            result = await handle.get()

            if isinstance(result, dict) and "video" in result:
                video_url = result["video"].get("url", "") if isinstance(result["video"], dict) else result["video"]
                yield ProviderEvent(type="completed", video_url=video_url)
            else:
                yield ProviderEvent(type="failed", error="Unexpected response from fal.ai")
        except Exception as e:
            yield ProviderEvent(type="failed", error=str(e))

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
                # Still running — wait for it
                result = await handle.get()
                if isinstance(result, dict) and "video" in result:
                    video_url = result["video"].get("url", "") if isinstance(result["video"], dict) else result["video"]
                    return ProviderEvent(type="completed", video_url=video_url)
                return ProviderEvent(type="failed", error="Unexpected response from fal.ai")
            else:
                return ProviderEvent(type="failed", error="Unknown job status")
        except Exception as e:
            return ProviderEvent(type="failed", error=str(e))
