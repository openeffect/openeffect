import os
from pathlib import Path

from providers.base import BaseProvider
from providers.fal_provider import FalProvider
from providers.local_provider import LocalProvider
from providers.mock_provider import MockProvider


class ModelProviderFactory:
    @staticmethod
    def create(
        model_id: str,
        provider_id: str,
        api_key: str | None = None,
        models_dir: Path | None = None,
    ) -> BaseProvider:
        # Dev emulation: when `OPENEFFECT_MOCK_PROVIDER` is truthy
        # (`1`/`true`/`yes`), short-circuit every request to a synthetic
        # stream instead of fal. No API key required; no network calls.
        if os.environ.get("OPENEFFECT_MOCK_PROVIDER", "").lower() in ("true", "1", "yes"):
            return MockProvider()
        if provider_id == "local":
            if not models_dir:
                raise ValueError("models_dir required for local provider")
            return LocalProvider(models_dir)
        else:
            if not api_key:
                raise PermissionError("No API key configured. Set your fal.ai key in Settings.")
            return FalProvider(api_key)
