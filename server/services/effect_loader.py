import logging
from pathlib import Path
import yaml
from effects.validator import EffectManifest

logger = logging.getLogger(__name__)


class EffectLoaderService:
    def __init__(self, effects_dir: Path):
        self._effects_dir = effects_dir
        self._cache: dict[str, EffectManifest] = {}

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

                # Verify folder name matches id
                folder_name = manifest_path.parent.name
                if manifest.id != folder_name:
                    logger.warning(f"Skipping {manifest_path}: id '{manifest.id}' doesn't match folder '{folder_name}'")
                    failed += 1
                    continue

                # Verify thumbnail exists
                thumb = manifest_path.parent / manifest.assets.thumbnail
                if not thumb.exists():
                    logger.warning(f"Skipping {manifest_path}: thumbnail not found at {thumb}")
                    failed += 1
                    continue

                # Build full effect ID: type/name
                effect_type_dir = manifest_path.parent.parent.name
                full_id = f"{effect_type_dir}/{manifest.id}"

                # Store the full path for asset resolution
                manifest._folder_path = manifest_path.parent  # type: ignore
                manifest._full_id = full_id  # type: ignore

                self._cache[full_id] = manifest

            except Exception as e:
                logger.warning(f"Failed to load {manifest_path}: {e}")
                failed += 1

        logger.info(f"Loaded {len(self._cache)} effects ({failed} failed validation)")

    def get_all(self) -> list[EffectManifest]:
        return list(self._cache.values())

    def get_by_id(self, effect_id: str) -> EffectManifest | None:
        return self._cache.get(effect_id)

    def get_asset_path(self, effect_id: str, filename: str) -> Path | None:
        manifest = self._cache.get(effect_id)
        if not manifest:
            return None

        folder = getattr(manifest, "_folder_path", None)
        if not folder:
            return None

        # Directory traversal protection
        safe_path = (folder / filename).resolve()
        if not str(safe_path).startswith(str(folder.resolve())):
            return None

        if not safe_path.exists():
            return None

        return safe_path
