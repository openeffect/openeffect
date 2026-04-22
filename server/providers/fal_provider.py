import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import fal_client

from providers.base import BaseProvider, ProviderEvent, ProviderInput
from services.model_service import (
    canonical_key,
    canonical_to_wire,
    get_image_inputs,
    get_provider_variant,
    pick_variant,
)


class FalProvider(BaseProvider):
    def __init__(self, api_key: str):
        # Key stays scoped to this instance; don't let it reach os.environ
        # where subprocesses would inherit it.
        self._client = fal_client.AsyncClient(key=api_key)

    async def generate(self, input: ProviderInput) -> AsyncIterator[ProviderEvent]:
        model_id = input.parameters.get("_model_id", "wan-2.2")
        variant_key = input.parameters.get("_variant_key") or pick_variant(
            model_id, set(input.image_inputs.keys())
        )
        if not variant_key:
            yield ProviderEvent(type="failed", error=f"No variant found for model {model_id}")
            return

        # All wire-level concerns (endpoint, per-param wire `key`, transform)
        # live under the per-provider variant config — this is the only spot
        # that knows about fal-specific wire details.
        provider_cfg = get_provider_variant(model_id, variant_key, "fal")
        if not provider_cfg:
            yield ProviderEvent(type="failed", error=f"No fal provider config for {model_id}/{variant_key}")
            return

        endpoint = provider_cfg.get("endpoint")
        if not endpoint:
            yield ProviderEvent(type="failed", error=f"No endpoint for {model_id}/{variant_key}")
            return

        # Build a canonical-keyed args dict. Wire remap happens at the end
        canonical: dict[str, Any] = {
            "prompt": input.prompt,
            **{k: v for k, v in input.parameters.items() if not k.startswith("_") and v != "" and v is not None},
        }

        if input.negative_prompt:
            canonical["negative_prompt"] = input.negative_prompt

        # Upload images — keyed by canonical name. Remap to wire at the end
        yield ProviderEvent(type="progress", progress=5, message="Uploading images...")
        image_keys = {canonical_key(p) for p in get_image_inputs(provider_cfg)}
        for role, local_path in input.image_inputs.items():
            if role not in image_keys:
                continue
            url = await self._client.upload_file(Path(local_path))
            canonical[role] = url

        # Apply provider-specific value transform (int↔string enums,
        # derived keys like num_frames = duration × fps, etc.).
        transform = provider_cfg.get("transform_params")
        if transform is not None:
            canonical = transform(canonical)

        # Final step: rename canonical roles to wire keys via each param's
        # `role` → `key` mapping (entries with no `role` pass through unchanged).
        arguments = canonical_to_wire(provider_cfg.get("params", []), canonical)

        yield ProviderEvent(type="progress", progress=10, message="Submitting to fal.ai...")

        # Use subscribe with queue-based event bridging
        event_queue: asyncio.Queue[ProviderEvent | None] = asyncio.Queue()

        async def on_enqueue(request_id: str) -> None:
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
                result = await self._client.subscribe(
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
        client = fal_client.AsyncClient(key=api_key)
        try:
            status = await client.status(endpoint, request_id)
            if isinstance(status, (fal_client.Completed, fal_client.Queued, fal_client.InProgress)):
                result = await client.result(endpoint, request_id)
                if isinstance(result, dict) and "video" in result:
                    video_url = result["video"].get("url", "") if isinstance(result["video"], dict) else result["video"]
                    return ProviderEvent(type="completed", video_url=video_url)
                return ProviderEvent(type="failed", error="Unexpected response from fal.ai")
            return ProviderEvent(type="failed", error="Unknown job status")
        except Exception as e:
            return ProviderEvent(type="failed", error=str(e))
