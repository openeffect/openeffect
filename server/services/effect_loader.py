import logging
from dataclasses import dataclass
from pathlib import Path
import yaml
from effects.validator import EffectManifest

logger = logging.getLogger(__name__)


@dataclass
class LoadedEffect:
    """Wraps a validated manifest with loader-specific metadata."""
    manifest: EffectManifest
    full_id: str
    folder_path: Path


class EffectLoaderService:
    def __init__(self, effects_dir: Path):
        self._effects_dir = effects_dir
        self._cache: dict[str, LoadedEffect] = {}

    async def load_all(self) -> None:
        self._cache.clear()
        failed = 0

        if not self._effects_dir.exists():
            logger.warning(f"Effects directory not found: {self._effects_dir}")
            return

        for manifest_path in sorted(self._effects_dir.rglob("manifest.yaml")):
            try:
                with open(manifest_path) as f:
                    raw = yaml.safe_load(f)

                manifest = EffectManifest(**raw)

                folder_name = manifest_path.parent.name
                if manifest.id != folder_name:
                    logger.warning(f"Skipping {manifest_path}: id '{manifest.id}' doesn't match folder '{folder_name}'")
                    failed += 1
                    continue

                effect_type_dir = manifest_path.parent.parent.name
                full_id = f"{effect_type_dir}/{manifest.id}"

                self._cache[full_id] = LoadedEffect(
                    manifest=manifest,
                    full_id=full_id,
                    folder_path=manifest_path.parent,
                )

            except Exception as e:
                logger.warning(f"Failed to load {manifest_path}: {e}")
                failed += 1

        logger.info(f"Loaded {len(self._cache)} effects ({failed} failed validation)")

    def get_all(self) -> list[EffectManifest]:
        return [e.manifest for e in self._cache.values()]

    def get_by_id(self, effect_id: str) -> EffectManifest | None:
        loaded = self._cache.get(effect_id)
        return loaded.manifest if loaded else None

    def get_asset_path(self, effect_id: str, filename: str) -> Path | None:
        loaded = self._cache.get(effect_id)
        if not loaded:
            return None

        # Assets live in the assets/ subfolder
        assets_dir = loaded.folder_path / "assets"

        # Directory traversal protection
        safe_path = (assets_dir / filename).resolve()
        if not str(safe_path).startswith(str(assets_dir.resolve())):
            return None

        if not safe_path.exists():
            return None

        return safe_path
