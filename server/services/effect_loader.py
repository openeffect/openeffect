import json
import logging
from dataclasses import dataclass
from pathlib import Path

from effects.validator import EffectManifest
from services.install_service import InstallService

logger = logging.getLogger(__name__)


@dataclass
class LoadedEffect:
    """Wraps a validated manifest with loader-specific metadata."""
    manifest: EffectManifest
    full_id: str           # namespace/id
    assets_dir: Path       # UUID folder path
    source: str            # "official", "url", "archive", "local"


class EffectLoaderService:
    def __init__(self, install_service: InstallService, bundled_zip_path: Path | None = None):
        self._install = install_service
        self._bundled_zip = bundled_zip_path
        self._cache: dict[str, LoadedEffect] = {}

    async def load_all(self) -> None:
        """Load all effects from DB. On first launch, install bundled ZIP."""
        # First launch: install official effects from bundled ZIP
        count = await self._install.effect_count()
        if count == 0 and self._bundled_zip and self._bundled_zip.exists():
            logger.info("First launch: installing official effects from bundled ZIP...")
            try:
                installed = await self._install.install_from_archive(
                    self._bundled_zip.read_bytes(), allow_official=True
                )
                logger.info(f"Installed {len(installed)} official effects")
            except Exception as e:
                logger.error(f"Failed to install bundled effects: {e}")

        # Load all effects from DB
        await self.reload()

    async def reload(self) -> None:
        """Reload the in-memory cache from the DB."""
        self._cache.clear()
        rows = await self._install.get_all_effects()

        for row in rows:
            try:
                manifest_data = json.loads(row["manifest_json"])
                manifest = EffectManifest(**manifest_data)
                full_id = f"{manifest.namespace}/{manifest.id}"
                assets_dir = Path(row["assets_dir"])

                self._cache[full_id] = LoadedEffect(
                    manifest=manifest,
                    full_id=full_id,
                    assets_dir=assets_dir,
                    source=row["source"],
                )
            except Exception as e:
                logger.warning(f"Failed to load effect from DB row {row['id']}: {e}")

        logger.info(f"Loaded {len(self._cache)} effects from database")

    def get_all(self) -> list[EffectManifest]:
        return [e.manifest for e in self._cache.values()]

    def get_all_with_meta(self) -> list[LoadedEffect]:
        return list(self._cache.values())

    def get_by_id(self, effect_id: str) -> EffectManifest | None:
        loaded = self._cache.get(effect_id)
        return loaded.manifest if loaded else None

    def get_loaded(self, effect_id: str) -> LoadedEffect | None:
        return self._cache.get(effect_id)

    def get_asset_path(self, uuid: str, filename: str) -> Path | None:
        """Resolve an asset file from a UUID folder. No DB query needed."""
        # Validate UUID format (basic check)
        if not uuid or "/" in uuid or ".." in uuid:
            return None

        assets_dir = self._install._effects_dir / uuid / "assets"

        # Directory traversal protection
        safe_path = (assets_dir / filename).resolve()
        if not str(safe_path).startswith(str(assets_dir.resolve())):
            return None

        if not safe_path.exists():
            return None

        return safe_path
