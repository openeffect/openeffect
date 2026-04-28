import asyncio
import json
import logging
import os
import tempfile
import time
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import httpx
import imageio_ffmpeg
import uuid_utils

from config.config_service import ConfigService
from core.limits import MAX_RESULT_VIDEO_SIZE
from core.states import RunStatus
from effects.prompt_builder import PromptBuilder
from effects.validator import EffectManifest, validate_run_inputs
from providers.base import ImageRef, ProviderInput
from providers.factory import ModelProviderFactory
from providers.fal_provider import FalProvider
from schemas.file_ref import file_to_ref
from schemas.run import PlaygroundRunRequest, RunRequest
from services.effect_loader import EffectLoaderService
from services.file_service import FileService
from services.history_service import HistoryService
from services.model_service import (
    MODELS_BY_ID,
    ModelService,
    get_compatible_model_ids,
    model_supported_image_keys,
)

logger = logging.getLogger(__name__)


class ResultTooLargeError(Exception):
    """Provider returned a result video bigger than MAX_RESULT_VIDEO_SIZE."""


async def _download_capped(url: str, dest: Path, max_bytes: int) -> None:
    """Stream `url` to `dest` but bail (and remove the partial file) if the
    response exceeds `max_bytes`."""
    written = 0
    async with httpx.AsyncClient() as client:
        async with client.stream("GET", url, follow_redirects=True, timeout=120.0) as resp:
            resp.raise_for_status()
            with open(dest, "wb") as f:
                async for chunk in resp.aiter_bytes(8192):
                    written += len(chunk)
                    if written > max_bytes:
                        f.close()
                        dest.unlink(missing_ok=True)
                        raise ResultTooLargeError(
                            f"Result video exceeded {max_bytes} bytes — aborted"
                        )
                    f.write(chunk)


async def _reverse_video_in_place(path: Path) -> None:
    """Rewrite `path` with its frames + audio reversed via ffmpeg. The
    end_frame-only effect convention asks the provider to drive the
    motion forward and we flip it after; same shape as before, just
    refactored to take/return a single Path."""
    reversed_path = path.with_name(path.name + ".reversed")
    try:
        # ffmpeg has no business seeing FAL_KEY
        child_env = {k: v for k, v in os.environ.items() if k != "FAL_KEY"}
        proc = await asyncio.create_subprocess_exec(
            imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-i", str(path),
            "-vf", "reverse", "-af", "areverse",
            str(reversed_path),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            env=child_env,
        )
        await proc.wait()
        if proc.returncode == 0 and reversed_path.exists():
            reversed_path.replace(path)
        else:
            logger.warning("Video reverse failed; keeping original")
            reversed_path.unlink(missing_ok=True)
    except Exception as rev_err:
        logger.warning("Video reverse error: %s", rev_err)
        reversed_path.unlink(missing_ok=True)


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
        self.status: RunStatus = "processing"
        self.progress = 0
        self.message = "Starting..."
        self.video_url: str | None = None
        self.error: str | None = None
        self.started_at = time.time()


