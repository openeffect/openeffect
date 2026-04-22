from pathlib import Path

from providers.base import BaseProvider
from providers.fal_provider import FalProvider
from providers.local_provider import LocalProvider


class ModelProviderFactory:
    @staticmethod
    def create(
        model_id: str,
        provider_id: str,
        api_key: str | None = None,
        models_dir: Path | None = None,
    ) -> BaseProvider:
        if provider_id == "local":
            if not models_dir:
                raise ValueError("models_dir required for local provider")
            return LocalProvider(models_dir)
        else:
            if not api_key:
                raise PermissionError("No API key configured. Set your fal.ai key in Settings.")
            return FalProvider(api_key)
