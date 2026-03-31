import asyncio
import uuid
import logging
import venv
from pathlib import Path
from typing import Any, AsyncIterator

logger = logging.getLogger(__name__)


MODELS = [
    {
        "id": "kling-v3",
        "name": "Kling v3",
        "description": "High-quality video generation",
        "providers": [
            {"id": "fal", "name": "fal.ai", "type": "cloud", "cost": "~$0.15/sec"},
        ],
        "output_params": [
            {"key": "aspect_ratio", "label": "Aspect Ratio", "type": "select", "default": "9:16",
             "options": [{"value": "9:16", "label": "9:16"}, {"value": "16:9", "label": "16:9"}, {"value": "1:1", "label": "1:1"}]},
            {"key": "duration", "label": "Duration (seconds)", "type": "slider", "default": 5, "min": 3, "max": 10, "step": 1},
        ],
        "advanced_params": [
            {"key": "guidance_scale", "label": "Guidance scale", "type": "slider", "default": 8.0, "min": 1.0, "max": 20.0, "step": 0.5, "hint": "Higher = closer to prompt"},
            {"key": "num_inference_steps", "label": "Quality steps", "type": "slider", "default": 30, "min": 10, "max": 50, "step": 5, "hint": "More steps = better quality but slower"},
            {"key": "seed", "label": "Seed", "type": "number", "default": -1, "hint": "-1 = random"},
        ],
    },
    {
        "id": "wan-2.2",
        "name": "Wan 2.2",
        "description": "Fast video generation",
        "providers": [
            {"id": "fal", "name": "fal.ai", "type": "cloud", "cost": "~$0.10/sec"},
            # {"id": "local", "name": "Local", "type": "local"},  # disabled for now
        ],
        "output_params": [
            {"key": "duration", "label": "Duration (seconds)", "type": "slider", "default": 5, "min": 3, "max": 10, "step": 1},
        ],
        "advanced_params": [
            {"key": "fps", "label": "Frames per second", "type": "slider", "default": 16, "min": 8, "max": 24, "step": 1, "hint": "Higher = smoother but slower"},
            {"key": "guidance_scale", "label": "Guidance scale", "type": "slider", "default": 7.5, "min": 1.0, "max": 20.0, "step": 0.5, "hint": "Higher = closer to prompt"},
            {"key": "num_inference_steps", "label": "Quality steps", "type": "slider", "default": 30, "min": 10, "max": 50, "step": 5, "hint": "More steps = better quality but slower"},
            {"key": "seed", "label": "Seed", "type": "number", "default": -1, "hint": "-1 = random"},
        ],
    },
]


_RUNNER_SCRIPT = '''#!/usr/bin/env python
"""Wan 2.2 runner for OpenEffect. Reads request from stdin, writes progress to stdout."""
import json, sys, torch
from pathlib import Path

def main():
    request = json.loads(sys.stdin.read())
    weights_dir = str(Path(__file__).parent / "weights")

    print(json.dumps({"type": "progress", "progress": 10, "message": "Loading model..."}), flush=True)

    from diffusers import DiffusionPipeline

    # Detect available device and memory
    if torch.cuda.is_available():
        device = "cuda"
        dtype = torch.float16
    elif torch.backends.mps.is_available():
        import platform
        # Check available memory
        try:
            import psutil
            mem_gb = psutil.virtual_memory().total / (1024**3)
        except ImportError:
            mem_gb = 8  # assume low memory if psutil not available
        # Only use MPS if we have enough memory (16GB+), otherwise CPU
        if mem_gb >= 16:
            device = "mps"
            dtype = torch.float32
        else:
            device = "cpu"
            dtype = torch.float32
    else:
        device = "cpu"
        dtype = torch.float32

    pipe = DiffusionPipeline.from_pretrained(weights_dir, torch_dtype=dtype)

    if device == "cuda":
        pipe.enable_model_cpu_offload(device="cuda")
    elif device == "mps":
        pipe.enable_model_cpu_offload(device="mps")
    # CPU: no .to() needed, already on CPU

    steps = min(request["parameters"].get("num_inference_steps", 20), 20)

    print(json.dumps({"type": "progress", "progress": 30, "message": f"Generating ({steps} steps, this may take several minutes)..."}), flush=True)

    def step_callback(pipe, step, timestep, kwargs):
        pct = 30 + int((step / steps) * 65)  # 30-95%
        print(json.dumps({"type": "progress", "progress": pct, "message": f"Step {step + 1}/{steps}..."}), flush=True)
        return kwargs

    output = pipe(
        prompt=request["prompt"],
        negative_prompt=request.get("negative_prompt", ""),
        num_inference_steps=steps,
        guidance_scale=request["parameters"].get("guidance_scale", 7.5),
        height=320,
        width=512,
        num_frames=16,
        callback_on_step_end=step_callback,
    )

    output_path = request["output_path"]
    if hasattr(output, "frames") and output.frames:
        from diffusers.utils import export_to_video
        export_to_video(output.frames[0], output_path)
    else:
        Path(output_path).write_bytes(b"")

    print(json.dumps({"type": "completed", "video_path": output_path}), flush=True)

if __name__ == "__main__":
    main()
'''


