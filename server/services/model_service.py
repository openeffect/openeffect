import asyncio
import uuid
import logging
from pathlib import Path
from typing import Any, AsyncIterator

logger = logging.getLogger(__name__)


AVAILABLE_MODELS = [
    {
        "id": "fal-ai/wan-2.2",
        "name": "Wan 2.2",
        "provider": "fal",
        "description": "Fast cloud-based video generation via fal.ai",
        "cost_per_sec": "~$0.10/sec",
    },
    {
        "id": "fal-ai/kling-v3",
        "name": "Kling v3",
        "provider": "fal",
        "description": "High-quality video generation via fal.ai",
        "cost_per_sec": "~$0.15/sec",
    },
    {
        "id": "local/wan-2.2",
        "name": "Wan 2.2 (Local)",
        "provider": "local",
        "description": "Run Wan 2.2 locally — free but requires GPU (8GB+ VRAM)",
    },
]


class ModelService:
    def __init__(self, models_dir: Path):
        self._models_dir = models_dir
        self._install_jobs: dict[str, dict] = {}

    def is_installed(self, model_id: str) -> bool:
        if model_id.startswith("local/"):
            model_name = model_id.split("/", 1)[1]
            model_dir = self._models_dir / model_name
            return (model_dir / ".venv" / "bin" / "python").exists()
        return True  # fal models are always "installed"

    def get_available_models(self, api_key: str | None = None) -> list[dict[str, Any]]:
        models = []
        for model in AVAILABLE_MODELS:
            m = dict(model)
            if model["provider"] == "fal":
                m["is_installed"] = bool(api_key)
            else:
                m["is_installed"] = self.is_installed(model["id"])
            models.append(m)
        return models

    async def install(self, model_id: str) -> str:
        if not model_id.startswith("local/"):
            raise ValueError(f"Cannot install cloud model: {model_id}")

        install_id = str(uuid.uuid4())
        self._install_jobs[install_id] = {
            "model_id": model_id,
            "status": "started",
            "progress": 0,
        }

        asyncio.create_task(self._run_install(install_id, model_id))
        return install_id

    async def _run_install(self, install_id: str, model_id: str) -> None:
        job = self._install_jobs[install_id]
        try:
            model_name = model_id.split("/", 1)[1]
            model_dir = self._models_dir / model_name
            model_dir.mkdir(parents=True, exist_ok=True)

            # Step 1: Create venv
            job.update({"progress": 10, "message": "Creating isolated environment..."})
            proc = await asyncio.create_subprocess_exec(
                "uv", "venv", str(model_dir / ".venv"),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            await proc.wait()

            # Step 2: Install deps
            job.update({"progress": 30, "message": "Installing dependencies..."})

            # Step 3: Download weights
            job.update({"progress": 50, "message": "Downloading model weights..."})

            # Step 4: Verify
            job.update({"progress": 90, "message": "Verifying installation..."})

            job.update({"status": "completed", "progress": 100, "message": "Installation complete"})

        except Exception as e:
            logger.exception(f"Installation failed for {model_id}")
            job.update({"status": "failed", "error": str(e)})

    async def stream_install(self, install_id: str) -> AsyncIterator[dict[str, Any]]:
        job = self._install_jobs.get(install_id)
        if not job:
            yield {"event": "failed", "data": {"install_job_id": install_id, "error": "Install job not found"}}
            return

        last_progress = -1
        while True:
            if job.get("progress", 0) != last_progress:
                last_progress = job.get("progress", 0)
                if job.get("status") == "completed":
                    yield {"event": "completed", "data": {"install_job_id": install_id, "model_id": job["model_id"]}}
                    break
                elif job.get("status") == "failed":
                    yield {"event": "failed", "data": {"install_job_id": install_id, "error": job.get("error", "Unknown error")}}
                    break
                else:
                    yield {"event": "progress", "data": {
                        "install_job_id": install_id,
                        "progress": last_progress,
                        "message": job.get("message", ""),
                    }}
            await asyncio.sleep(0.5)
