import io
import ipaddress
import logging
import re
import shutil
import socket
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
import uuid_utils
import yaml
from pydantic import ValidationError

from core.limits import MAX_IMAGE_SIZE, MAX_TOTAL_SIZE, MAX_VIDEO_SIZE
from db.database import Database
from effects.validator import EffectManifest

logger = logging.getLogger(__name__)

# Security limits
MAX_MANIFEST_SIZE = 100 * 1024       # 100 KB
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


def _validate_install_url(url: str) -> None:
    """Reject install URLs that could pull data from local / private hosts.

    Guards against SSRF from user-pasted URLs:
    - Only http / https schemes (blocks file:// data: gopher:// etc.)
    - Host must resolve — and every resolved address must be a public IP
      (no loopback 127.*, no RFC1918 10/172.16/192.168, no link-local
      169.254.* that includes AWS metadata, no reserved/multicast)

    Raises ValueError with a user-facing message on rejection."""
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise ValueError(f"Only http/https URLs are supported (got '{parsed.scheme or 'no scheme'}')")
    host = parsed.hostname
    if not host:
        raise ValueError("URL is missing a hostname")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as e:
        raise ValueError(f"Cannot resolve host '{host}': {e}") from e
    for info in infos:
        addr = info[4][0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            continue
        if (
            ip.is_loopback
            or ip.is_private
            or ip.is_link_local
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise ValueError(
                f"Refusing to fetch from {addr} — only public addresses allowed"
            )


def _max_size_for_ext(ext: str) -> int:
    if ext in (".mp4", ".webm"):
        return MAX_VIDEO_SIZE
    return MAX_IMAGE_SIZE


class InstallConflictError(Exception):
    """Raised when one or more incoming manifests already exist in the DB at a
    different version. `conflicts` is a list of dicts with keys
    `namespace`, `id`, `name`, `existing_version`, `incoming_version`,
    `existing_source` — the route layer forwards this to the client as 409."""
    def __init__(self, conflicts: list[dict]):
        super().__init__(f"{len(conflicts)} effect(s) already installed")
        self.conflicts = conflicts


class InstallService:
    def __init__(self, db: Database, effects_dir: Path):
        self._db = db
        self._effects_dir = effects_dir
        self._effects_dir.mkdir(parents=True, exist_ok=True)

    @property
    def effects_dir(self) -> Path:
        """Where installed effect packages live on disk."""
        return self._effects_dir

    # ─── Install from URL ───

    async def install_from_url(self, url: str, overwrite: bool = False) -> list[str]:
        """Fetch a single manifest from URL, download its assets, install.

        Returns a one-element list to match `install_from_archive`'s shape
        (the route hands both through the same response). When `overwrite`
        is False and the effect already exists at a different version,
        raise `InstallConflictError`."""
        _validate_install_url(url)
        # Redirects disabled so the SSRF guard above isn't bypassed via a
        # 3xx to a private address. Authors should paste the final URL
        # (e.g. raw.githubusercontent.com, not a redirect).
        async with httpx.AsyncClient(follow_redirects=False, timeout=30.0) as client:
            resp = await client.get(url)
            resp.raise_for_status()

            if len(resp.content) > MAX_MANIFEST_SIZE:
                raise ValueError("Manifest too large")

            data = yaml.safe_load(resp.text)
            if not isinstance(data, dict) or "id" not in data:
                raise ValueError("URL did not return a valid manifest YAML")

            base_url = url.rsplit("/", 1)[0] + "/"
            manifest = EffectManifest(**data)
            self._validate_namespace(manifest.namespace)

            if not overwrite:
                conflicts = await self._detect_conflicts([manifest])
                if conflicts:
                    raise InstallConflictError(conflicts)

            full_id = await self._install_single_from_url(
                client, base_url, data, manifest
            )
            return [full_id]

    async def _install_single_from_url(
        self,
        client: httpx.AsyncClient,
        base_url: str,
        data: dict[str, Any],
        manifest: EffectManifest,
    ) -> str:
        """Install one manifest. Updates in place if an effect with the same
        namespace/slug already exists (conflict detection is caller's job)."""
        existing = await self.get_effect(manifest.namespace, manifest.slug)
        if existing and existing["version"] == manifest.version:
            return manifest.full_id

        if existing:
            old_dir = Path(existing["assets_dir"])
            if old_dir.exists():
                shutil.rmtree(str(old_dir), ignore_errors=True)
            uuid = existing["id"]
        else:
            uuid = str(uuid_utils.uuid7())

        effect_dir = self._effects_dir / uuid
        assets_dir = effect_dir / "assets"
        assets_dir.mkdir(parents=True, exist_ok=True)

        total_size = 0
        try:
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

            (effect_dir / "manifest.yaml").write_text(
                yaml.dump(data, default_flow_style=False)
            )

            yaml_content = yaml.dump(data, default_flow_style=False, sort_keys=False)
            if existing:
                await self._update_effect(
                    uuid, manifest, "installed", str(effect_dir), yaml_content=yaml_content
                )
            else:
                await self._insert_effect(
                    uuid=uuid,
                    manifest=manifest,
                    source="installed",
                    assets_dir=str(effect_dir),
                    yaml_content=yaml_content,
                )

            return manifest.full_id

        except Exception:
            if not existing:
                shutil.rmtree(str(effect_dir), ignore_errors=True)
            raise

    # ─── Install from archive ───

    async def install_from_archive(
        self, file_bytes: bytes, allow_official: bool = False, overwrite: bool = False
    ) -> list[str]:
        """Extract ZIP, validate manifests, install effects.

        Used by the upload-ZIP UI flow; the boot-time bundled sync uses
        `install_from_folder` directly against the repo's `effects/` tree.
        Same conflict semantics as `install_from_folder`."""
        if not zipfile.is_zipfile(io.BytesIO(file_bytes)):
            raise ValueError("Not a valid ZIP archive")

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
                if len(zf.namelist()) > MAX_ZIP_FILES:
                    raise ValueError(f"ZIP has too many files (max {MAX_ZIP_FILES})")

                total_size = sum(info.file_size for info in zf.infolist())
                if total_size > MAX_TOTAL_SIZE:
                    raise ValueError("ZIP extracted size exceeds limit")

                for info in zf.infolist():
                    if ".." in info.filename or info.filename.startswith("/"):
                        raise ValueError(f"Path traversal in ZIP: {info.filename}")
                    # External-attribute high bits carry the Unix mode. A
                    # symlink in a zip can point anywhere on disk once
                    # extracted; reject outright rather than trying to sort
                    # safe vs unsafe targets.
                    mode = (info.external_attr >> 16) & 0xFFFF
                    if mode and (mode & 0o170000) == 0o120000:
                        raise ValueError(f"Symlink not allowed in ZIP: {info.filename}")

                zf.extractall(tmp_path)

            return await self.install_from_folder(tmp_path, allow_official, overwrite)

    async def install_from_folder(
        self, folder: Path, allow_official: bool = False, overwrite: bool = False
    ) -> list[str]:
        """Install every effect found under `folder` by scanning for
        `manifest.yaml` files (rglob).

        When `overwrite` is False and an incoming manifest already exists at a
        different version, raise `InstallConflictError` without touching disk
        or DB — the route layer surfaces that to the client for confirmation.
        Boot-time bundled sync passes `allow_official=True` which skips the
        conflict prompt (silent update)."""
        manifest_paths = self._find_manifests(folder)
        if not manifest_paths:
            raise ValueError(f"No manifest.yaml found under {folder}")

        pending: list[tuple[Path, EffectManifest]] = []
        for manifest_path in manifest_paths:
            data = yaml.safe_load(manifest_path.read_text())
            manifest = EffectManifest(**data)
            pending.append((manifest_path, manifest))

        if not allow_official and not overwrite:
            conflicts = await self._detect_conflicts([m for _, m in pending])
            if conflicts:
                raise InstallConflictError(conflicts)

        installed = []
        for manifest_path, _ in pending:
            full_id = await self._install_from_extracted(manifest_path, allow_official)
            installed.append(full_id)

        return installed

    async def sync_bundled_folder(self, folder: Path) -> list[str]:
        """Install the current bundled effect set and demote any previously-
        bundled effect that's no longer in `folder` from `source='official'`
        to `source='installed'` — so effects dropped from a future release
        become user-deletable instead of stuck. Files stay on disk so any
        historical runs that reference them keep working."""
        manifest_paths = self._find_manifests(folder) if folder.exists() else []

        pending_ids: set[tuple[str, str]] = set()
        for mp in manifest_paths:
            data = yaml.safe_load(mp.read_text())
            m = EffectManifest(**data)
            pending_ids.add((m.namespace, m.slug))

        installed: list[str] = []
        if manifest_paths:
            installed = await self.install_from_folder(folder, allow_official=True)

        orphans = await self._db.fetchall(
            "SELECT id, namespace, slug FROM effects WHERE source = 'official'"
        )
        for row in orphans:
            if (row["namespace"], row["slug"]) in pending_ids:
                continue
            async with self._db.transaction() as conn:
                await conn.execute(
                    "UPDATE effects SET source = 'installed' WHERE id = ?",
                    (row["id"],),
                )
            logger.info(
                "Demoted dropped bundled effect %s/%s to installed",
                row["namespace"], row["slug"],
            )

        return installed

    def _find_manifests(self, root: Path) -> list[Path]:
        """Find every `manifest.yaml` under `root` (recursive)."""
        return sorted(root.rglob("manifest.yaml"))

    async def _install_from_extracted(
        self, manifest_path: Path, allow_official: bool
    ) -> str:
        yaml_content = manifest_path.read_text()
        data = yaml.safe_load(yaml_content)
        manifest = EffectManifest(**data)

        if not allow_official:
            self._validate_namespace(manifest.namespace)

        existing = await self.get_effect(manifest.namespace, manifest.slug)
        if existing and existing["version"] == manifest.version:
            return manifest.full_id

        if existing:
            old_dir = Path(existing["assets_dir"])
            if old_dir.exists():
                shutil.rmtree(str(old_dir), ignore_errors=True)
            uuid = existing["id"]
        else:
            uuid = str(uuid_utils.uuid7())

        effect_dir = self._effects_dir / uuid
        assets_dir = effect_dir / "assets"
        assets_dir.mkdir(parents=True, exist_ok=True)

        # Only copy manifest-declared assets, mirroring the URL install
        # path. Anything else in the zip's assets/ folder is silently
        # ignored — the manifest is the contract, not the archive layout.
        source_assets = manifest_path.parent / "assets"
        for filename in self._collect_asset_filenames(manifest):
            _validate_asset_filename(filename)
            src_file = source_assets / filename
            if not src_file.is_file():
                raise ValueError(
                    f"Asset '{filename}' declared in manifest but missing from archive"
                )
            ext = src_file.suffix.lower()
            if src_file.stat().st_size > _max_size_for_ext(ext):
                raise ValueError(f"Asset {filename} exceeds size limit")
            dest = assets_dir / filename
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(src_file), str(dest))

        shutil.copy2(str(manifest_path), str(effect_dir / "manifest.yaml"))

        source = "official" if manifest.namespace == "openeffect" else "installed"

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
        self,
        manifest: EffectManifest,
        yaml_content: str,
        existing_id: str | None = None,
        fork_from: str | None = None,
    ) -> str:
        """Save or update a locally created/forked effect. fork_from = namespace/slug to copy assets from."""
        if existing_id:
            existing: dict[str, Any] | None = None
            if "/" in existing_id:
                ns, eid = existing_id.split("/", 1)
                existing = await self.get_effect(ns, eid)
            else:
                existing = await self.get_effect_by_uuid(existing_id)
            if not existing:
                raise ValueError(f"Effect {existing_id} not found")
            if existing["source"] not in ("local", "installed"):
                raise ValueError("Cannot edit non-local effects")

            uuid = existing["id"]
            effect_dir = Path(existing["assets_dir"])
            effect_dir.mkdir(parents=True, exist_ok=True)

            (effect_dir / "manifest.yaml").write_text(yaml_content)

            await self._update_effect(uuid, manifest, "local", str(effect_dir), yaml_content=yaml_content)
        else:
            base_slug = manifest.slug
            suffix = 1
            while await self.get_effect(manifest.namespace, manifest.slug):
                suffix += 1
                new_slug = f"{base_slug}-{suffix}"
                data = manifest.model_dump()
                data["slug"] = new_slug
                manifest = EffectManifest(**data)
                yaml_content = re.sub(
                    r'^id:\s*.+$',
                    f'id: {manifest.namespace}/{new_slug}',
                    yaml_content, count=1, flags=re.MULTILINE,
                )

            uuid = str(uuid_utils.uuid7())
            effect_dir = self._effects_dir / uuid
            assets_dir = effect_dir / "assets"
            assets_dir.mkdir(parents=True)

            if fork_from:
                parts = fork_from.split("/", 1)
                if len(parts) == 2:
                    source = await self.get_effect(parts[0], parts[1])
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

    async def save_yaml(
        self,
        yaml_content: str,
        existing_id: str | None = None,
        fork_from: str | None = None,
    ) -> str:
        """Parse + validate manifest YAML and persist via `save_local_effect`.
        All failure modes surface as `ValueError` so the route layer can map
        them to HTTP 400 without seeing implementation details."""
        try:
            data = yaml.safe_load(yaml_content)
        except yaml.YAMLError as e:
            mark = getattr(e, "problem_mark", None)
            loc = f" (line {mark.line + 1})" if mark else ""
            raise ValueError(f"Invalid YAML syntax{loc}: {getattr(e, 'problem', str(e))}")

        if not isinstance(data, dict):
            raise ValueError("YAML must be a mapping (key: value pairs)")

        try:
            manifest = EffectManifest(**data)
        except ValidationError as e:
            errors = [f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}" for err in e.errors()]
            raise ValueError("; ".join(errors))

        return await self.save_local_effect(
            manifest, yaml_content, existing_id, fork_from=fork_from
        )

    # ─── Uninstall ───

    async def uninstall(self, namespace: str, slug: str) -> None:
        row = await self._db.fetchone(
            "SELECT id, source, assets_dir FROM effects WHERE namespace=? AND slug=?",
            (namespace, slug),
        )
        if not row:
            raise ValueError(f"Effect {namespace}/{slug} not found")

        if row["source"] == "official":
            raise ValueError("Cannot uninstall official effects")

        assets_dir = Path(row["assets_dir"])
        if assets_dir.exists():
            shutil.rmtree(str(assets_dir), ignore_errors=True)

        async with self._db.transaction() as conn:
            await conn.execute("DELETE FROM effects WHERE id=?", (row["id"],))

    # ─── Source / favorite toggles ───

    async def set_source(self, namespace: str, slug: str, new_source: str) -> None:
        """Move a non-official effect between the `installed` and `local`
        buckets. Idempotent no-op when already at `new_source`. Rejects
        attempts to touch official effects or to set any value outside
        the two allowed strings."""
        if new_source not in ("installed", "local"):
            raise ValueError(
                f"Invalid source '{new_source}' — must be 'installed' or 'local'"
            )
        existing = await self.get_effect(namespace, slug)
        if not existing:
            raise ValueError(f"Effect {namespace}/{slug} not found")
        if existing["source"] == "official":
            raise ValueError("Cannot change the source of official effects")
        if existing["source"] == new_source:
            return  # no-op

        async with self._db.transaction() as conn:
            await conn.execute(
                "UPDATE effects SET source=? WHERE namespace=? AND slug=?",
                (new_source, namespace, slug),
            )

    async def set_favorite(self, namespace: str, slug: str, favorite: bool) -> None:
        existing = await self.get_effect(namespace, slug)
        if not existing:
            raise ValueError(f"Effect {namespace}/{slug} not found")

        async with self._db.transaction() as conn:
            await conn.execute(
                "UPDATE effects SET is_favorite=? WHERE namespace=? AND slug=?",
                (1 if favorite else 0, namespace, slug),
            )

    # ─── Update check ───

    async def check_for_update(
        self, namespace: str, slug: str
    ) -> dict[str, Any]:
        row = await self._db.fetchone(
            "SELECT source_url, version FROM effects WHERE namespace=? AND slug=?",
            (namespace, slug),
        )
        if not row or not row["source_url"]:
            return {"available": False}

        _validate_install_url(row["source_url"])
        async with httpx.AsyncClient(follow_redirects=False, timeout=15.0) as client:
            resp = await client.get(row["source_url"])
            resp.raise_for_status()
            remote = yaml.safe_load(resp.text)
            remote_version = remote.get("version", "0.0.0")

        return {
            "available": remote_version != row["version"],
            "current_version": row["version"],
            "remote_version": remote_version,
        }

    # ─── Helpers ───

    def _validate_namespace(self, namespace: str) -> None:
        if namespace.lower() in RESERVED_NAMESPACES:
            raise ValueError(f"Namespace '{namespace}' is reserved")

    async def _detect_conflicts(self, manifests: list[EffectManifest]) -> list[dict]:
        """For each incoming manifest, check if an effect with the same
        (namespace, slug) is already installed at a DIFFERENT version. Same-version
        installs are silent no-ops and aren't reported as conflicts."""
        conflicts: list[dict] = []
        for manifest in manifests:
            existing = await self.get_effect(manifest.namespace, manifest.slug)
            if not existing:
                continue
            if existing["version"] == manifest.version:
                continue
            conflicts.append({
                "namespace": manifest.namespace,
                "slug": manifest.slug,
                "name": manifest.name,
                "existing_version": existing["version"],
                "incoming_version": manifest.version,
                "existing_source": existing["source"],
            })
        return conflicts

    async def get_effect(self, namespace: str, slug: str) -> dict | None:
        row = await self._db.fetchone(
            "SELECT * FROM effects WHERE namespace=? AND slug=?",
            (namespace, slug),
        )
        return dict(row) if row else None

    async def get_effect_by_uuid(self, uuid: str) -> dict | None:
        row = await self._db.fetchone("SELECT * FROM effects WHERE id=?", (uuid,))
        return dict(row) if row else None

    def _collect_asset_filenames(self, manifest: EffectManifest) -> list[str]:
        files: list[str] = []
        for sc in manifest.showcases:
            if sc.preview:
                files.append(sc.preview)
            files.extend(sc.inputs.values())
        return files

    async def _insert_effect(
        self, uuid: str, manifest: EffectManifest, source: str, assets_dir: str, yaml_content: str | None = None
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        if yaml_content is None:
            yaml_content = yaml.dump(manifest.model_dump(), default_flow_style=False, sort_keys=False)
        async with self._db.transaction() as conn:
            await conn.execute(
                """INSERT INTO effects (
                       id, namespace, slug, source, source_url,
                       manifest_yaml, assets_dir, version, installed_at, updated_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    uuid,
                    manifest.namespace,
                    manifest.slug,
                    source,
                    manifest.url,
                    yaml_content,
                    assets_dir,
                    manifest.version,
                    now,
                    now,
                ),
            )

    async def _update_effect(
        self, uuid: str, manifest: EffectManifest, source: str, assets_dir: str, yaml_content: str | None = None
    ) -> None:
        now = datetime.now(timezone.utc).isoformat()
        if yaml_content is None:
            yaml_content = yaml.dump(manifest.model_dump(), default_flow_style=False, sort_keys=False)
        async with self._db.transaction() as conn:
            await conn.execute(
                """UPDATE effects SET namespace=?, slug=?, source=?, source_url=?,
                   manifest_yaml=?, assets_dir=?, version=?, updated_at=?
                   WHERE id=?""",
                (
                    manifest.namespace,
                    manifest.slug,
                    source,
                    manifest.url,
                    yaml_content,
                    assets_dir,
                    manifest.version,
                    now,
                    uuid,
                ),
            )

    async def effect_count(self) -> int:
        row = await self._db.fetchone("SELECT COUNT(*) FROM effects")
        return row[0] if row else 0

    async def get_all_effects(self) -> list[dict[str, Any]]:
        rows = await self._db.fetchall("SELECT * FROM effects ORDER BY installed_at DESC")
        return [dict(row) for row in rows]
