import logging
from dataclasses import dataclass
from pathlib import Path

import yaml

from effects.validator import EffectManifest
from services.install_service import InstallService

logger = logging.getLogger(__name__)


@dataclass
class LoadedEffect:
    """Wraps a validated manifest with loader-specific metadata."""
    manifest: EffectManifest
    id: str                # UUID primary key from the effects table
    full_id: str           # namespace/slug
    assets_dir: Path       # UUID folder path
    source: str            # "official" | "installed" | "local"
    is_favorite: bool = False


class EffectLoaderService:
    def __init__(self, install_service: InstallService, bundled_dir: Path | None = None):
        self._install = install_service
        self._bundled_dir = bundled_dir
        self._cache: dict[str, LoadedEffect] = {}       # keyed by full_id (namespace/slug)
        self._uuid_cache: dict[str, LoadedEffect] = {}  # keyed by effects.id (UUID)

    async def load_all(self) -> None:
        """Load all effects from DB. Sync bundled effects on every startup.

        Bundled effects live as plain folders in the repo's `effects/` tree —
        no intermediate zip to rebuild on each change. Any effect that was
        bundled in a previous release but has since been removed from the
        folder is demoted to `source='installed'` so the user can uninstall
        it (instead of staying permanently locked as 'official')."""
        if self._bundled_dir:
            logger.info("Syncing bundled effects...")
            try:
                installed = await self._install.sync_bundled_folder(self._bundled_dir)
                if installed:
                    logger.info(f"Synced {len(installed)} bundled effects")
            except Exception as e:
                logger.error(f"Failed to sync bundled effects: {e}")

        # Load all effects from DB
        await self.reload()

    async def reload(self) -> None:
        """Reload the in-memory cache from the DB. Atomic swap to avoid empty cache during rebuild."""
        new_cache: dict[str, LoadedEffect] = {}
        new_uuid_cache: dict[str, LoadedEffect] = {}
        rows = await self._install.get_all_effects()

        for row in rows:
            try:
                manifest_data = yaml.safe_load(row["manifest_yaml"])
                manifest = EffectManifest(**manifest_data)
                effect_id = row["id"]
                full_id = manifest.full_id
                assets_dir = Path(row["assets_dir"])

                loaded = LoadedEffect(
                    manifest=manifest,
                    id=effect_id,
                    full_id=full_id,
                    assets_dir=assets_dir,
                    source=row["source"],
                    is_favorite=bool(row.get("is_favorite", 0)),
                )
                new_cache[full_id] = loaded
                new_uuid_cache[effect_id] = loaded
            except Exception as e:
                logger.warning(f"Failed to load effect from DB row {row['id']}: {e}")

        # Atomic swap — no window where cache is empty
        self._cache = new_cache
        self._uuid_cache = new_uuid_cache

        logger.info(f"Loaded {len(self._cache)} effects from database")

    def get_all(self) -> list[EffectManifest]:
        return [e.manifest for e in self._cache.values()]

    def get_all_with_meta(self) -> list[LoadedEffect]:
        return list(self._cache.values())

    def get_loaded(self, full_id: str) -> LoadedEffect | None:
        """Look up by `namespace/slug`."""
        return self._cache.get(full_id)

    def get_by_id(self, effect_id: str) -> LoadedEffect | None:
        """Look up by the UUID primary key."""
        return self._uuid_cache.get(effect_id)

    def get_asset_path(self, uuid: str, filename: str) -> Path | None:
        """Resolve an asset file from a UUID folder. No DB query needed."""
        # Validate UUID format (basic check)
        if not uuid or "/" in uuid or ".." in uuid:
            return None

        assets_dir = self._install.effects_dir / uuid / "assets"

        # Directory traversal protection
        safe_path = (assets_dir / filename).resolve()
        if not str(safe_path).startswith(str(assets_dir.resolve())):
            return None

        if not safe_path.exists():
            return None

        return safe_path
