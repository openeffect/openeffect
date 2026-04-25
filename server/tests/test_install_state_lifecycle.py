"""Tests for the DB-state install/uninstall lifecycle.

Each install path goes `INSERT installing → adopt assets → UPDATE ready`.
The loader filters on `state='ready'`, so in-flight or crashed installs
are invisible to users. The reaper (`prune_stale_lifecycle_rows`) cleans
abandoned `installing` and `uninstalling` rows after a TTL.
"""
import io
import zipfile
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import patch

import pytest
import yaml
from PIL import Image

from db.database import Database, init_db
from services.file_service import FileService
from services.install_service import InstallService, _validate_asset_filename

MANIFEST_BASE: dict[str, Any] = {
    "id": "tester/demo",
    "name": "Demo",
    "description": "Demo effect",
    "version": "1.0.0",
    "author": "tester",
    "category": "transform",
    "tags": [],
    "showcases": [],
    "inputs": {
        "image": {
            "type": "image",
            "role": "start_frame",
            "required": True,
            "label": "Image",
        },
    },
    "generation": {"prompt": "Demo prompt", "models": []},
}


def _manifest(**overrides) -> dict:
    data = {
        **MANIFEST_BASE,
        "showcases": [dict(s) for s in MANIFEST_BASE["showcases"]],
        "inputs": {k: dict(v) for k, v in MANIFEST_BASE["inputs"].items()},
        "generation": dict(MANIFEST_BASE["generation"]),
        "tags": list(MANIFEST_BASE["tags"]),
    }
    data.update(overrides)
    return data