class ModelService:
    def __init__(self, models_dir: Path):
        self._models_dir = models_dir
        self._install_jobs: dict[str, dict[str, Any]] = {}

    def is_installed(self, model_id: str) -> bool:
        model_dir = self._models_dir / model_id
        return (model_dir / ".venv" / "bin" / "python").exists() or \
               (model_dir / ".venv" / "Scripts" / "python.exe").exists()

    def get_available_models(self, api_key: str | None = None) -> list[dict[str, Any]]:
        models = []
        for model in MODELS:
            m = dict(model)
            providers = []
            for provider in model["providers"]:
                p = dict(provider)
                if provider["type"] == "cloud":
                    p["is_available"] = bool(api_key)
                elif provider["type"] == "local":
                    p["is_available"] = self.is_installed(model["id"])
                else:
                    p["is_available"] = False
                providers.append(p)
            m["providers"] = providers
            models.append(m)
        return models

    async def install(self, model_id: str) -> str:
        # Verify model exists and has a local provider
        model_def = next((m for m in MODELS if m["id"] == model_id), None)
        if not model_def:
            raise ValueError(f"Unknown model: {model_id}")
        if not any(p["type"] == "local" for p in model_def["providers"]):
            raise ValueError(f"Model {model_id} has no local provider")

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
            model_dir = self._models_dir / model_id
            model_dir.mkdir(parents=True, exist_ok=True)

            venv_dir = model_dir / ".venv"

            job.update({"progress": 10, "message": "Creating isolated environment..."})
            await asyncio.to_thread(
                venv.create, str(venv_dir), with_pip=True, clear=True
            )

            if (venv_dir / "bin" / "pip").exists():
                pip = str(venv_dir / "bin" / "pip")
                python = str(venv_dir / "bin" / "python")
            elif (venv_dir / "Scripts" / "pip.exe").exists():
                pip = str(venv_dir / "Scripts" / "pip.exe")
                python = str(venv_dir / "Scripts" / "python.exe")
            else:
                raise RuntimeError("pip not found in created venv")

            job.update({"progress": 20, "message": "Installing PyTorch (this may take a while)..."})
            proc = await asyncio.create_subprocess_exec(
                pip, "install", "torch", "torchvision", "torchaudio",
                "--index-url", "https://download.pytorch.org/whl/cpu",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            if proc.returncode != 0:
                raise RuntimeError(f"Failed to install PyTorch: {stderr.decode()[-500:]}")

            job.update({"progress": 40, "message": "Installing diffusers..."})
            proc = await asyncio.create_subprocess_exec(
                pip, "install", "diffusers", "transformers", "accelerate", "safetensors",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            if proc.returncode != 0:
                raise RuntimeError(f"Failed to install diffusers: {stderr.decode()[-500:]}")

            job.update({"progress": 60, "message": "Downloading model weights (~7GB)..."})
            proc = await asyncio.create_subprocess_exec(
                pip, "install", "huggingface-hub",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            await proc.communicate()

            proc = await asyncio.create_subprocess_exec(
                python, "-c",
                "from huggingface_hub import snapshot_download; "
                f"snapshot_download('Wan-AI/Wan2.1-T2V-1.3B-Diffusers', local_dir='{model_dir / 'weights'}')",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            if proc.returncode != 0:
                raise RuntimeError(f"Failed to download model: {stderr.decode()[-500:]}")

            job.update({"progress": 90, "message": "Setting up runner..."})
            runner_path = model_dir / "runner.py"
            runner_path.write_text(_RUNNER_SCRIPT)

            job.update({"progress": 95, "message": "Verifying installation..."})
            proc = await asyncio.create_subprocess_exec(
                python, "-c",
                "import torch; import diffusers; print('OK')",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await proc.communicate()
            if proc.returncode != 0:
                raise RuntimeError(f"Verification failed: {stderr.decode()[-500:]}")

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
