import logging
from dataclasses import dataclass, field
from pathlib import Path

import yaml

from db.database import Database
from effects.validator import EffectManifest
from services.file_service import File, FileKind
from services.install_service import InstallService

logger = logging.getLogger(__name__)


@dataclass
class LoadedEffect:
    """Wraps a validated manifest with loader-specific metadata. The
    `files` map's `File` values come straight from the JOIN against the
    `files` table — the same dataclass `FileService` returns — so
    callers feed them directly into `build_file_ref` to produce the API
    shape."""
    manifest: EffectManifest
    id: str                                 # UUID primary key from the effects table
    full_id: str                            # namespace/slug
    source: str                             # "official" | "installed" | "local"
    is_favorite: bool = False
    files: dict[str, File] = field(default_factory=dict)  # logical_name → File


class EffectLoaderService:
    def __init__(
        self,
        install_service: InstallService,
        db: Database,
        bundled_dir: Path | None = None,
    ):
        self._install = install_service
        self._db = db
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

        await self.reload()

    async def reload(self) -> None:
        """Atomic-swap rebuild of the in-memory cache. Joins `effect_files`
        against `files` once so each `LoadedEffect.files` is populated
        without per-effect round trips."""
        new_cache: dict[str, LoadedEffect] = {}
        new_uuid_cache: dict[str, LoadedEffect] = {}

        rows = await self._install.get_all_effects()
        if not rows:
            self._cache = new_cache
            self._uuid_cache = new_uuid_cache
            logger.info("Loaded 0 effects from database")
            return

        # Single JOIN to pull every (effect_id, logical_name) → file mapping.
        # Cheaper than per-effect lookups even for tiny libraries. We pull
        # the full `File`-shaped column set so each cache entry can flow
        # straight into `build_file_ref` without a re-fetch.
        effect_ids = [row["id"] for row in rows]
        placeholders = ",".join("?" * len(effect_ids))
        files_query = (
            "SELECT ef.effect_id, ef.logical_name, "
            "       f.id, f.hash, f.kind, f.mime, f.ext, f.size "
            "FROM effect_files ef "
            "JOIN files f ON f.id = ef.file_id "
            f"WHERE ef.effect_id IN ({placeholders})"
        )
        file_rows = await self._db.fetchall(files_query, tuple(effect_ids))
        files_by_effect: dict[str, dict[str, File]] = {}
        for fr in file_rows:
            kind: FileKind = fr["kind"]
            file = File(
                id=fr["id"], hash=fr["hash"], kind=kind,
                mime=fr["mime"], ext=fr["ext"], size=fr["size"],
            )
            files_by_effect.setdefault(fr["effect_id"], {})[fr["logical_name"]] = file

        for row in rows:
            try:
                manifest_data = yaml.safe_load(row["manifest_yaml"])
                manifest = EffectManifest(**manifest_data)
                effect_id = row["id"]
                full_id = manifest.full_id

                loaded = LoadedEffect(
                    manifest=manifest,
                    id=effect_id,
                    full_id=full_id,
                    source=row["source"],
                    is_favorite=bool(row.get("is_favorite", 0)),
                    files=files_by_effect.get(effect_id, {}),
                )
                new_cache[full_id] = loaded
                new_uuid_cache[effect_id] = loaded
            except Exception as e:
                logger.warning(f"Failed to load effect from DB row {row['id']}: {e}")

        # Atomic swap — no window where cache is empty
        self._cache = new_cache
        self._uuid_cache = new_uuid_cache

        logger.info(f"Loaded {len(self._cache)} effects from database")

    async def reload_one(self, effect_id: str) -> None:
        """Refresh exactly one effect's cache entry from the DB instead of
        re-parsing every manifest. Used by the metadata-only mutation
        paths (favorite, source, single-asset CRUD) so flipping a star
        on a 100-effect gallery doesn't re-parse the other 99 manifests.
        If the row is missing or not 'ready' (e.g. just uninstalled, or
        mid-lifecycle), evict the effect from both cache views."""
        row = await self._db.fetchone(
            "SELECT * FROM effects WHERE id = ? AND state = 'ready'",
            (effect_id,),
        )
        if row is None:
            existing = self._uuid_cache.pop(effect_id, None)
            if existing is not None:
                self._cache.pop(existing.full_id, None)
            return

        # Pull this effect's asset bindings in the same single-JOIN shape
        # `reload()` uses, so the resulting `LoadedEffect` is byte-for-byte
        # identical to what a full reload would produce.
        file_rows = await self._db.fetchall(
            "SELECT ef.logical_name, "
            "       f.id, f.hash, f.kind, f.mime, f.ext, f.size "
            "FROM effect_files ef "
            "JOIN files f ON f.id = ef.file_id "
            "WHERE ef.effect_id = ?",
            (effect_id,),
        )
        files: dict[str, File] = {
            fr["logical_name"]: File(
                id=fr["id"], hash=fr["hash"], kind=fr["kind"],
                mime=fr["mime"], ext=fr["ext"], size=fr["size"],
            )
            for fr in file_rows
        }

        try:
            manifest_data = yaml.safe_load(row["manifest_yaml"])
            manifest = EffectManifest(**manifest_data)
        except Exception as e:
            logger.warning(f"Failed to reload effect {effect_id}: {e}")
            return

        full_id = manifest.full_id
        loaded = LoadedEffect(
            manifest=manifest,
            id=effect_id,
            full_id=full_id,
            source=row["source"],
            is_favorite=bool(row["is_favorite"] if "is_favorite" in row.keys() else 0),
            files=files,
        )

        # If the effect's full_id changed (rare — would require namespace/slug
        # rewrite via the YAML save path), drop the stale entry from `_cache`
        # so we don't end up with two live entries pointing to the same uuid.
        prev = self._uuid_cache.get(effect_id)
        if prev is not None and prev.full_id != full_id:
            self._cache.pop(prev.full_id, None)
        self._cache[full_id] = loaded
        self._uuid_cache[effect_id] = loaded

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