def _png_bytes(
    size: tuple[int, int] = (32, 32),
    color: tuple[int, int, int] = (80, 120, 200),
) -> bytes:
    img = Image.new("RGB", size, color=color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _zip_one(manifest: dict, asset_files: dict[str, bytes] | None = None) -> bytes:
    return _zip_many([(manifest, asset_files or {})])


def _zip_many(items: list[tuple[dict, dict[str, bytes]]] | list[dict]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in items:
            if isinstance(item, tuple):
                manifest, assets = item
            else:
                manifest, assets = item, {}
            zf.writestr(f"{manifest['id']}/manifest.yaml", yaml.dump(manifest))
            for asset_name, content in assets.items():
                zf.writestr(f"{manifest['id']}/assets/{asset_name}", content)
    return buf.getvalue()


@pytest.fixture
async def install_service(tmp_path):
    db_path = tmp_path / "test.db"
    files_dir = tmp_path / "files"
    files_dir.mkdir()
    await init_db(db_path)
    db = Database(db_path)
    await db.connect()
    file_service = FileService(files_dir, db)
    yield InstallService(db, file_service)
    await db.close()


async def _row(install_service, namespace: str, slug: str) -> dict | None:
    """Raw row fetch — bypasses get_all_effects' state filter so tests
    can inspect both `installing` and `ready` rows."""
    row = await install_service._db.fetchone(
        "SELECT * FROM effects WHERE namespace=? AND slug=?",
        (namespace, slug),
    )
    return dict(row) if row else None


async def _effect_files(install_service, effect_id: str) -> list[dict]:
    rows = await install_service._db.fetchall(
        "SELECT logical_name, file_id FROM effect_files WHERE effect_id = ?",
        (effect_id,),
    )
    return [dict(r) for r in rows]


async def _file_ref_count(install_service, file_id: str) -> int | None:
    row = await install_service._db.fetchone(
        "SELECT ref_count FROM files WHERE id = ?", (file_id,),
    )
    return row[0] if row else None


class TestInstallLifecycle:
    """A successful install lands the row at `state='ready'`. A failure
    during install leaves no row, no `effect_files`, and ref counts on
    any `files` rows it adopted are decremented back."""

    async def test_successful_install_lands_ready(self, install_service):
        await install_service.install_from_archive(_zip_one(_manifest()))
        row = await _row(install_service, "tester", "demo")
        assert row is not None
        assert row["state"] == "ready"

    async def test_install_with_showcase_asset_records_effect_files(self, install_service):
        png = _png_bytes()
        manifest = _manifest(
            showcases=[{"preview": "shot.png", "inputs": {}}],
        )
        await install_service.install_from_archive(
            _zip_one(manifest, {"shot.png": png}),
        )
        row = await _row(install_service, "tester", "demo")
        assert row is not None
        ef = await _effect_files(install_service, row["id"])
        assert len(ef) == 1
        assert ef[0]["logical_name"] == "shot.png"
        assert await _file_ref_count(install_service, ef[0]["file_id"]) == 1

    async def test_get_all_effects_filters_to_ready(self, install_service):
        await install_service.install_from_archive(_zip_one(_manifest()))
        # Plant a stale 'installing' row to simulate a crash.
        async with install_service._db.transaction() as conn:
            await conn.execute(
                """INSERT INTO effects (
                    id, namespace, slug, source, state, manifest_yaml,
                    version, installed_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    "stuck-uuid", "tester", "stuck", "installed", "installing",
                    "id: tester/stuck\nname: x\n",
                    "1.0.0",
                    datetime.now(timezone.utc).isoformat(),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
        all_effects = await install_service.get_all_effects()
        slugs = {e["slug"] for e in all_effects}
        assert "demo" in slugs
        assert "stuck" not in slugs, "installing rows must not surface"

    async def test_install_failure_leaves_no_row_or_effect_files(self, install_service):
        """Force `_update_effect` (the mark-ready step) to throw. The
        `except` arm in `_install_from_extracted` runs `_cleanup_failed`
        which clears the `effect_files` (decrementing refs) and DELETEs
        the row."""
        png = _png_bytes()
        manifest = _manifest(
            showcases=[{"preview": "shot.png", "inputs": {}}],
        )
        with patch.object(
            install_service, "_update_effect", side_effect=RuntimeError("forced")
        ):
            with pytest.raises(RuntimeError, match="forced"):
                await install_service.install_from_archive(
                    _zip_one(manifest, {"shot.png": png}),
                )

        # No row at all — not even an `installing` one.
        row = await _row(install_service, "tester", "demo")
        assert row is None
        # No effect_files anywhere.
        rows = await install_service._db.fetchall(
            "SELECT effect_id FROM effect_files",
        )
        assert rows == []
        # The file row may still exist (the orphan reaper sweeps it
        # later), but its ref_count is back at 0.
        rows = await install_service._db.fetchall(
            "SELECT hash, ref_count FROM files",
        )
        for r in rows:
            assert r["ref_count"] == 0

    async def test_replace_failure_removes_row_and_drops_refs(self, install_service):
        """The replace flow clears the old `effect_files` first (so
        refs decrement), then re-INSERTs. If the new install fails,
        `_cleanup_failed` decrements anything we added to make the
        replacement and drops the row."""
        png = _png_bytes()
        manifest_v1 = _manifest(
            version="1.0.0",
            showcases=[{"preview": "shot.png", "inputs": {}}],
        )
        await install_service.install_from_archive(
            _zip_one(manifest_v1, {"shot.png": png})
        )
        existing = await _row(install_service, "tester", "demo")
        assert existing is not None

        with patch.object(
            install_service, "_update_effect", side_effect=RuntimeError("forced")
        ):
            with pytest.raises(RuntimeError, match="forced"):
                await install_service.install_from_archive(
                    _zip_one(_manifest(version="2.0.0")), overwrite=True
                )

        # Row gone, effect_files gone — `_cleanup_failed` ran.
        assert (await _row(install_service, "tester", "demo")) is None
        rows = await install_service._db.fetchall(
            "SELECT effect_id FROM effect_files",
        )
        assert rows == []


class TestUninstallLifecycle:
    """Symmetric with the install lifecycle: uninstall flips the row to
    `state='uninstalling'`, drops `effect_files` (decrementing refs),
    then DELETEs. Files themselves are left to the orphan reaper."""

    async def test_uninstall_clears_row_and_effect_files(self, install_service):
        png = _png_bytes()
        manifest = _manifest(
            showcases=[{"preview": "shot.png", "inputs": {}}],
        )
        await install_service.install_from_archive(
            _zip_one(manifest, {"shot.png": png})
        )
        row = await _row(install_service, "tester", "demo")
        assert row is not None
        ef_before = await _effect_files(install_service, row["id"])
        assert len(ef_before) == 1
        file_id = ef_before[0]["file_id"]
        assert await _file_ref_count(install_service, file_id) == 1

        await install_service.uninstall("tester", "demo")

        assert (await _row(install_service, "tester", "demo")) is None
        # effect_files row gone, file ref_count decremented to 0.
        rows = await install_service._db.fetchall(
            "SELECT * FROM effect_files",
        )
        assert rows == []
        assert await _file_ref_count(install_service, file_id) == 0

    async def test_uninstalling_row_invisible_to_loader(self, install_service):
        await install_service.install_from_archive(_zip_one(_manifest()))
        row = await _row(install_service, "tester", "demo")
        assert row is not None

        # Flip to uninstalling without dropping effect_files — same shape
        # as a crash mid-uninstall.
        await install_service._mark_uninstalling(row["id"])

        all_effects = await install_service.get_all_effects()
        slugs = {e["slug"] for e in all_effects}
        assert "demo" not in slugs

    async def test_mark_uninstalling_raises_on_concurrent_delete(self, install_service):
        await install_service.install_from_archive(_zip_one(_manifest()))
        existing = await _row(install_service, "tester", "demo")
        assert existing is not None

        async with install_service._db.transaction() as conn:
            await conn.execute("DELETE FROM effects WHERE id = ?", (existing["id"],))

        with pytest.raises(ValueError, match="no longer exists"):
            await install_service._mark_uninstalling(existing["id"])

    async def test_uninstall_delete_guarded_by_state(self, install_service):
        """If the row gets flipped back to `ready` between
        `_mark_uninstalling` and the final DELETE, the DELETE's
        `AND state='uninstalling'` guard makes it a no-op rather
        than wiping the live row."""
        await install_service.install_from_archive(_zip_one(_manifest()))
        existing = await _row(install_service, "tester", "demo")
        assert existing is not None

        await install_service._mark_uninstalling(existing["id"])
        async with install_service._db.transaction() as conn:
            await conn.execute(
                "UPDATE effects SET state='ready' WHERE id = ?",
                (existing["id"],),
            )

        async with install_service._db.transaction() as conn:
            await conn.execute(
                "DELETE FROM effects WHERE id=? AND state='uninstalling'",
                (existing["id"],),
            )

        survivor = await _row(install_service, "tester", "demo")
        assert survivor is not None
        assert survivor["state"] == "ready"


class TestPartialArchiveSuccess:
    """Per-effect commit: a 4-effect archive with one bad effect leaves
    the earlier ones installed and the rest unattempted."""

    async def test_partial_success_in_multi_effect_archive(self, install_service):
        # `_find_manifests` rglob+sorts alphabetically.
        first = _manifest(id="tester/a-first")
        second = _manifest(id="tester/b-second")
        # Asset declared but missing — copy step raises ValueError.
        fail = _manifest(
            id="tester/m-fail",
            showcases=[{"preview": "missing.mp4", "inputs": {}}],
        )
        never = _manifest(id="tester/z-never")

        archive = _zip_many([first, second, fail, never])
        with pytest.raises(ValueError, match="declared in manifest but missing"):
            await install_service.install_from_archive(archive)

        assert (await _row(install_service, "tester", "a-first"))["state"] == "ready"
        assert (await _row(install_service, "tester", "b-second"))["state"] == "ready"
        assert (await _row(install_service, "tester", "m-fail")) is None
        assert (await _row(install_service, "tester", "z-never")) is None


class TestPruneAbandonedInstalls:
    """The reaper drops effect_files (decrementing refs) and DELETEs
    rows in transient lifecycle states older than `max_age_hours`.
    Fresh ones are left alone — that's how a second instance starting
    up doesn't trample a sibling's in-flight install."""

    async def _plant(
        self, install_service, slug: str, age_hours: float, state: str = "installing",
    ) -> str:
        """Insert a synthetic transient-state row, with `updated_at` set
        to (now - age_hours). Returns the row's UUID."""
        uuid = f"uuid-{slug}"
        ts = (datetime.now(timezone.utc) - timedelta(hours=age_hours)).isoformat()
        async with install_service._db.transaction() as conn:
            await conn.execute(
                """INSERT INTO effects (
                    id, namespace, slug, source, state, manifest_yaml,
                    version, installed_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    uuid, "tester", slug, "installed", state,
                    f"id: tester/{slug}\nname: x\n",
                    "1.0.0", ts, ts,
                ),
            )
        return uuid

    async def _plant_installing(self, install_service, slug: str, age_hours: float) -> str:
        return await self._plant(install_service, slug, age_hours, "installing")

    async def test_old_uninstalling_rows_pruned(self, install_service):
        await self._plant(install_service, "stuck-uninstall", age_hours=2.0, state="uninstalling")
        pruned = await install_service.prune_stale_lifecycle_rows(max_age_hours=1)
        assert pruned == 1
        assert (await _row(install_service, "tester", "stuck-uninstall")) is None

    async def test_reaper_handles_both_transient_states_together(self, install_service):
        """One installing + one uninstalling, both old → both pruned in
        a single reaper cycle."""
        await self._plant(install_service, "a-install", age_hours=2.0, state="installing")
        await self._plant(install_service, "b-uninstall", age_hours=2.0, state="uninstalling")
        pruned = await install_service.prune_stale_lifecycle_rows(max_age_hours=1)
        assert pruned == 2

    async def test_old_installing_rows_pruned(self, install_service):
        await self._plant_installing(install_service, "old", age_hours=2.0)
        pruned = await install_service.prune_stale_lifecycle_rows(max_age_hours=1)
        assert pruned == 1
        assert (await _row(install_service, "tester", "old")) is None

    async def test_fresh_installing_rows_kept(self, install_service):
        """A row that's only 5 minutes into its install (well under TTL)
        must be left alone — it could belong to a sibling instance still
        actively writing."""
        await self._plant_installing(install_service, "fresh", age_hours=5 / 60)
        pruned = await install_service.prune_stale_lifecycle_rows(max_age_hours=1)
        assert pruned == 0
        assert (await _row(install_service, "tester", "fresh"))["state"] == "installing"

    async def test_ready_rows_never_pruned(self, install_service):
        await install_service.install_from_archive(_zip_one(_manifest()))
        ancient = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        async with install_service._db.transaction() as conn:
            await conn.execute(
                "UPDATE effects SET updated_at = ? WHERE namespace = 'tester' AND slug = 'demo'",
                (ancient,),
            )

        pruned = await install_service.prune_stale_lifecycle_rows(max_age_hours=1)
        assert pruned == 0
        assert (await _row(install_service, "tester", "demo")) is not None

    async def test_reaper_skips_row_whose_timestamp_was_refreshed(self, install_service):
        """Defensive race: between SELECT and DELETE, the user retries
        the install which bumps `updated_at` to now. The DELETE's
        `AND updated_at < cutoff` guard catches this."""
        await self._plant_installing(install_service, "racy-ts", age_hours=2.0)

        original_fetchall = install_service._db.fetchall

        async def racing_fetchall(sql, params=()):
            rows = await original_fetchall(sql, params)
            if "WHERE state IN" in sql:
                now = datetime.now(timezone.utc).isoformat()
                async with install_service._db.transaction() as conn:
                    await conn.execute(
                        "UPDATE effects SET updated_at = ? WHERE namespace = 'tester' AND slug = 'racy-ts'",
                        (now,),
                    )
            return rows

        with patch.object(install_service._db, "fetchall", racing_fetchall):
            await install_service.prune_stale_lifecycle_rows(max_age_hours=1)

        row = await _row(install_service, "tester", "racy-ts")
        assert row is not None
        assert row["state"] == "installing"

    async def test_mark_installing_raises_when_row_was_deleted(self, install_service):
        """Defensive: if the row vanishes between `get_effect` and
        `_mark_installing` (concurrent GC), `_mark_installing` raises."""
        await install_service.install_from_archive(_zip_one(_manifest()))
        existing = await _row(install_service, "tester", "demo")
        assert existing is not None

        async with install_service._db.transaction() as conn:
            await conn.execute("DELETE FROM effects WHERE id = ?", (existing["id"],))

        with pytest.raises(ValueError, match="no longer exists"):
            await install_service._mark_installing(existing["id"])

    async def test_reaper_safe_under_concurrent_state_flip(self, install_service):
        """Simulate a race: between SELECT and DELETE the row gets flipped
        to `ready`. The DELETE's `AND state IN ('installing', 'uninstalling')`
        guard makes that delete a no-op rather than wiping a now-live effect."""
        await self._plant_installing(install_service, "racy", age_hours=2.0)

        original_fetchall = install_service._db.fetchall

        async def racing_fetchall(sql, params=()):
            rows = await original_fetchall(sql, params)
            if "WHERE state IN" in sql:
                async with install_service._db.transaction() as conn:
                    await conn.execute(
                        "UPDATE effects SET state = 'ready' WHERE namespace = 'tester' AND slug = 'racy'"
                    )
            return rows

        with patch.object(install_service._db, "fetchall", racing_fetchall):
            await install_service.prune_stale_lifecycle_rows(max_age_hours=1)

        row = await _row(install_service, "tester", "racy")
        assert row is not None
        assert row["state"] == "ready"


class TestAssetFilenameValidation:
    """Both install paths (manifest-author input) and the editor save
    path (user input via the asset panel) funnel through
    `_validate_asset_filename`. Covers the editor surface — where the
    user can type any string into the rename input — so a malicious
    or accidental name can't land in `effect_files` and corrupt the
    export ZIP downstream."""

    def test_accepts_normal_name(self):
        _validate_asset_filename("photo.png")
        _validate_asset_filename("clip.mp4")
        _validate_asset_filename("шот.jpg")
        _validate_asset_filename("image (1).png")

    def test_rejects_empty(self):
        with pytest.raises(ValueError, match="empty"):
            _validate_asset_filename("")
        with pytest.raises(ValueError, match="empty"):
            _validate_asset_filename("   ")

    def test_rejects_too_long(self):
        long_name = "a" * 250 + ".png"
        with pytest.raises(ValueError, match="too long"):
            _validate_asset_filename(long_name)

    def test_rejects_null_byte(self):
        with pytest.raises(ValueError, match="null"):
            _validate_asset_filename("evil\x00.png")

    def test_rejects_control_chars(self):
        with pytest.raises(ValueError, match="control"):
            _validate_asset_filename("a\nb.png")
        with pytest.raises(ValueError, match="control"):
            _validate_asset_filename("a\tb.png")

    def test_rejects_path_components(self):
        with pytest.raises(ValueError, match="slashes"):
            _validate_asset_filename("foo/bar.png")
        with pytest.raises(ValueError, match="slashes"):
            _validate_asset_filename("foo\\bar.png")

    def test_rejects_traversal(self):
        # Note: `..` triggers the slash check first (a/../b), the
        # traversal-only `..` token is also caught by Path.parts.
        with pytest.raises(ValueError, match="Invalid asset path"):
            _validate_asset_filename("..")

    def test_rejects_absolute(self):
        with pytest.raises(ValueError, match="(slashes|Invalid)"):
            _validate_asset_filename("/etc/passwd")

    def test_rejects_empty_stem(self):
        with pytest.raises(ValueError, match="(empty stem|Disallowed)"):
            _validate_asset_filename(".png")

    def test_rejects_disallowed_extension(self):
        with pytest.raises(ValueError, match="Disallowed file extension"):
            _validate_asset_filename("malware.exe")
        with pytest.raises(ValueError, match="Disallowed file extension"):
            _validate_asset_filename("noext")

    async def test_per_asset_rename_runs_validator(self, install_service):
        """Add intentionally strips path components from browser-supplied
        filenames (so dragging a file with a path doesn't fail
        cosmetically). Rename is the strict path: it has to reject
        anything that wouldn't survive the export ZIP."""
        png = _png_bytes()
        await install_service.install_from_archive(_zip_one(_manifest()))

        class _Upload:
            def __init__(self, content, filename):
                self._buf = io.BytesIO(content)
                self.filename = filename

            async def read(self, size=-1):
                return self._buf.read() if size == -1 else self._buf.read(size)

        # Add with a clean name first.
        await install_service.add_effect_asset(
            "tester", "demo", _Upload(png, "shot.png"),
            kind="image", mime="image/png", max_size=10_000_000,
        )

        with pytest.raises(ValueError, match="slashes"):
            await install_service.rename_effect_asset(
                "tester", "demo", "shot.png", "foo/bar.png",
            )

        with pytest.raises(ValueError, match="too long"):
            await install_service.rename_effect_asset(
                "tester", "demo", "shot.png", "a" * 300 + ".png",
            )

    async def test_add_strips_browser_path_components(self, install_service):
        """A browser dragging `subdir/photo.png` gives us that string;
        we strip to `photo.png` rather than 400-ing — same shape any
        upload widget uses."""
        await install_service.install_from_archive(_zip_one(_manifest()))

        class _Upload:
            def __init__(self, content, filename):
                self._buf = io.BytesIO(content)
                self.filename = filename

            async def read(self, size=-1):
                return self._buf.read() if size == -1 else self._buf.read(size)

        result = await install_service.add_effect_asset(
            "tester", "demo", _Upload(_png_bytes(), "weird/folder/photo.png"),
            kind="image", mime="image/png", max_size=10_000_000,
        )
        assert result["filename"] == "photo.png"


class TestPerAssetCRUD:
    """Per-asset endpoints — `add_effect_asset`, `rename_effect_asset`,
    `remove_effect_asset` — drive the editor's asset panel. Each call
    lands its change immediately so the YAML save endpoint never has
    to reason about asset bindings."""

    class _Upload:
        """Duck-typed UploadFile stand-in. The service only reads
        `filename` and calls `read(size)` — same shape as fastapi's
        UploadFile."""
        def __init__(self, content: bytes, filename: str):
            self._buf = io.BytesIO(content)
            self.filename = filename

        async def read(self, size: int = -1) -> bytes:
            return self._buf.read() if size == -1 else self._buf.read(size)

    async def test_add_effect_asset_links_immediately(self, install_service):
        await install_service.install_from_archive(_zip_one(_manifest()))
        png = _png_bytes()

        result = await install_service.add_effect_asset(
            "tester", "demo",
            self._Upload(png, "shot.png"),
            kind="image", mime="image/png", max_size=10_000_000,
        )
        assert result["filename"] == "shot.png"
        assert result["url"].startswith("/api/files/")

        existing = await _row(install_service, "tester", "demo")
        ef = await _effect_files(install_service, existing["id"])
        assert {row["logical_name"] for row in ef} == {"shot.png"}
        assert await _file_ref_count(install_service, ef[0]["file_id"]) == 1

    async def test_add_effect_asset_rejects_duplicate_name(self, install_service):
        await install_service.install_from_archive(_zip_one(_manifest()))
        png = _png_bytes()
        await install_service.add_effect_asset(
            "tester", "demo", self._Upload(png, "dup.png"),
            kind="image", mime="image/png", max_size=10_000_000,
        )
        with pytest.raises(ValueError, match="already exists"):
            await install_service.add_effect_asset(
                "tester", "demo",
                self._Upload(_png_bytes(color=(9, 9, 9)), "dup.png"),
                kind="image", mime="image/png", max_size=10_000_000,
            )

    async def test_add_effect_asset_uses_supplied_logical_name(self, install_service):
        await install_service.install_from_archive(_zip_one(_manifest()))
        result = await install_service.add_effect_asset(
            "tester", "demo",
            self._Upload(_png_bytes(), "weird browser name (1).png"),
            logical_name="hero.png",
            kind="image", mime="image/png", max_size=10_000_000,
        )
        assert result["filename"] == "hero.png"

    async def test_rename_effect_asset_updates_logical_name(self, install_service):
        await install_service.install_from_archive(_zip_one(_manifest()))
        await install_service.add_effect_asset(
            "tester", "demo", self._Upload(_png_bytes(), "old.png"),
            kind="image", mime="image/png", max_size=10_000_000,
        )

        result = await install_service.rename_effect_asset(
            "tester", "demo", "old.png", "new.png",
        )
        assert result["filename"] == "new.png"

        existing = await _row(install_service, "tester", "demo")
        ef = await _effect_files(install_service, existing["id"])
        assert {row["logical_name"] for row in ef} == {"new.png"}

    async def test_rename_effect_asset_rejects_duplicate(self, install_service):
        await install_service.install_from_archive(_zip_one(_manifest()))
        await install_service.add_effect_asset(
            "tester", "demo", self._Upload(_png_bytes(color=(1, 1, 1)), "a.png"),
            kind="image", mime="image/png", max_size=10_000_000,
        )
        await install_service.add_effect_asset(
            "tester", "demo", self._Upload(_png_bytes(color=(2, 2, 2)), "b.png"),
            kind="image", mime="image/png", max_size=10_000_000,
        )
        with pytest.raises(ValueError, match="already exists"):
            await install_service.rename_effect_asset(
                "tester", "demo", "a.png", "b.png",
            )

    async def test_rename_effect_asset_rejects_unknown(self, install_service):
        await install_service.install_from_archive(_zip_one(_manifest()))
        with pytest.raises(ValueError, match="not found"):
            await install_service.rename_effect_asset(
                "tester", "demo", "missing.png", "anything.png",
            )

    async def test_remove_effect_asset_drops_binding_and_decrements_ref(self, install_service):
        await install_service.install_from_archive(_zip_one(_manifest()))
        await install_service.add_effect_asset(
            "tester", "demo", self._Upload(_png_bytes(), "drop.png"),
            kind="image", mime="image/png", max_size=10_000_000,
        )
        existing = await _row(install_service, "tester", "demo")
        ef_before = await _effect_files(install_service, existing["id"])
        file_id = ef_before[0]["file_id"]
        assert await _file_ref_count(install_service, file_id) == 1

        await install_service.remove_effect_asset("tester", "demo", "drop.png")

        ef_after = await _effect_files(install_service, existing["id"])
        assert ef_after == []
        assert await _file_ref_count(install_service, file_id) == 0

    async def test_remove_effect_asset_rejects_unknown(self, install_service):
        await install_service.install_from_archive(_zip_one(_manifest()))
        with pytest.raises(ValueError, match="not found"):
            await install_service.remove_effect_asset("tester", "demo", "ghost.png")

    async def test_per_asset_calls_reject_unknown_effect(self, install_service):
        with pytest.raises(ValueError, match="Effect.*not found"):
            await install_service.add_effect_asset(
                "tester", "ghost", self._Upload(_png_bytes(), "x.png"),
                kind="image", mime="image/png", max_size=10_000_000,
            )
        with pytest.raises(ValueError, match="Effect.*not found"):
            await install_service.rename_effect_asset(
                "tester", "ghost", "a.png", "b.png",
            )
        with pytest.raises(ValueError, match="Effect.*not found"):
            await install_service.remove_effect_asset("tester", "ghost", "a.png")