class RunService:
    def __init__(
        self,
        effect_loader: EffectLoaderService,
        config_service: ConfigService,
        history_service: HistoryService,
        file_service: FileService,
        model_service: ModelService,
    ):
        self._effect_loader = effect_loader
        self._config = config_service
        self._history = history_service
        self._files = file_service
        self._model_service = model_service
        self._jobs: dict[str, RunJob] = {}
        # Shared event fan-out for /api/runs/stream. Every event produced for
        # any in-flight job is pushed into each registered queue; a subscriber
        # iterates its queue to build the SSE stream.
        self._broadcast_queues: set[asyncio.Queue[dict[str, Any]]] = set()

    async def start(self, request: RunRequest) -> str:
        # Accept either a UUID or a namespace/slug for `effect_id`
        loaded = self._effect_loader.get_by_id(request.effect_id)
        if not loaded:
            loaded = self._effect_loader.get_loaded(request.effect_id)
        if not loaded:
            raise ValueError(f"Effect not found: {request.effect_id}")

        manifest = loaded.manifest
        effect_uuid = loaded.id

        # Reject out-of-range / too-long / unknown-option values before we
        # spend any more work on the run. Images skipped — hashes were
        # validated at /api/files when the file landed.
        validate_run_inputs(manifest, request.inputs)

        # Validate model compatibility based on input roles. Split by required
        # vs optional — an optional end_frame means the effect can run on
        # models whose i2v variant lacks end_frame support (e.g. PixVerse).
        required_roles: set[str] = set()
        optional_roles: set[str] = set()
        for f in manifest.inputs.values():
            if f.type == "image" and f.role in ("start_frame", "end_frame"):
                if f.required:
                    required_roles.add(f.role)
                else:
                    optional_roles.add(f.role)
        compatible = get_compatible_model_ids(required_roles, optional_roles)
        if request.model_id not in compatible:
            raise ValueError(f"Model {request.model_id} not compatible with this effect")
        if request.model_id not in MODELS_BY_ID:
            raise ValueError(f"Unknown model: {request.model_id}")

        job_id = str(uuid_utils.uuid7())
        job = RunJob(
            job_id=job_id,
            effect_id=effect_uuid,
            effect_name=manifest.name,
            model_id=request.model_id,
        )
        self._jobs[job_id] = job

        saved_inputs: dict[str, str] = {}
        input_ids: list[str] = []
        for key, field in manifest.inputs.items():
            if field.type == "image" and key in request.inputs:
                file_id = request.inputs[key]
                input_ids.append(file_id)
                saved_inputs[key] = file_id
            elif key in request.inputs:
                saved_inputs[key] = request.inputs[key]
        # Ref bumps happen inside `history.create_processing` (same
        # transaction as the run row INSERT) — no half-bumped state
        # if anything below this point throws.

        # Resolve everything up-front so we can persist `model_inputs` — the
        # normalized (role-keyed, fully-resolved) shape that's stable across
        # effect deletion. The client uses this for "Open in playground".
        prompt = PromptBuilder.build_prompt(manifest, request.model_id, request.inputs)
        default_neg = PromptBuilder.build_negative_prompt(
            manifest, request.model_id, request.inputs,
        )
        params, negative_prompt = self._resolve_provider_params(
            model_id=request.model_id,
            provider_id=request.provider_id,
            output=request.output,
            user_params=request.user_params,
            default_negative_prompt=default_neg,
            manifest=manifest,
        )

        image_refs_by_role: dict[str, str] = {}
        for key, field in manifest.inputs.items():
            if field.type != "image":
                continue
            role = getattr(field, "role", "start_frame")
            if key in request.inputs:
                image_refs_by_role[role] = request.inputs[key]  # file id

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

        await self._history.create_processing(
            job, inputs_json=inputs_json, input_ids=input_ids,
        )

        await self._dispatch_provider_run(
            job=job,
            model_id=request.model_id,
            provider_id=request.provider_id,
            prompt=prompt,
            negative_prompt=negative_prompt,
            image_refs_by_role=image_refs_by_role,
            params=params,
            needs_reverse=manifest.generation.reverse,
        )

        return job_id

    async def start_playground(self, request: PlaygroundRunRequest) -> str:
        """Start a playground run: model + raw prompt + image refs + params, no manifest."""
        if request.model_id not in MODELS_BY_ID:
            raise ValueError(f"Unknown model: {request.model_id}")

        model = MODELS_BY_ID[request.model_id]
        valid_roles = set(model_supported_image_keys(model))

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

        # Ref bumps happen inside `history.create_processing` (same
        # transaction as the run row INSERT) so there's no window
        # where bumps could land without a corresponding run row.
        input_ids: list[str] = list(image_inputs.values())

        params, negative_prompt = self._resolve_provider_params(
            model_id=request.model_id,
            provider_id=request.provider_id,
            output=request.output,
            user_params=request.user_params,
            default_negative_prompt=request.negative_prompt or "",
            manifest=None,
        )

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

        await self._history.create_processing(
            job, inputs_json=inputs_json, input_ids=input_ids, kind="playground",
        )

        await self._dispatch_provider_run(
            job=job,
            model_id=request.model_id,
            provider_id=request.provider_id,
            prompt=request.prompt,
            negative_prompt=negative_prompt,
            image_refs_by_role=image_inputs,
            params=params,
            needs_reverse=False,
        )

        return job_id

    def _resolve_provider_params(
        self,
        *,
        model_id: str,
        provider_id: str,
        output: dict[str, Any] | None,
        user_params: dict[str, Any] | None,
        default_negative_prompt: str,
        manifest: EffectManifest | None,
    ) -> tuple[dict[str, Any], str]:
        """Merge raw user params, route through the model registry, and pull
        out a negative_prompt override if one was supplied via user_params.
        Returns the cleaned `params` (no `negative_prompt` key) and the
        resolved negative_prompt string."""
        raw_params: dict[str, Any] = {}
        if output:
            raw_params.update(output)
        if user_params:
            raw_params.update(user_params)
        params = PromptBuilder.build_provider_io(
            model_id, provider_id, raw_params=raw_params, manifest=manifest,
        )
        negative_prompt = default_negative_prompt
        if "negative_prompt" in params:
            negative_prompt = str(params.pop("negative_prompt"))
        return params, negative_prompt

    async def _dispatch_provider_run(
        self,
        *,
        job: RunJob,
        model_id: str,
        provider_id: str,
        prompt: str,
        negative_prompt: str,
        image_refs_by_role: dict[str, str],
        params: dict[str, Any],
        needs_reverse: bool,
    ) -> None:
        """Build ProviderInput and spawn the background `_execute_provider`
        task. The caller is responsible for having persisted the run row
        (via `history.create_processing`) before this is invoked."""
        image_refs = await self._resolve_image_refs(image_refs_by_role)
        provider_input = ProviderInput(
            prompt=prompt,
            negative_prompt=negative_prompt,
            image_inputs=image_refs,
            parameters={**params, "_model_id": model_id},
        )
        asyncio.create_task(self._execute_provider(
            job, model_id, provider_id, provider_input, needs_reverse=needs_reverse,
        ))

    async def _resolve_image_refs(self, refs_by_role: dict[str, str]) -> dict[str, ImageRef]:
        """Turn `{role: file_id}` into `{role: ImageRef(path, mime)}`
        for the provider. The mime comes from the file row (sniffed
        from magic bytes at upload time) — providers compare it to
        their `accepted_image_mimes` whitelist to decide whether to
        pass-through or transcode before sending."""
        out: dict[str, ImageRef] = {}
        for role, file_id in refs_by_role.items():
            file_row = await self._files.get_file(file_id)
            if file_row is None:
                continue
            # `File.ext` is the canonical extension recorded at ingest, so
            # the path is determined directly — no need to scan the variant
            # directory looking for `original.*`.
            original = self._files.files_dir / file_id / f"original.{file_row.ext}"
            if not original.is_file():
                continue
            out[role] = ImageRef(path=str(original), mime=file_row.mime)
        return out

    def _broadcast(self, event: dict[str, Any]) -> None:
        """Fan out an event to every open broadcast subscriber. Sync on purpose
        — `put_nowait` can't stall, and a slow/dead consumer's QueueFull is
        silently dropped for that one subscriber so the event path never
        blocks the provider. The drop is logged so a stuck progress bar in
        the UI has at least one trail to follow."""
        for queue in list(self._broadcast_queues):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                logger.warning(
                    "SSE subscriber queue full (size=%d); dropping %s event for job %s",
                    queue.qsize(),
                    event.get("event"),
                    event.get("data", {}).get("job_id"),
                )
                continue

    async def stream_all(self) -> AsyncIterator[dict[str, Any]]:
        """Yield every event from every in-flight job to a single subscriber.
        Caller iterates and forwards to SSE. A keepalive frame fires every
        15s of idle so intermediate proxies don't drop the connection."""
        queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=100)
        self._broadcast_queues.add(queue)
        try:
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield {"event": "keepalive", "data": {}}
                    continue
                yield event
        finally:
            self._broadcast_queues.discard(queue)

    async def _ingest_result(
        self, video_url: str, needs_reverse: bool,
    ) -> str | None:
        """Download the provider's result, optionally reverse it, then
        adopt it into the file store. Returns the file id, or None if
        ingestion failed (a failed download just leaves output_id null
        and the run still marked completed — same shape as before)."""
        if not video_url:
            return None

        # Download to a temp file under files_dir so the eventual rename
        # to the final folder is on the same filesystem.
        with tempfile.NamedTemporaryFile(
            dir=str(self._files.files_dir), suffix=".mp4", delete=False
        ) as tf:
            tmp_path = Path(tf.name)
        try:
            if video_url.startswith("http://") or video_url.startswith("https://"):
                try:
                    await _download_capped(video_url, tmp_path, MAX_RESULT_VIDEO_SIZE)
                except Exception as e:
                    logger.warning("Failed to download result video: %s", e)
                    return None
            else:
                src = Path(video_url)
                if not src.exists():
                    return None
                with open(src, "rb") as src_f, open(tmp_path, "wb") as dst_f:
                    while chunk := src_f.read(64 * 1024):
                        dst_f.write(chunk)

            if needs_reverse and tmp_path.exists():
                await _reverse_video_in_place(tmp_path)

            file = await self._files.add_file(
                tmp_path, kind="video", mime="video/mp4", ext="mp4",
            )
            # The output's ref_count is bumped inside `history.complete`
            # (same transaction as setting `runs.output_id`). Until then
            # the row sits at ref_count=0 like any eager upload — the
            # orphan reaper's TTL covers the gap.
            return file.id
        finally:
            tmp_path.unlink(missing_ok=True)

    async def _execute_provider(
        self,
        job: RunJob,
        model_id: str,
        provider_id: str,
        provider_input: ProviderInput,
        needs_reverse: bool,
    ) -> None:
        """Run the provider, stream events, ingest the result, update history.
        Shared tail used by both effect runs and playground runs."""
        try:
            api_key = await self._config.get_api_key()
            models_dir = self._model_service.models_dir
            provider = ModelProviderFactory.create(model_id, provider_id, api_key=api_key, models_dir=models_dir)

            async for event in provider.generate(provider_input):
                if event.type == "submitted":
                    if event.request_id:
                        await self._history.set_provider_request(
                            job.job_id, event.request_id, event.endpoint or ""
                        )
                elif event.type == "progress":
                    job.progress = event.progress or 0
                    job.message = event.message or ""
                    await self._history.update_progress(job.job_id, job.progress, job.message)
                    self._broadcast({
                        "event": "progress",
                        "data": {"job_id": job.job_id, "progress": job.progress, "message": job.message},
                    })
                elif event.type == "completed":
                    duration_ms = int((time.time() - job.started_at) * 1000)
                    job.status = "completed"

                    output_id = await self._ingest_result(
                        event.video_url or "", needs_reverse,
                    )
                    await self._history.complete(job.job_id, output_id or "", duration_ms)

                    # Resolve the output as a canonical FileRef so the
                    # client can read `output.url` / `output.thumbnails`
                    # without composing URLs.
                    output_ref = None
                    if output_id:
                        file = await self._files.get_file(output_id)
                        if file is not None:
                            output_ref = file_to_ref(file).model_dump()
                    job.video_url = output_ref.get("url") if output_ref else None
                    self._broadcast({
                        "event": "completed",
                        "data": {
                            "job_id": job.job_id,
                            "output": output_ref,
                            "duration_ms": duration_ms,
                        },
                    })
                elif event.type == "failed":
                    job.status = "failed"
                    job.error = event.error
                    await self._history.fail(job.job_id, event.error or "Unknown error")
                    self._broadcast({
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
        self._broadcast({
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
        api_key = await self._config.get_api_key()
        if not api_key:
            logger.warning("No API key — marking stuck fal.ai jobs as failed")
            for record in stuck:
                await self._history.fail(record.id, "Server restarted, no API key to recover")
            return

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
                    output_id = await self._ingest_result(event.video_url, needs_reverse=False)
                    if output_id:
                        await self._history.complete(record.id, output_id, 0)
                        logger.info(f"Recovered job {record.id} — completed")
                    else:
                        await self._history.fail(record.id, "Recovery ingest failed")
                else:
                    await self._history.fail(record.id, event.error or "Recovery failed")
                    logger.warning(f"Recovery failed for {record.id}: {event.error}")

            except Exception as e:
                logger.error(f"Recovery error for {record.id}: {e}")
                await self._history.fail(record.id, f"Recovery failed: {e}")
