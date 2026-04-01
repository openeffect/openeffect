import io
import logging
import shutil
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import aiosqlite
import httpx
import uuid_utils
import yaml

from effects.validator import EffectManifest

logger = logging.getLogger(__name__)

# Security limits
MAX_MANIFEST_SIZE = 100 * 1024       # 100 KB
MAX_IMAGE_SIZE = 10 * 1024 * 1024    # 10 MB
MAX_VIDEO_SIZE = 50 * 1024 * 1024    # 50 MB
MAX_TOTAL_SIZE = 100 * 1024 * 1024   # 100 MB
MAX_ZIP_FILES = 100
ALLOWED_ASSET_EXTENSIONS = {".mp4", ".webm", ".jpg", ".jpeg", ".png", ".webp"}
RESERVED_NAMESPACES = {"openeffect", "system", "admin"}


def _validate_asset_filename(filename: str) -> None:
    """Reject path traversal and non-whitelisted extensions."""
    p = Path(filename)
    if ".." in p.parts or p.is_absolute():
        raise ValueError(f"Invalid asset path: {filename}")
    ext = p.suffix.lower()
    if ext not in ALLOWED_ASSET_EXTENSIONS:
        raise ValueError(f"Disallowed file extension: {ext}")


def _max_size_for_ext(ext: str) -> int:
    if ext in (".mp4", ".webm"):
        return MAX_VIDEO_SIZE
    return MAX_IMAGE_SIZE


