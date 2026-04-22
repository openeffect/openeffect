import asyncio
import json
from collections.abc import AsyncIterator
from pathlib import Path
from uuid import uuid4

from providers.base import BaseProvider, ProviderEvent, ProviderInput


class LocalProvider(BaseProvider):
    def __init__(self, models_dir: Path):
        self._models_dir = models_dir

    async def generate(self, input: ProviderInput) -> AsyncIterator[ProviderEvent]:
        model_dir = self._models_dir / "wan-2.2"
        python = model_dir / ".venv" / "bin" / "python"
        runner = model_dir / "runner.py"

        if not python.exists() or not runner.exists():
            yield ProviderEvent(type="failed", error="Local model not installed")
            return

        output_path = self._models_dir.parent / "tmp" / f"{uuid4()}.mp4"

        request_data = {
            "prompt": input.prompt,
            "negative_prompt": input.negative_prompt,
            "image_inputs": input.image_inputs,
            "parameters": {k: v for k, v in input.parameters.items() if not k.startswith("_")},
            "output_path": str(output_path),
        }

        yield ProviderEvent(type="progress", progress=5, message="Starting local model...")

        try:
            proc = await asyncio.create_subprocess_exec(
                str(python), str(runner),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )

            stdout, stderr = await asyncio.wait_for(
                proc.communicate(json.dumps(request_data).encode()),
                timeout=600,
            )

            for line in stdout.decode().splitlines():
                if not line.strip():
                    continue
                try:
                    event = json.loads(line)
                    if event.get("type") == "progress":
                        yield ProviderEvent(
                            type="progress",
                            progress=event.get("progress", 0),
                            message=event.get("message", ""),
                        )
                    elif event.get("type") == "completed":
                        yield ProviderEvent(type="completed", video_url=f"/api/tmp/{output_path.name}")
                except json.JSONDecodeError:
                    continue

            if proc.returncode != 0:
                error_msg = stderr.decode().strip() or "Local model failed"
                yield ProviderEvent(type="failed", error=error_msg)

        except asyncio.TimeoutError:
            yield ProviderEvent(type="failed", error="Run timed out (10 minutes)")
        except Exception as e:
            yield ProviderEvent(type="failed", error=str(e))
