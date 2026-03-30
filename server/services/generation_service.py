import asyncio
import json
import logging
import time
from typing import Any, AsyncIterator
from uuid import uuid4

from services.effect_loader import EffectLoaderService
from services.history_service import HistoryService
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
        self.events: asyncio.Queue = asyncio.Queue()
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

        job_id = str(uuid4())
        job = GenerationJob(
            job_id=job_id,
            effect_id=request.effect_id,
            effect_name=manifest.name,
            model_id=request.model_id,
        )
        self._jobs[job_id] = job

        # Create history record immediately
        await self._history.create_processing(job)

        # Run in background
        asyncio.create_task(self._run_job(job, request, manifest))

        return job_id

    async def stream(self, job_id: str) -> AsyncIterator[dict[str, Any]]:
        job = self._jobs.get(job_id)

        if not job:
            # Check if it's a completed/failed job in history
            record = await self._history.get_by_id(job_id)
            if record:
                if record.status == "completed":
                    yield {"event": "completed", "data": {"job_id": job_id, "video_url": record.video_url, "duration_ms": record.duration_ms}}
                elif record.status == "failed":
                    yield {"event": "failed", "data": {"job_id": job_id, "error": record.error or "Generation failed", "code": "GENERATION_FAILED"}}
            else:
                yield {"event": "failed", "data": {"job_id": job_id, "error": "Job not found", "code": "JOB_NOT_FOUND"}}
            return

        # Stream events from the queue
        while True:
            event = await job.events.get()
            yield event
            if event["event"] in ("completed", "failed"):
                break

    async def _run_job(self, job: GenerationJob, request: Any, manifest: Any) -> None:
        try:
            # Build prompt (layer 1 - inputs only)
            prompt = PromptBuilder.build_prompt(manifest, request.model_id, request.inputs)

            # Build params (layer 2 - model params only)
            params = PromptBuilder.build_params(manifest, request.model_id, request.user_params)

            # Get negative prompt
            negative_prompt = manifest.generation.negative_prompt
            if "negative_prompt" in params:
                negative_prompt = str(params.pop("negative_prompt"))

            # Resolve image ref_ids to paths
            images: list[str] = []
            for key, field in manifest.inputs.items():
                if field.type == "image" and key in request.inputs:
                    ref_id = request.inputs[key]
                    file_path = self._storage.get_path(ref_id)
                    if file_path:
                        images.append(str(file_path))

            # Create provider
            api_key = self._config.get_api_key()
            models_dir = self._model_service._models_dir if hasattr(self._model_service, '_models_dir') else None
            provider = ModelProviderFactory.create(request.model_id, api_key=api_key, models_dir=models_dir)

            # Build provider input
            provider_input = ProviderInput(
                prompt=prompt,
                negative_prompt=negative_prompt,
                images=images,
                aspect_ratio=str(request.output.get("aspect_ratio", "9:16")),
                duration=int(request.output.get("duration", 5)),
                parameters={**params, "_model_id": request.model_id},
                effect_type=manifest.effect_type,
            )

            # Run generation
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
                    await self._history.complete(job.job_id, event.video_url or "", duration_ms)
                    await job.events.put({
                        "event": "completed",
                        "data": {"job_id": job.job_id, "video_url": event.video_url, "duration_ms": duration_ms},
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
