import asyncio
import json
import logging
import shutil
import time
from pathlib import Path
from typing import Any, AsyncIterator

import httpx
import uuid_utils

from config.settings import get_settings
from services.effect_loader import EffectLoaderService
from services.history_service import GenerationRecord, HistoryService
from services.model_service import ModelService
from services.storage_service import StorageService
from effects.prompt_builder import PromptBuilder
from config.config_service import ConfigService
from providers.factory import ModelProviderFactory
from providers.base import ProviderInput

logger = logging.getLogger(__name__)


class GenerationJob:
    def __init__(self, job_id: str, effect_id: str, effect_name: str, model_id: str):
        self.job_id = job_id
        self.effect_id = effect_id
        self.effect_name = effect_name
        self.model_id = model_id
        self.status = "processing"
        self.progress = 0
        self.message = "Starting..."
        self.video_url: str | None = None
        self.error: str | None = None
        self.events: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
        self.started_at = time.time()


class GenerationService:
    def __init__(
        self,
        effect_loader: EffectLoaderService,
        config_service: ConfigService,
        history_service: HistoryService,
        storage_service: StorageService,
        model_service: ModelService,
    ):
        self._effect_loader = effect_loader
        self._config = config_service
        self._history = history_service
        self._storage = storage_service
        self._model_service = model_service
        self._jobs: dict[str, GenerationJob] = {}

    async def start(self, request: Any) -> str:
        manifest = self._effect_loader.get_by_id(request.effect_id)
        if not manifest:
            raise ValueError(f"Effect not found: {request.effect_id}")

        if request.model_id not in manifest.generation.supported_models:
            raise ValueError(f"Model {request.model_id} not supported by this effect")

        job_id = str(uuid_utils.uuid7())
        job = GenerationJob(
            job_id=job_id,
            effect_id=request.effect_id,
            effect_name=manifest.name,
            model_id=request.model_id,
        )
        self._jobs[job_id] = job

        # Create the generation folder
        gen_folder = GenerationRecord.generation_folder(job_id)
        gen_folder.mkdir(parents=True, exist_ok=True)

        # Store hash references directly from request.inputs
        # Increment ref_count for each image input
        saved_inputs: dict[str, str] = {}
        for key, field in manifest.inputs.items():
            if field.type == "image" and key in request.inputs:
                ref_id = request.inputs[key]
                await self._storage.increment_ref(ref_id)
                saved_inputs[key] = ref_id
            elif key in request.inputs:
                saved_inputs[key] = request.inputs[key]

        # Build the prompt for manifest_json
        prompt = PromptBuilder.build_prompt(manifest, request.model_id, request.inputs)

        # Build manifest_json with effect manifest (without assets), request params, and built prompt
        manifest_data = {
            "effect": manifest.model_dump(exclude={"assets"}),
            "request": {
                "effect_id": request.effect_id,
                "model_id": request.model_id,
                "provider_id": request.provider_id,
                "inputs": saved_inputs,
                "output": request.output,
                "user_params": request.user_params,
            },
            "prompt": prompt,
        }
        manifest_json_str = json.dumps(manifest_data)

        await self._history.create_processing(job, manifest_json=manifest_json_str, prompt_used=prompt)

        asyncio.create_task(self._run_job(job, request, manifest))

        # Auto-cleanup in background (don't block the response)
        asyncio.create_task(self._cleanup_overflow())

        return job_id

    async def _cleanup_overflow(self) -> None:
        """Delete oldest non-processing generations beyond 100."""
        try:
            overflow_ids = await self._history.get_overflow_ids(max_items=100)
            for old_id in overflow_ids:
                old_record = await self._history.get_by_id(old_id)
                if old_record and old_record.manifest_json:
                    try:
                        old_manifest = json.loads(old_record.manifest_json)
                        # Use effect input types to find image fields
                        effect_inputs = old_manifest.get("effect", {}).get("inputs", {})
                        request_inputs = old_manifest.get("request", {}).get("inputs", {})
                        hashes = [
                            request_inputs[key]
                            for key, schema in effect_inputs.items()
                            if schema.get("type") == "image" and key in request_inputs
                        ]
                        if hashes:
                            await self._storage.decrement_refs_and_cleanup(hashes)
                    except (json.JSONDecodeError, TypeError, KeyError) as e:
                        logger.warning(f"Failed to parse manifest for cleanup of {old_id}: {e}")
                await self._history.delete(old_id)
                gen_folder = GenerationRecord.generation_folder(old_id)
                if gen_folder.exists():
                    shutil.rmtree(str(gen_folder), ignore_errors=True)
        except Exception as e:
            logger.error(f"Overflow cleanup failed: {e}")

    async def stream(self, job_id: str) -> AsyncIterator[dict[str, Any]]:
        job = self._jobs.get(job_id)

        if not job:
            record = await self._history.get_by_id(job_id)
            if record:
                if record.status == "completed":
                    yield {"event": "completed", "data": {"job_id": job_id, "video_url": record.video_url, "duration_ms": record.duration_ms}}
                elif record.status == "failed":
                    yield {"event": "failed", "data": {"job_id": job_id, "error": record.error or "Generation failed", "code": "GENERATION_FAILED"}}
            else:
                yield {"event": "failed", "data": {"job_id": job_id, "error": "Job not found", "code": "JOB_NOT_FOUND"}}
            return

        # Stream events, then evict job from memory
        try:
            while True:
                event = await job.events.get()
                yield event
                if event["event"] in ("completed", "failed"):
                    break
        finally:
            self._jobs.pop(job_id, None)

    async def _run_job(self, job: GenerationJob, request: Any, manifest: Any) -> None:
        try:
            prompt = PromptBuilder.build_prompt(manifest, request.model_id, request.inputs)
            params = PromptBuilder.build_params(manifest, request.model_id, request.user_params)

            negative_prompt = manifest.generation.negative_prompt
            if "negative_prompt" in params:
                negative_prompt = str(params.pop("negative_prompt"))

            # Resolve image ref_ids to paths using content-addressable store
            image_inputs: dict[str, str] = {}
            for key, field in manifest.inputs.items():
                if field.type == "image" and key in request.inputs:
                    role = getattr(field, 'role', 'start_frame')
                    ref_id = request.inputs[key]
                    file_path = self._storage.get_upload_path(ref_id)
                    if file_path:
                        image_inputs[role] = str(file_path)

            api_key = self._config.get_api_key()
            models_dir = self._model_service._models_dir if hasattr(self._model_service, '_models_dir') else None
            provider = ModelProviderFactory.create(request.model_id, request.provider_id, api_key=api_key, models_dir=models_dir)

            provider_input = ProviderInput(
                prompt=prompt,
                negative_prompt=negative_prompt,
                image_inputs=image_inputs,
                output=dict(request.output) if request.output else {},
                parameters={**params, "_model_id": request.model_id},
            )

            async for event in provider.generate(provider_input):
                if event.type == "progress":
                    job.progress = event.progress or 0
                    job.message = event.message or ""
                    await self._history.update_progress(job.job_id, job.progress, job.message)
                    await job.events.put({
                        "event": "progress",
                        "data": {"job_id": job.job_id, "progress": job.progress, "message": job.message},
                    })
                elif event.type == "completed":
                    duration_ms = int((time.time() - job.started_at) * 1000)
                    job.status = "completed"
                    job.video_url = event.video_url

                    # Download/copy result video to generation folder
                    video_url = event.video_url or ""
                    gen_folder = GenerationRecord.generation_folder(job.job_id)
                    result_path = gen_folder / "result.mp4"

                    if video_url.startswith("http://") or video_url.startswith("https://"):
                        # Remote URL (e.g. fal CDN) - download it
                        try:
                            async with httpx.AsyncClient() as client:
                                resp = await client.get(video_url, follow_redirects=True, timeout=120.0)
                                resp.raise_for_status()
                                result_path.write_bytes(resp.content)
                        except Exception as dl_err:
                            logger.warning(f"Failed to download result video for {job.job_id}: {dl_err}")
                    elif video_url:
                        # Local path - copy to generation folder
                        src = Path(video_url)
                        if src.exists():
                            shutil.copy2(str(src), str(result_path))

                    # Update the DB record to point to our API endpoint
                    api_video_url = f"/api/generations/{job.job_id}/result"
                    await self._history.complete(job.job_id, api_video_url, duration_ms)
                    await job.events.put({
                        "event": "completed",
                        "data": {"job_id": job.job_id, "video_url": api_video_url, "duration_ms": duration_ms},
                    })
                elif event.type == "failed":
                    job.status = "failed"
                    job.error = event.error
                    await self._history.fail(job.job_id, event.error or "Unknown error")
                    await job.events.put({
                        "event": "failed",
                        "data": {"job_id": job.job_id, "error": event.error, "code": "GENERATION_FAILED"},
                    })

        except Exception as e:
            logger.exception(f"Job {job.job_id} failed")
            job.status = "failed"
            job.error = str(e)
            await self._history.fail(job.job_id, str(e))
            await job.events.put({
                "event": "failed",
                "data": {"job_id": job.job_id, "error": str(e), "code": "INTERNAL_ERROR"},
            })
