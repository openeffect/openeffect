import os
import fal_client
from typing import AsyncIterator, Any
from providers.base import BaseProvider, ProviderInput, ProviderEvent


class FalProvider(BaseProvider):
    ENDPOINTS = {
        "fal-ai/wan-2.2": "fal-ai/wan/v2.2-a14b/image-to-video",
        "fal-ai/kling-v3": "fal-ai/kling-video/v3/pro/image-to-video",
        "fal-ai/wan-2.2/t2v": "fal-ai/wan/v2.2-a14b/text-to-video",
        "fal-ai/kling-v3/t2v": "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
    }

    def __init__(self, api_key: str):
        self._api_key = api_key

    def _get_endpoint(self, model_id: str, effect_type: str) -> str:
        if effect_type == "text_to_video":
            key = f"{model_id}/t2v"
        else:
            key = model_id
        return self.ENDPOINTS.get(key, model_id)

    async def generate(self, input: ProviderInput) -> AsyncIterator[ProviderEvent]:
        # fal_client reads FAL_KEY from env — set it for this process
        os.environ["FAL_KEY"] = self._api_key

        endpoint = self._get_endpoint(input.parameters.get("_model_id", "fal-ai/wan-2.2"), input.effect_type)

        arguments: dict[str, Any] = {
            "prompt": input.prompt,
            **{k: v for k, v in input.parameters.items() if not k.startswith("_")},
        }

        if input.negative_prompt:
            arguments["negative_prompt"] = input.negative_prompt

        if input.aspect_ratio:
            arguments["aspect_ratio"] = input.aspect_ratio

        if input.duration:
            arguments["duration"] = input.duration

        # Upload local images to fal.ai storage
        yield ProviderEvent(type="progress", progress=5, message="Uploading images...")
        if input.images:
            uploaded = []
            for local_path in input.images:
                url = await fal_client.upload_file_async(local_path)
                uploaded.append(url)
            arguments["image_url"] = uploaded[0]
            if len(uploaded) > 1:
                arguments["image_url_2"] = uploaded[1]

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
