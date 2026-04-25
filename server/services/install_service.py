import io
import ipaddress
import logging
import re
import shutil
import socket
import tempfile
import zipfile
from datetime import datetime, timedelta, timezone
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


def _parse_manifest_yaml(yaml_text: str) -> tuple[dict[str, Any], EffectManifest]:
    """Parse + validate manifest YAML. Maps `yaml.YAMLError` and Pydantic's
    `ValidationError` (neither of which is a `ValueError`) to a `ValueError`
    with a human-readable message, so the route layer's `except ValueError`
    arms can return a clean 400 instead of the request bubbling up to a 500
    with a stack trace."""
    try:
        data = yaml.safe_load(yaml_text)
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

    return data, manifest


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

            data, manifest = _parse_manifest_yaml(resp.text)
            base_url = url.rsplit("/", 1)[0] + "/"
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
        """Install one manifest via the state lifecycle:

        - INSERT or `_mark_installing` flips the row to `state='installing'`
          (invisible to the loader) before any files land on disk.
        - On success, `_update_effect` flips `state='ready'` and writes
          the new manifest content in one transaction.
        - On any failure, `_cleanup_failed` drops the row and the folder.

        Conflict detection (different installed version) is the caller's
        job; this method handles the same-version no-op skip and the
        replace-in-place flow."""
        existing = await self.get_effect(manifest.namespace, manifest.slug)
        if (
            existing
            and existing["state"] == "ready"
            and existing["version"] == manifest.version
        ):
            return manifest.full_id

        uuid = existing["id"] if existing else str(uuid_utils.uuid7())
        effect_dir = self._effects_dir / uuid
        # Same dump kwargs for both DB column and on-disk file so the two
        # never disagree on key ordering.
        yaml_content = yaml.dump(data, default_flow_style=False, sort_keys=False)

        if existing:
            await self._mark_installing(uuid)
        else:
            await self._insert_effect(
                uuid, manifest, "installed", str(effect_dir),
                yaml_content=yaml_content,
            )

        try:
            if effect_dir.exists():
                shutil.rmtree(str(effect_dir), ignore_errors=True)
            assets_dir = effect_dir / "assets"
            assets_dir.mkdir(parents=True)

            total_size = 0
            for filename in self._collect_asset_filenames(manifest):
                _validate_asset_filename(filename)
                resp = await client.get(base_url + "assets/" + filename)
                resp.raise_for_status()

                ext = Path(filename).suffix.lower()
                if len(resp.content) > _max_size_for_ext(ext):
                    raise ValueError(f"Asset {filename} exceeds size limit")

                total_size += len(resp.content)
                if total_size > MAX_TOTAL_SIZE:
                    raise ValueError("Total effect size exceeds limit")

                dest = assets_dir / filename
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(resp.content)

            (effect_dir / "manifest.yaml").write_text(yaml_content)

            await self._update_effect(
                uuid, manifest, "installed", str(effect_dir),
                yaml_content=yaml_content,
            )
        except Exception:
            await self._cleanup_failed(uuid, effect_dir)
            raise

        return manifest.full_id

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
            try:
                _, manifest = _parse_manifest_yaml(manifest_path.read_text())
            except ValueError as e:
                # Surface which manifest in the archive is bad so the user
                # knows where to look — the bare error wouldn't say.
                rel = manifest_path.relative_to(folder) if folder in manifest_path.parents else manifest_path.name
                raise ValueError(f"{rel}: {e}")
            pending.append((manifest_path, manifest))

        # Validate every namespace upfront so a single bad manifest can't
        # leave the archive half-installed — the per-effect install loop
        # below assumes everything in `pending` is already cleared.
        if not allow_official:
            for _, m in pending:
                self._validate_namespace(m.namespace)

        if not allow_official and not overwrite:
            conflicts = await self._detect_conflicts([m for _, m in pending])
            if conflicts:
                raise InstallConflictError(conflicts)

        installed = []
        for manifest_path, manifest in pending:
            full_id = await self._install_from_extracted(manifest_path, manifest, allow_official)
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
            _, m = _parse_manifest_yaml(mp.read_text())
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
        self, manifest_path: Path, manifest: EffectManifest, allow_official: bool
    ) -> str:
        """Install one manifest from an extracted archive folder via the
        same INSERT installing → write → UPDATE ready lifecycle as the
        URL path. Caller has already parsed + validated the manifest,
        checked the namespace, and resolved conflicts."""
        yaml_content = manifest_path.read_text()
        # Bundled namespace `openeffect/*` is reserved by the validator
        # for the official set, so a manifest reaching this point under
        # that namespace can only have come through `allow_official=True`.
        source = "official" if manifest.namespace == "openeffect" else "installed"

        existing = await self.get_effect(manifest.namespace, manifest.slug)
        if (
            existing
            and existing["state"] == "ready"
            and existing["version"] == manifest.version
        ):
            return manifest.full_id

        uuid = existing["id"] if existing else str(uuid_utils.uuid7())
        effect_dir = self._effects_dir / uuid

        if existing:
            await self._mark_installing(uuid)
        else:
            await self._insert_effect(
                uuid, manifest, source, str(effect_dir),
                yaml_content=yaml_content,
            )

        try:
            if effect_dir.exists():
                shutil.rmtree(str(effect_dir), ignore_errors=True)
            assets_dir = effect_dir / "assets"
            assets_dir.mkdir(parents=True)

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

            await self._update_effect(
                uuid, manifest, source, str(effect_dir),
                yaml_content=yaml_content,
            )
        except Exception:
            await self._cleanup_failed(uuid, effect_dir)
            raise

        return manifest.full_id

    # ─── Save local effect ───

    async def save_local_effect(
        self,
        manifest: EffectManifest,
        yaml_content: str,
        existing_id: str | None = None,
        fork_from: str | None = None,
    ) -> str:
        """Save or update a locally created/forked effect. `fork_from` =
        `namespace/slug` to copy assets from on a fresh fork.

        - Update path: write the new manifest.yaml in place, then UPDATE
          the row to `state='ready'` with the new content. No installing
          lifecycle — this is a small in-place edit, the row's existing
          content is the user's last known good state and DELETE-on-fail
          would lose the data they're trying to save.
        - Create path: full INSERT installing → mkdir + fork-copy + write
          → UPDATE ready lifecycle. On failure, the row + folder are
          cleaned by `_cleanup_failed` and the user retries."""
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
            await self._update_effect(
                uuid, manifest, "local", str(effect_dir), yaml_content=yaml_content,
            )
            return manifest.full_id

        # Create path
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

        await self._insert_effect(
            uuid, manifest, "local", str(effect_dir),
            yaml_content=yaml_content,
        )

        try:
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
                                    shutil.copy2(
                                        str(src_file),
                                        str(assets_dir / src_file.name),
                                    )

            (effect_dir / "manifest.yaml").write_text(yaml_content)

            await self._update_effect(
                uuid, manifest, "local", str(effect_dir),
                yaml_content=yaml_content,
            )
        except Exception:
            await self._cleanup_failed(uuid, effect_dir)
            raise

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
        _, manifest = _parse_manifest_yaml(yaml_content)
        return await self.save_local_effect(
            manifest, yaml_content, existing_id, fork_from=fork_from
        )

    # ─── Uninstall ───

    async def uninstall(self, namespace: str, slug: str) -> None:
        """Lifecycle-tracked uninstall: flip the row to
        `state='uninstalling'` first (so the loader hides the effect
        immediately), then rmtree the folder, then DELETE the row.

        Crash recovery is automatic: a row stuck in `uninstalling`
        for >1h gets finished by `prune_stale_lifecycle_rows`. The
        DELETE is gated `AND state='uninstalling'` so a concurrent
        writer that flipped the row back to `ready` (e.g. an immediate
        reinstall during the rmtree window) doesn't have its row
        wiped out from under it."""
        row = await self._db.fetchone(
            "SELECT id, source, assets_dir FROM effects WHERE namespace=? AND slug=?",
            (namespace, slug),
        )
        if not row:
            raise ValueError(f"Effect {namespace}/{slug} not found")

        if row["source"] == "official":
            raise ValueError("Cannot uninstall official effects")

        await self._mark_uninstalling(row["id"])

        assets_dir = Path(row["assets_dir"])
        if assets_dir.exists():
            shutil.rmtree(str(assets_dir), ignore_errors=True)

        async with self._db.transaction() as conn:
            await conn.execute(
                "DELETE FROM effects WHERE id=? AND state='uninstalling'",
                (row["id"],),
            )

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
            try:
                remote = yaml.safe_load(resp.text)
            except yaml.YAMLError as e:
                raise ValueError(f"Update check failed — remote YAML is invalid: {e}")
            if not isinstance(remote, dict):
                raise ValueError("Update check failed — remote did not return a manifest")
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
        self,
        uuid: str,
        manifest: EffectManifest,
        source: str,
        assets_dir: str,
        yaml_content: str | None = None,
        *,
        state: str = "installing",
    ) -> None:
        """Insert an effect row. Defaults to `state='installing'` — call
        `_mark_ready` after the on-disk install completes. Pass
        `state='ready'` to skip the lifecycle for special paths (none
        today; the parameter is kept for forward compat / tests)."""
        now = datetime.now(timezone.utc).isoformat()
        if yaml_content is None:
            yaml_content = yaml.dump(manifest.model_dump(), default_flow_style=False, sort_keys=False)
        async with self._db.transaction() as conn:
            await conn.execute(
                """INSERT INTO effects (
                       id, namespace, slug, source, state, source_url,
                       manifest_yaml, assets_dir, version, installed_at, updated_at
                   ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    uuid,
                    manifest.namespace,
                    manifest.slug,
                    source,
                    state,
                    manifest.url,
                    yaml_content,
                    assets_dir,
                    manifest.version,
                    now,
                    now,
                ),
            )

    async def _update_effect(
        self,
        uuid: str,
        manifest: EffectManifest,
        source: str,
        assets_dir: str,
        yaml_content: str | None = None,
        *,
        state: str = "ready",
    ) -> None:
        """Full-row update. Defaults to `state='ready'` — used by every
        install path's commit step, and by save-local-effect's update
        branch which doesn't go through the installing→ready lifecycle.

        Raises `ValueError` if the row has been deleted out from under
        us (concurrent GC reaper). In install paths the caller's
        `except` arm catches this and runs `_cleanup_failed` so the
        on-disk folder doesn't outlive the missing row."""
        now = datetime.now(timezone.utc).isoformat()
        if yaml_content is None:
            yaml_content = yaml.dump(manifest.model_dump(), default_flow_style=False, sort_keys=False)
        async with self._db.transaction() as conn:
            cursor = await conn.execute(
                """UPDATE effects SET namespace=?, slug=?, source=?, state=?, source_url=?,
                   manifest_yaml=?, assets_dir=?, version=?, updated_at=?
                   WHERE id=?""",
                (
                    manifest.namespace,
                    manifest.slug,
                    source,
                    state,
                    manifest.url,
                    yaml_content,
                    assets_dir,
                    manifest.version,
                    now,
                    uuid,
                ),
            )
            if cursor.rowcount == 0:
                raise ValueError(f"Effect {uuid} no longer exists (concurrent delete)")

    async def _mark_installing(self, uuid: str) -> None:
        """Flag an existing row as being replaced. Bumps `updated_at` so
        the GC reaper's "abandoned > 1h" rule can detect a stuck install,
        but leaves manifest content untouched — until the new install
        commits via `_update_effect`, the old `manifest_yaml`/`version`
        in the row are still what we'd revert to. The row is invisible
        to the loader during this window because of the state filter.

        Raises `ValueError` if the row has been deleted between the
        caller's `get_effect` and this UPDATE (e.g. by the GC reaper
        catching it as abandoned). The caller's `except` arm runs
        `_cleanup_failed` and surfaces the error; the user retries and
        the retry takes the no-existing path (fresh INSERT)."""
        now = datetime.now(timezone.utc).isoformat()
        async with self._db.transaction() as conn:
            cursor = await conn.execute(
                "UPDATE effects SET state='installing', updated_at=? WHERE id=?",
                (now, uuid),
            )
            if cursor.rowcount == 0:
                raise ValueError(f"Effect {uuid} no longer exists (concurrent delete)")

    async def _mark_uninstalling(self, uuid: str) -> None:
        """Flag a row as being torn down. Symmetric with `_mark_installing`:
        bumps `updated_at` so the reaper can finish the cleanup if this
        process crashes after the flip, and the loader's `state='ready'`
        filter immediately hides the effect from the gallery.

        Raises `ValueError` on rowcount=0 — same defensive guard as
        `_mark_installing` against concurrent deletes (the reaper might
        have caught the row as abandoned and finished the work first)."""
        now = datetime.now(timezone.utc).isoformat()
        async with self._db.transaction() as conn:
            cursor = await conn.execute(
                "UPDATE effects SET state='uninstalling', updated_at=? WHERE id=?",
                (now, uuid),
            )
            if cursor.rowcount == 0:
                raise ValueError(f"Effect {uuid} no longer exists (concurrent delete)")

    async def _cleanup_failed(self, uuid: str, effect_dir: Path) -> None:
        """Last step of every install path's `except` arm: drop the row
        and rmtree the folder. The `AND state='installing'` guard makes
        the DELETE a no-op if some other coroutine already flipped the
        row to `ready` between our failure and this cleanup — we'd
        rather leak a folder than wipe a row a different writer just
        committed. The rmtree is best-effort; a left-behind folder will
        be referenced by no DB row and can be picked up later by an
        explicit ad-hoc cleanup (out of scope here)."""
        async with self._db.transaction() as conn:
            await conn.execute(
                "DELETE FROM effects WHERE id=? AND state='installing'",
                (uuid,),
            )
        if effect_dir.exists():
            shutil.rmtree(str(effect_dir), ignore_errors=True)

    async def effect_count(self) -> int:
        row = await self._db.fetchone(
            "SELECT COUNT(*) FROM effects WHERE state = 'ready'"
        )
        return row[0] if row else 0

    async def get_all_effects(self) -> list[dict[str, Any]]:
        """Return only `ready` effects. In-flight installs and uninstalls
        (`state` in `installing`/`uninstalling`) are server-internal and
        never surface in the gallery, the editor list, the API, or this
        method. The reaper / `_cleanup_failed` / `uninstall` paths are
        responsible for transitioning them out of those transient states."""
        rows = await self._db.fetchall(
            "SELECT * FROM effects WHERE state = 'ready' ORDER BY installed_at DESC"
        )
        return [dict(row) for row in rows]

    # ─── GC reaper hook ───

    async def prune_stale_lifecycle_rows(self, max_age_hours: int) -> int:
        """Finish or abandon rows stuck in a transient lifecycle state
        for longer than `max_age_hours`:

        - `state='installing'` from a crashed install → roll back
          (row + folder gone).
        - `state='uninstalling'` from a crashed uninstall → finish the
          teardown (row + folder gone).

        Same safety ordering as `storage_service.prune_orphans`: rmtree
        first (so a permission error halts the cycle and the row stays
        for the next iteration to retry), then DELETE.

        The DELETE is gated `AND state IN ('installing', 'uninstalling')
        AND updated_at < ?` so that a row whose timestamp was just
        refreshed by a concurrent retry escapes cleanup, and a row that
        was committed to `ready` between SELECT and DELETE isn't wiped
        either.

        Returns the number of rows pruned. Called from `_gc_loop` in
        `main.py` once at startup (which doubles as boot recovery) and
        then on a sleep-loop."""
        cutoff = (
            datetime.now(timezone.utc) - timedelta(hours=max_age_hours)
        ).isoformat()

        rows = await self._db.fetchall(
            "SELECT id, assets_dir, state FROM effects "
            "WHERE state IN ('installing', 'uninstalling') AND updated_at < ?",
            (cutoff,),
        )
        pruned = 0
        for row in rows:
            try:
                assets_dir = Path(row["assets_dir"])
                if assets_dir.exists():
                    shutil.rmtree(str(assets_dir))
            except Exception:
                # Disk might be wedged; leave the row, retry next cycle.
                continue

            async with self._db.transaction() as conn:
                await conn.execute(
                    "DELETE FROM effects "
                    "WHERE id = ? AND state IN ('installing', 'uninstalling') "
                    "AND updated_at < ?",
                    (row["id"], cutoff),
                )
            pruned += 1
        return pruned