class InstallService:
    def __init__(self, db_path: Path, effects_dir: Path):
        self._db_path = db_path
        self._effects_dir = effects_dir
        self._effects_dir.mkdir(parents=True, exist_ok=True)

    async def _get_db(self) -> aiosqlite.Connection:
        db = await aiosqlite.connect(str(self._db_path))
        db.row_factory = aiosqlite.Row
        return db

    # ─── Install from URL ───

    async def install_from_url(self, url: str) -> list[str]:
        """Fetch manifest(s) from URL, download assets, install."""
        async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()

            if len(resp.content) > MAX_MANIFEST_SIZE:
                raise ValueError("Manifest too large")

            data = yaml.safe_load(resp.text)
            if not isinstance(data, dict):
                raise ValueError("Invalid YAML content")

            base_url = url.rsplit("/", 1)[0] + "/"

            # Detect: index.yaml or single manifest
            if "effects" in data:
                return await self._install_index_from_url(client, base_url, data)
            elif "id" in data:
                return await self._install_single_from_url(client, base_url, data)
            else:
                raise ValueError("URL is neither a manifest nor an index")

    async def _install_index_from_url(
        self, client: httpx.AsyncClient, base_url: str, index: dict[str, Any]
    ) -> list[str]:
        effects = index.get("effects", [])
        if not isinstance(effects, list) or not effects:
            raise ValueError("Index has no effects listed")

        installed = []
        for entry in effects:
            path = entry.get("path") if isinstance(entry, dict) else str(entry)
            if not path:
                continue
            manifest_url = base_url + path
            resp = await client.get(manifest_url)
            resp.raise_for_status()
            data = yaml.safe_load(resp.text)
            manifest_base = manifest_url.rsplit("/", 1)[0] + "/"
            ids = await self._install_single_from_url(client, manifest_base, data)
            installed.extend(ids)
        return installed

    async def _install_single_from_url(
        self, client: httpx.AsyncClient, base_url: str, data: dict[str, Any]
    ) -> list[str]:
        manifest = EffectManifest(**data)
        self._validate_namespace(manifest.namespace)
        await self._check_conflict(manifest.namespace, manifest.id)

        uuid = str(uuid_utils.uuid7())
        effect_dir = self._effects_dir / uuid
        assets_dir = effect_dir / "assets"
        assets_dir.mkdir(parents=True)

        total_size = 0
        try:
            # Download assets
            asset_files = self._collect_asset_filenames(manifest)
            for filename in asset_files:
                _validate_asset_filename(filename)
                asset_url = base_url + "assets/" + filename
                resp = await client.get(asset_url)
                resp.raise_for_status()

                ext = Path(filename).suffix.lower()
                max_size = _max_size_for_ext(ext)
                if len(resp.content) > max_size:
                    raise ValueError(f"Asset {filename} exceeds size limit")

                total_size += len(resp.content)
                if total_size > MAX_TOTAL_SIZE:
                    raise ValueError("Total effect size exceeds limit")

                dest = assets_dir / filename
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(resp.content)

            # Save manifest file to disk too (for ID mismatch detection)
            (effect_dir / "manifest.yaml").write_text(
                yaml.dump(data, default_flow_style=False)
            )

            # Insert into DB
            yaml_content = yaml.dump(data, default_flow_style=False, sort_keys=False)
            await self._insert_effect(
                uuid=uuid,
                manifest=manifest,
                source="url",
                assets_dir=str(effect_dir),
                yaml_content=yaml_content,
            )

            return [manifest.full_id]

        except Exception:
            shutil.rmtree(str(effect_dir), ignore_errors=True)
            raise

    # ─── Install from archive ───

    async def install_from_archive(
        self, file_bytes: bytes, allow_official: bool = False
    ) -> list[str]:
        """Extract ZIP, validate manifests, install effects."""
        if not zipfile.is_zipfile(io.BytesIO(file_bytes)):
            raise ValueError("Not a valid ZIP archive")

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
                # Security: check file count and no symlinks
                if len(zf.namelist()) > MAX_ZIP_FILES:
                    raise ValueError(f"ZIP has too many files (max {MAX_ZIP_FILES})")

                total_size = sum(info.file_size for info in zf.infolist())
                if total_size > MAX_TOTAL_SIZE:
                    raise ValueError("ZIP extracted size exceeds limit")

                for info in zf.infolist():
                    if ".." in info.filename or info.filename.startswith("/"):
                        raise ValueError(f"Path traversal in ZIP: {info.filename}")

                zf.extractall(tmp_path)

            # Find manifests
            manifests = self._find_manifests(tmp_path)
            if not manifests:
                raise ValueError("No manifest.yaml found in archive")

            installed = []
            for manifest_path in manifests:
                full_id = await self._install_from_extracted(
                    manifest_path, allow_official
                )
                installed.append(full_id)

            return installed

    def _find_manifests(self, root: Path) -> list[Path]:
        """Find manifests: via index.yaml or by scanning for manifest.yaml files."""
        index_path = root / "index.yaml"
        if index_path.exists():
            index = yaml.safe_load(index_path.read_text())
            paths = []
            for entry in index.get("effects", []):
                p = entry.get("path") if isinstance(entry, dict) else str(entry)
                full = root / p
                if full.exists():
                    paths.append(full)
            return paths

        # Scan for manifest.yaml files
        return sorted(root.rglob("manifest.yaml"))

    async def _install_from_extracted(
        self, manifest_path: Path, allow_official: bool
    ) -> str:
        yaml_content = manifest_path.read_text()
        data = yaml.safe_load(yaml_content)
        manifest = EffectManifest(**data)

        if not allow_official:
            self._validate_namespace(manifest.namespace)

        # Check if already installed — if same version, skip; if different, update
        existing = await self._get_existing(manifest.namespace, manifest.id)
        if existing and existing["version"] == manifest.version:
            return manifest.full_id

        if existing:
            # Update: remove old assets, reuse DB row
            old_dir = Path(existing["assets_dir"])
            if old_dir.exists():
                shutil.rmtree(str(old_dir), ignore_errors=True)
            uuid = existing["id"]
        else:
            uuid = str(uuid_utils.uuid7())

        effect_dir = self._effects_dir / uuid
        assets_dir = effect_dir / "assets"
        assets_dir.mkdir(parents=True, exist_ok=True)

        # Copy assets from extracted location
        source_assets = manifest_path.parent / "assets"
        if source_assets.exists():
            for src_file in source_assets.rglob("*"):
                if src_file.is_file():
                    _validate_asset_filename(src_file.name)
                    ext = src_file.suffix.lower()
                    if src_file.stat().st_size > _max_size_for_ext(ext):
                        raise ValueError(f"Asset {src_file.name} exceeds size limit")

                    rel = src_file.relative_to(source_assets)
                    dest = assets_dir / rel
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(str(src_file), str(dest))

        # Save manifest
        shutil.copy2(str(manifest_path), str(effect_dir / "manifest.yaml"))

        source = "official" if manifest.namespace == "openeffect" else "archive"

        if existing:
            await self._update_effect(uuid, manifest, source, str(effect_dir), yaml_content=yaml_content)
        else:
            await self._insert_effect(
                uuid=uuid,
                manifest=manifest,
                source=source,
                assets_dir=str(effect_dir),
                yaml_content=yaml_content,
            )

        return manifest.full_id

    # ─── Save local effect ───

    async def save_local_effect(
        self, manifest: EffectManifest, yaml_content: str, existing_effect_id: str | None = None, fork_from: str | None = None
    ) -> str:
        """Save or update a locally created/forked effect. fork_from = namespace/id to copy assets from."""
        if existing_effect_id:
            # Update existing local effect
            parts = existing_effect_id.split("/", 1)
            if len(parts) != 2:
                raise ValueError("Invalid effect_id format")
            ns, eid = parts
            existing = await self._get_existing(ns, eid)
            if not existing:
                raise ValueError(f"Effect {existing_effect_id} not found")
            if existing["source"] not in ("local", "archive"):
                raise ValueError("Cannot edit non-local effects")

            uuid = existing["id"]
            effect_dir = Path(existing["assets_dir"])
            effect_dir.mkdir(parents=True, exist_ok=True)

            # Update manifest file
            (effect_dir / "manifest.yaml").write_text(yaml_content)

            await self._update_effect(uuid, manifest, "local", str(effect_dir), yaml_content=yaml_content)
        else:
            # Create new local effect — auto-suffix if ID already taken (like macOS file naming)
            import re
            base_id = manifest.id
            suffix = 1
            while await self._get_existing(manifest.namespace, manifest.id):
                suffix += 1
                new_id = f"{base_id}-{suffix}"
                data = manifest.model_dump()
                data["id"] = new_id
                manifest = EffectManifest(**data)
                yaml_content = re.sub(r'^id:\s*.+$', f'id: {new_id}', yaml_content, count=1, flags=re.MULTILINE)

            uuid = str(uuid_utils.uuid7())
            effect_dir = self._effects_dir / uuid
            assets_dir = effect_dir / "assets"
            assets_dir.mkdir(parents=True)

            # Copy assets from source effect if forking
            if fork_from:
                parts = fork_from.split("/", 1)
                if len(parts) == 2:
                    source = await self._get_existing(parts[0], parts[1])
                    if source:
                        source_assets = Path(source["assets_dir"]) / "assets"
                        if source_assets.exists():
                            for src_file in source_assets.iterdir():
                                if src_file.is_file():
                                    shutil.copy2(str(src_file), str(assets_dir / src_file.name))

            (effect_dir / "manifest.yaml").write_text(yaml_content)

            await self._insert_effect(
                uuid=uuid,
                manifest=manifest,
                source="local",
                assets_dir=str(effect_dir),
                yaml_content=yaml_content,
            )

        return manifest.full_id

    # ─── Uninstall ───

    async def uninstall(self, namespace: str, effect_id: str) -> None:
        db = await self._get_db()
        try:
            cursor = await db.execute(
                "SELECT id, source, assets_dir FROM effects WHERE namespace=? AND effect_id=?",
                (namespace, effect_id),
            )
            row = await cursor.fetchone()
            if not row:
                raise ValueError(f"Effect {namespace}/{effect_id} not found")

            if row["source"] == "official":
                raise ValueError("Cannot uninstall official effects")

            assets_dir = Path(row["assets_dir"])
            if assets_dir.exists():
                shutil.rmtree(str(assets_dir), ignore_errors=True)

            await db.execute("DELETE FROM effects WHERE id=?", (row["id"],))
            await db.commit()
        finally:
            await db.close()

    # ─── Update check ───

    async def check_for_update(
        self, namespace: str, effect_id: str
    ) -> dict[str, Any]:
        db = await self._get_db()
        try:
            cursor = await db.execute(
                "SELECT source_url, version FROM effects WHERE namespace=? AND effect_id=?",
                (namespace, effect_id),
            )
            row = await cursor.fetchone()
            if not row or not row["source_url"]:
                return {"available": False}

            async with httpx.AsyncClient(follow_redirects=True, timeout=15.0) as client:
                resp = await client.get(row["source_url"])
                resp.raise_for_status()
                remote = yaml.safe_load(resp.text)
                remote_version = remote.get("version", "0.0.0")

            return {
                "available": remote_version != row["version"],
                "current_version": row["version"],
                "remote_version": remote_version,
            }
        finally:
            await db.close()

    # ─── Helpers ───

    def _validate_namespace(self, namespace: str) -> None:
        if namespace.lower() in RESERVED_NAMESPACES:
            raise ValueError(f"Namespace '{namespace}' is reserved")

    async def _check_conflict(self, namespace: str, effect_id: str) -> None:
        db = await self._get_db()
        try:
            cursor = await db.execute(
                "SELECT id FROM effects WHERE namespace=? AND effect_id=?",
                (namespace, effect_id),
            )
            if await cursor.fetchone():
                raise ValueError(f"Effect {namespace}/{effect_id} already installed")
        finally:
            await db.close()

    async def _get_existing(self, namespace: str, effect_id: str) -> dict | None:
        db = await self._get_db()
        try:
            cursor = await db.execute(
                "SELECT * FROM effects WHERE namespace=? AND effect_id=?",
                (namespace, effect_id),
            )
            row = await cursor.fetchone()
            return dict(row) if row else None
        finally:
            await db.close()

    def _collect_asset_filenames(self, manifest: EffectManifest) -> list[str]:
        files = []
        if manifest.assets.preview:
            files.append(manifest.assets.preview)
        for filename in manifest.assets.inputs.values():
            files.append(filename)
        return files

    async def _insert_effect(
        self, uuid: str, manifest: EffectManifest, source: str, assets_dir: str, yaml_content: str | None = None
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        if yaml_content is None:
            yaml_content = yaml.dump(manifest.model_dump(), default_flow_style=False, sort_keys=False)
        db = await self._get_db()
        try:
            await db.execute(
                """INSERT INTO effects (id, namespace, effect_id, source, source_url, manifest_yaml, assets_dir, version, installed_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    uuid,
                    manifest.namespace,
                    manifest.id,
                    source,
                    manifest.url,
                    yaml_content,
                    assets_dir,
                    manifest.version,
                    now,
                    now,
                ),
            )
            await db.commit()
        finally:
            await db.close()

    async def _update_effect(
        self, uuid: str, manifest: EffectManifest, source: str, assets_dir: str, yaml_content: str | None = None
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        if yaml_content is None:
            yaml_content = yaml.dump(manifest.model_dump(), default_flow_style=False, sort_keys=False)
        db = await self._get_db()
        try:
            await db.execute(
                """UPDATE effects SET namespace=?, effect_id=?, source=?, source_url=?,
                   manifest_yaml=?, assets_dir=?, version=?, updated_at=?
                   WHERE id=?""",
                (
                    manifest.namespace,
                    manifest.id,
                    source,
                    manifest.url,
                    yaml_content,
                    assets_dir,
                    manifest.version,
                    now,
                    uuid,
                ),
            )
            await db.commit()
        finally:
            await db.close()

    async def effect_count(self) -> int:
        db = await self._get_db()
        try:
            cursor = await db.execute("SELECT COUNT(*) FROM effects")
            row = await cursor.fetchone()
            return row[0] if row else 0
        finally:
            await db.close()

    async def get_all_effects(self) -> list[dict[str, Any]]:
        db = await self._get_db()
        try:
            cursor = await db.execute("SELECT * FROM effects ORDER BY installed_at")
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]
        finally:
            await db.close()
