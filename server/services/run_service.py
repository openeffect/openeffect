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
from services.history_service import RunRecord, HistoryService
from services.model_service import ModelService, get_compatible_model_ids, MODELS_BY_ID
from services.storage_service import StorageService
from effects.prompt_builder import PromptBuilder
from config.config_service import ConfigService
from providers.factory import ModelProviderFactory
from providers.base import ProviderInput
from providers.model_params import KNOWN_MODEL_PARAMS

logger = logging.getLogger(__name__)


class RunJob:
    def __init__(
        self,
        job_id: str,
        effect_id: str | None,
        effect_name: str | None,
        model_id: str,
    ):
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


class RunService:
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
        self._jobs: dict[str, RunJob] = {}

    async def start(self, request: Any) -> str:
        # Support lookup by DB UUID or namespace/id
        loaded = self._effect_loader.get_by_db_id(request.effect_id)
        if not loaded:
            loaded = self._effect_loader.get_loaded(request.effect_id)
        if not loaded:
            raise ValueError(f"Effect not found: {request.effect_id}")

        manifest = loaded.manifest
        db_id = loaded.db_id

        # Validate model compatibility based on input roles
        input_roles = {f.role for f in manifest.inputs.values() if f.type == "image" and f.role in ("start_frame", "end_frame")}
        compatible = get_compatible_model_ids(input_roles)
        if request.model_id not in compatible:
            raise ValueError(f"Model {request.model_id} not compatible with this effect")
        if request.model_id not in MODELS_BY_ID:
            raise ValueError(f"Unknown model: {request.model_id}")

        job_id = str(uuid_utils.uuid7())
        job = RunJob(
            job_id=job_id,
            effect_id=db_id,
            effect_name=manifest.name,
            model_id=request.model_id,
        )
        self._jobs[job_id] = job

        # Create the run folder
        run_folder = RunRecord.run_folder(job_id)
        run_folder.mkdir(parents=True, exist_ok=True)

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

        # Resolve everything up-front so we can persist `model_inputs` — the
        # normalized (role-keyed, fully-resolved) shape that's stable across
        # effect deletion. The client uses this for "Open in playground".
        prompt = PromptBuilder.build_prompt(manifest, request.model_id, request.inputs)
        params = PromptBuilder.build_params(manifest, request.model_id, request.user_params)
        negative_prompt = manifest.generation.negative_prompt
        if "negative_prompt" in params:
            negative_prompt = str(params.pop("negative_prompt"))

        image_refs_by_role: dict[str, str] = {}
        for key, field in manifest.inputs.items():
            if field.type != "image":
                continue
            role = getattr(field, "role", "start_frame")
            if key in request.inputs:
                image_refs_by_role[role] = request.inputs[key]  # ref_id, not file path

        model_inputs = {
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            **image_refs_by_role,
        }

        inputs_json = json.dumps({
            "inputs": saved_inputs,
            "model_inputs": model_inputs,
            "output": dict(request.output) if request.output else {},
            "user_params": dict(request.user_params) if request.user_params else {},
        })

        await self._history.create_processing(job, inputs_json=inputs_json)

        # Resolve ref_ids -> file paths for the provider (ephemeral, not stored)
        image_paths: dict[str, str] = {}
        for role, ref_id in image_refs_by_role.items():
            file_path = self._storage.get_upload_path(ref_id, "2048")
            if file_path:
                image_paths[role] = str(file_path)

        provider_input = ProviderInput(
            prompt=prompt,
            negative_prompt=negative_prompt,
            image_inputs=image_paths,
            output=dict(request.output) if request.output else {},
            parameters={**params, "_model_id": request.model_id},
        )

        asyncio.create_task(self._execute_provider(
            job,
            request.model_id,
            request.provider_id,
            provider_input,
            needs_reverse=manifest.generation.reverse,
        ))

        return job_id

    async def start_playground(self, request: Any) -> str:
        """Start a playground run: model + raw prompt + image refs + params, no manifest."""
        if request.model_id not in MODELS_BY_ID:
            raise ValueError(f"Unknown model: {request.model_id}")

        model = MODELS_BY_ID[request.model_id]
        fal_cfg = model.get("fal") or {}
        valid_roles = set((fal_cfg.get("role_params") or {}).keys())

        image_inputs = dict(request.image_inputs or {})
        for role in image_inputs.keys():
            if role not in valid_roles:
                raise ValueError(
                    f"Model {request.model_id} does not support image role: {role}"
                )

        if not (request.prompt or "").strip():
            raise ValueError("Prompt is required")

        job_id = str(uuid_utils.uuid7())
        job = RunJob(
            job_id=job_id,
            effect_id=None,
            effect_name=None,
            model_id=request.model_id,
        )
        self._jobs[job_id] = job

        # Create the run folder
        run_folder = RunRecord.run_folder(job_id)
        run_folder.mkdir(parents=True, exist_ok=True)

        # Increment ref count for each image input so the upload isn't garbage collected
        for ref_id in image_inputs.values():
            await self._storage.increment_ref(ref_id)

        # Filter user_params + pull negative_prompt override
        known = KNOWN_MODEL_PARAMS.get(request.model_id, set())
        params = {k: v for k, v in (request.user_params or {}).items() if k in known}
        negative_prompt = request.negative_prompt or ""
        if "negative_prompt" in params:
            negative_prompt = str(params.pop("negative_prompt"))

        # Playground inputs are already in the normalized (role-keyed, resolved)
        # shape — no separate `model_inputs` needed, it would just duplicate this.
        saved_inputs: dict[str, str] = {
            "prompt": request.prompt,
            "negative_prompt": negative_prompt,
            **image_inputs,
        }
        inputs_json = json.dumps({
            "inputs": saved_inputs,
            "output": dict(request.output) if request.output else {},
            "user_params": dict(request.user_params) if request.user_params else {},
        })

        await self._history.create_processing(job, inputs_json=inputs_json, kind="playground")

        # Resolve ref_ids -> file paths for the provider (ephemeral, not stored)
        image_paths: dict[str, str] = {}
        for role, ref_id in image_inputs.items():
            file_path = self._storage.get_upload_path(ref_id, "2048")
            if file_path:
                image_paths[role] = str(file_path)

        provider_input = ProviderInput(
            prompt=request.prompt,
            negative_prompt=negative_prompt,
            image_inputs=image_paths,
            output=dict(request.output) if request.output else {},
            parameters={**params, "_model_id": request.model_id},
        )

        asyncio.create_task(self._execute_provider(
            job, request.model_id, request.provider_id, provider_input, needs_reverse=False,
        ))

        return job_id

    async def stream(self, job_id: str) -> AsyncIterator[dict[str, Any]]:
        job = self._jobs.get(job_id)

        if not job:
            record = await self._history.get_by_id(job_id)
            if record:
                if record.status == "completed":
                    yield {"event": "completed", "data": {"job_id": job_id, "video_url": record.video_url, "duration_ms": record.duration_ms}}
                elif record.status == "failed":
                    yield {"event": "failed", "data": {"job_id": job_id, "error": record.error or "Run failed", "code": "RUN_FAILED"}}
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

    async def _execute_provider(
        self,
        job: RunJob,
        model_id: str,
        provider_id: str,
        provider_input: ProviderInput,
        needs_reverse: bool,
    ) -> None:
        """Run the provider, stream events, download the result, and update history.

        Shared tail used by both effect runs and playground runs.
        """
        try:
            api_key = self._config.get_api_key()
            models_dir = self._model_service._models_dir if hasattr(self._model_service, '_models_dir') else None
            provider = ModelProviderFactory.create(model_id, provider_id, api_key=api_key, models_dir=models_dir)

            async for event in provider.generate(provider_input):
                if event.type == "submitted":
                    # Store provider request_id for crash recovery
                    if event.request_id:
                        await self._history.set_provider_request(
                            job.job_id, event.request_id, event.endpoint or ""
                        )
                elif event.type == "progress":
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

                    # Download/copy result video to run folder
                    video_url = event.video_url or ""
                    run_folder = RunRecord.run_folder(job.job_id)
                    result_path = run_folder / "result.mp4"

                    if video_url.startswith("http://") or video_url.startswith("https://"):
                        # Remote URL (e.g. fal CDN) - stream to disk
                        try:
                            async with httpx.AsyncClient() as client:
                                async with client.stream("GET", video_url, follow_redirects=True, timeout=120.0) as resp:
                                    resp.raise_for_status()
                                    with open(result_path, "wb") as f:
                                        async for chunk in resp.aiter_bytes(8192):
                                            f.write(chunk)
                        except Exception as dl_err:
                            logger.warning(f"Failed to download result video for {job.job_id}: {dl_err}")
                    elif video_url:
                        # Local path - copy to run folder
                        src = Path(video_url)
                        if src.exists():
                            shutil.copy2(str(src), str(result_path))

                    # Reverse video if end_frame was used without start_frame
                    if needs_reverse and result_path.exists():
                        reversed_path = run_folder / "result_reversed.mp4"
                        try:
                            proc = await asyncio.create_subprocess_exec(
                                "ffmpeg", "-y", "-i", str(result_path),
                                "-vf", "reverse", "-af", "areverse",
                                str(reversed_path),
                                stdout=asyncio.subprocess.DEVNULL,
                                stderr=asyncio.subprocess.DEVNULL,
                            )
                            await proc.wait()
                            if proc.returncode == 0 and reversed_path.exists():
                                reversed_path.rename(result_path)
                            else:
                                logger.warning(f"Video reverse failed for {job.job_id}, using original")
                                if reversed_path.exists():
                                    reversed_path.unlink()
                        except Exception as rev_err:
                            logger.warning(f"Video reverse error for {job.job_id}: {rev_err}")

                    # Update the DB record to point to our API endpoint
                    api_video_url = f"/api/runs/{job.job_id}/result"
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
                        "data": {"job_id": job.job_id, "error": event.error, "code": "RUN_FAILED"},
                    })

        except Exception as e:
            logger.exception(f"Job {job.job_id} failed")
            await self._fail_job(job, str(e))
        finally:
            self._schedule_eviction(job.job_id)

    async def _fail_job(self, job: RunJob, error_msg: str) -> None:
        job.status = "failed"
        job.error = error_msg
        await self._history.fail(job.job_id, error_msg)
        await job.events.put({
            "event": "failed",
            "data": {"job_id": job.job_id, "error": error_msg, "code": "INTERNAL_ERROR"},
        })

    def _schedule_eviction(self, job_id: str, delay: float = 60.0) -> None:
        """Evict a finished job from memory after a delay if no stream consumer connected."""
        async def _evict():
            await asyncio.sleep(delay)
            job = self._jobs.get(job_id)
            if job and job.status in ("completed", "failed"):
                self._jobs.pop(job_id, None)
        asyncio.create_task(_evict())

    async def recover_stuck_jobs(self) -> None:
        """Recover jobs that were processing when the server crashed."""
        stuck = await self._history.get_stuck_processing()
        if not stuck:
            return

        logger.info(f"Found {len(stuck)} stuck processing jobs, attempting recovery...")
        api_key = self._config.get_api_key()
        if not api_key:
            logger.warning("No API key — marking stuck fal.ai jobs as failed")
            for record in stuck:
                await self._history.fail(record.id, "Server restarted, no API key to recover")
            return

        from providers.fal_provider import FalProvider

        for record in stuck:
            if not record.provider_request_id or not record.provider_endpoint:
                await self._history.fail(record.id, "Server restarted, no recovery info")
                continue

            logger.info(f"Recovering job {record.id} (request_id={record.provider_request_id})")
            try:
                event = await FalProvider.recover(
                    api_key, record.provider_request_id, record.provider_endpoint,
                )

                if event.type == "completed" and event.video_url:
                    # Download result
                    run_folder = RunRecord.run_folder(record.id)
                    run_folder.mkdir(parents=True, exist_ok=True)
                    result_path = run_folder / "result.mp4"

                    async with httpx.AsyncClient() as client:
                        resp = await client.get(event.video_url, follow_redirects=True, timeout=120.0)
                        resp.raise_for_status()
                        result_path.write_bytes(resp.content)

                    api_video_url = f"/api/runs/{record.id}/result"
                    await self._history.complete(record.id, api_video_url, 0)
                    logger.info(f"Recovered job {record.id} — completed")
                else:
                    await self._history.fail(record.id, event.error or "Recovery failed")
                    logger.warning(f"Recovery failed for {record.id}: {event.error}")

            except Exception as e:
                logger.error(f"Recovery error for {record.id}: {e}")
                await self._history.fail(record.id, f"Recovery failed: {e}")
