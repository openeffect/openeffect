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
        "aspect_ratios": ["9:16", "16:9", "1:1"],
        "durations": [3, 5],
        # Wan uses width/height and num_frames, not aspect_ratio/duration
        "output_translation": {
            "aspect_ratio": "resolution",   # translate to width+height
            "duration": "num_frames",        # translate seconds → frames (fps=16)
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
        "aspect_ratios": ["9:16", "16:9", "1:1"],
        "durations": [5, 10],
        # Kling accepts these directly
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
        """Translate output params into model-specific API params."""
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
                # fps comes from user's advanced settings or model default
                fps = int(input.parameters.get("fps", config.get("fps", 16)))
                arguments["num_frames"] = int(value) * fps
                arguments["fps"] = fps

    async def generate(self, input: ProviderInput) -> AsyncIterator[ProviderEvent]:
        os.environ["FAL_KEY"] = self._api_key

        model_id = input.parameters.get("_model_id", "wan-2.2")
        config = MODEL_CONFIG.get(model_id, MODEL_CONFIG["wan-2.2"])

        # Determine endpoint
        if input.image_inputs:
            endpoint = config["i2v_endpoint"]
        else:
            endpoint = config["t2v_endpoint"]

        arguments: dict[str, Any] = {
            "prompt": input.prompt,
            **{k: v for k, v in input.parameters.items() if not k.startswith("_")},
        }

        if input.negative_prompt:
            arguments["negative_prompt"] = input.negative_prompt

        # Apply output params with model-specific translation
        self._apply_output_params(arguments, input, config)

        # Upload images and map roles to API params
        yield ProviderEvent(type="progress", progress=5, message="Uploading images...")
        role_params = config.get("role_params", {})
        for role, local_path in input.image_inputs.items():
            param_name = role_params.get(role)
            if param_name:
                url = await fal_client.upload_file_async(local_path)
                arguments[param_name] = url

        yield ProviderEvent(type="progress", progress=15, message="Generating video...")

        try:
            result = await fal_client.subscribe_async(
                endpoint,
                arguments=arguments,
                with_logs=True,
            )

            if isinstance(result, dict) and "video" in result:
                video_url = result["video"].get("url", "") if isinstance(result["video"], dict) else result["video"]
                yield ProviderEvent(type="completed", video_url=video_url)
            else:
                yield ProviderEvent(type="failed", error="Unexpected response from fal.ai")
        except Exception as e:
            yield ProviderEvent(type="failed", error=str(e))
