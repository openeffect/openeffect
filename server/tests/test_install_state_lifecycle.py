"""Tests for the DB-state install lifecycle.

Each install path goes `INSERT installing → write files → UPDATE ready`.
The loader filters on `state='ready'`, so in-flight or crashed installs
are invisible to users. The reaper (`prune_stale_lifecycle_rows`) cleans
abandoned `installing` rows + their folders after a TTL.
"""
import io
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest
import yaml

from db.database import Database, init_db
from services.install_service import InstallService

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


def _zip_one(manifest: dict) -> bytes:
    return _zip_many([manifest])


def _zip_many(manifests: list[dict]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for m in manifests:
            zf.writestr(f"{m['id']}/manifest.yaml", yaml.dump(m))
    return buf.getvalue()


@pytest.fixture
async def install_service(tmp_path):
    db_path = tmp_path / "test.db"
    effects_dir = tmp_path / "effects"
    await init_db(db_path)
    db = Database(db_path)
    await db.connect()
    yield InstallService(db, effects_dir)
    await db.close()


async def _row(install_service, namespace: str, slug: str) -> dict | None:
    """Raw row fetch — bypasses get_all_effects' state filter so tests
    can inspect both `installing` and `ready` rows."""
    row = await install_service._db.fetchone(
        "SELECT * FROM effects WHERE namespace=? AND slug=?",
        (namespace, slug),
    )
    return dict(row) if row else None


class TestInstallLifecycle:
    """A successful install lands the row at `state='ready'`. A failure
    during install leaves no row and no folder behind."""

    async def test_successful_install_lands_ready(self, install_service):
        await install_service.install_from_archive(_zip_one(_manifest()))
        row = await _row(install_service, "tester", "demo")
        assert row is not None
        assert row["state"] == "ready"

    async def test_get_all_effects_filters_to_ready(self, install_service):
        # Install one effect normally — lands ready.
        await install_service.install_from_archive(_zip_one(_manifest()))
        # Manually plant a stale 'installing' row to simulate a crash.
        async with install_service._db.transaction() as conn:
            await conn.execute(
                """INSERT INTO effects (
                    id, namespace, slug, source, state, manifest_yaml,
                    assets_dir, version, installed_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    "stuck-uuid", "tester", "stuck", "installed", "installing",
                    "id: tester/stuck\nname: x\n",
                    str(install_service.effects_dir / "stuck-uuid"),
                    "1.0.0",
                    datetime.now(timezone.utc).isoformat(),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
        all_effects = await install_service.get_all_effects()
        slugs = {e["slug"] for e in all_effects}
        assert "demo" in slugs
        assert "stuck" not in slugs, "installing rows must not surface"

    async def test_install_failure_leaves_no_row_and_no_folder(self, install_service):
        """Force `_update_effect` (the mark-ready step) to throw. The
        `except` arm in `_install_from_extracted` should DELETE the row
        and rmtree the folder, so the user sees nothing left behind."""
        with patch.object(
            install_service, "_update_effect", side_effect=RuntimeError("forced")
        ):
            with pytest.raises(RuntimeError, match="forced"):
                await install_service.install_from_archive(_zip_one(_manifest()))

        # No row at all — not even an `installing` one.
        row = await _row(install_service, "tester", "demo")
        assert row is None
        # No folder either.
        for entry in install_service.effects_dir.iterdir():
            assert not entry.is_dir(), f"Leftover: {entry.name}"

    async def test_replace_failure_removes_row_and_folder(self, install_service):
        """The replace flow rmtrees the old folder before writing the
        new — same as the plan documented. If the new install fails,
        the row + folder go and the user re-installs from scratch."""
        await install_service.install_from_archive(
            _zip_one(_manifest(version="1.0.0"))
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

        # Row gone, folder gone — `_cleanup_failed` ran.
        assert (await _row(install_service, "tester", "demo")) is None
        assert not Path(existing["assets_dir"]).exists()


class TestUninstallLifecycle:
    """Symmetric with the install lifecycle: uninstall flips the row to
    `state='uninstalling'`, rmtrees, and DELETEs. The loader filter on
    `state='ready'` hides the row from step 2 onward; physical cleanup
    finishes either in-process or via the reaper after a TTL."""

    async def test_uninstall_clears_row_and_folder(self, install_service):
        await install_service.install_from_archive(_zip_one(_manifest()))
        row = await _row(install_service, "tester", "demo")
        assert row is not None
        effect_dir = Path(row["assets_dir"])
        assert effect_dir.exists()

        await install_service.uninstall("tester", "demo")

        assert (await _row(install_service, "tester", "demo")) is None
        assert not effect_dir.exists()

    async def test_uninstalling_row_invisible_to_loader(self, install_service):
        await install_service.install_from_archive(_zip_one(_manifest()))
        row = await _row(install_service, "tester", "demo")
        assert row is not None

        # Flip to uninstalling without rmtreeing — same shape as a crash
        # mid-uninstall.
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
        `_mark_uninstalling` and the final DELETE (e.g. an immediate
        reinstall), the DELETE's `AND state='uninstalling'` guard makes
        it a no-op rather than wiping the live row."""
        await install_service.install_from_archive(_zip_one(_manifest()))
        existing = await _row(install_service, "tester", "demo")
        assert existing is not None

        # Manually reproduce: flip to uninstalling, then back to ready,
        # then run the same DELETE the uninstall path would issue.
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

        # Row survived because the state guard rejected the DELETE.
        survivor = await _row(install_service, "tester", "demo")
        assert survivor is not None
        assert survivor["state"] == "ready"


class TestPartialArchiveSuccess:
    """Per-effect commit: a 5-effect archive with one bad effect leaves
    the earlier ones installed and the rest unattempted. No batched tx."""

    async def test_partial_success_in_multi_effect_archive(self, install_service):
        # `_find_manifests` rglob+sorts alphabetically, so the on-disk
        # processing order is: a-first, b-second, m-fail, z-never.
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

        # First two committed (state='ready'); the failing one cleaned
        # up by `_cleanup_failed`; the last one never attempted because
        # the loop exited via raise.
        assert (await _row(install_service, "tester", "a-first"))["state"] == "ready"
        assert (await _row(install_service, "tester", "b-second"))["state"] == "ready"
        assert (await _row(install_service, "tester", "m-fail")) is None
        assert (await _row(install_service, "tester", "z-never")) is None


class TestPruneAbandonedInstalls:
    """The reaper deletes rows in transient lifecycle states (installing
    or uninstalling) older than `max_age_hours` and rmtrees their
    folders. Fresh ones are left alone — that's how a second instance
    starting up doesn't trample a sibling's in-flight install."""

    async def _plant(
        self, install_service, slug: str, age_hours: float, state: str = "installing"
    ) -> Path:
        """Insert a synthetic transient-state row + its folder, with
        `updated_at` set to (now - age_hours)."""
        uuid = f"uuid-{slug}"
        assets_dir = install_service.effects_dir / uuid
        assets_dir.mkdir(parents=True)
        (assets_dir / "marker.txt").write_text("present")

        ts = (datetime.now(timezone.utc) - timedelta(hours=age_hours)).isoformat()
        async with install_service._db.transaction() as conn:
            await conn.execute(
                """INSERT INTO effects (
                    id, namespace, slug, source, state, manifest_yaml,
                    assets_dir, version, installed_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    uuid, "tester", slug, "installed", state,
                    f"id: tester/{slug}\nname: x\n",
                    str(assets_dir), "1.0.0", ts, ts,
                ),
            )
        return assets_dir

    async def _plant_installing(self, install_service, slug: str, age_hours: float) -> Path:
        return await self._plant(install_service, slug, age_hours, "installing")

    async def test_old_uninstalling_rows_pruned(self, install_service):
        """A row stuck in `state='uninstalling'` for >TTL gets the same
        treatment as a stuck `installing` row: rmtree + DELETE."""
        old_dir = await self._plant(install_service, "stuck-uninstall", age_hours=2.0, state="uninstalling")
        pruned = await install_service.prune_stale_lifecycle_rows(max_age_hours=1)
        assert pruned == 1
        assert not old_dir.exists()
        assert (await _row(install_service, "tester", "stuck-uninstall")) is None

    async def test_reaper_handles_both_transient_states_together(self, install_service):
        """One installing + one uninstalling, both old → both pruned in
        a single reaper cycle. Confirms the unified WHERE covers both."""
        a = await self._plant(install_service, "a-install", age_hours=2.0, state="installing")
        b = await self._plant(install_service, "b-uninstall", age_hours=2.0, state="uninstalling")
        pruned = await install_service.prune_stale_lifecycle_rows(max_age_hours=1)
        assert pruned == 2
        assert not a.exists()
        assert not b.exists()

    async def test_old_installing_rows_pruned(self, install_service):
        old_dir = await self._plant_installing(install_service, "old", age_hours=2.0)
        pruned = await install_service.prune_stale_lifecycle_rows(max_age_hours=1)
        assert pruned == 1
        assert not old_dir.exists()
        assert (await _row(install_service, "tester", "old")) is None

    async def test_fresh_installing_rows_kept(self, install_service):
        """A row that's only 5 minutes into its install (well under TTL)
        must be left alone — it could belong to a sibling instance still
        actively writing."""
        fresh_dir = await self._plant_installing(
            install_service, "fresh", age_hours=5 / 60
        )
        pruned = await install_service.prune_stale_lifecycle_rows(max_age_hours=1)
        assert pruned == 0
        assert fresh_dir.exists()
        assert (await _row(install_service, "tester", "fresh"))["state"] == "installing"

    async def test_ready_rows_never_pruned(self, install_service):
        """Even if a `state='ready'` row's `updated_at` is ancient, the
        reaper leaves it alone — it only cleans `state='installing'`."""
        await install_service.install_from_archive(_zip_one(_manifest()))
        # Backdate the row's updated_at to long ago.
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
        the install which bumps `updated_at` to now (still state=
        'installing'). The DELETE's `AND updated_at < cutoff` guard
        catches this — the freshly-refreshed row stays alive and the
        retry can complete."""
        old_dir = await self._plant_installing(install_service, "racy-ts", age_hours=2.0)

        original_fetchall = install_service._db.fetchall

        async def racing_fetchall(sql, params=()):
            rows = await original_fetchall(sql, params)
            if "WHERE state IN" in sql:
                # User just retried — bump updated_at to now (still
                # state='installing' because the install is in flight).
                now = datetime.now(timezone.utc).isoformat()
                async with install_service._db.transaction() as conn:
                    await conn.execute(
                        "UPDATE effects SET updated_at = ? WHERE namespace = 'tester' AND slug = 'racy-ts'",
                        (now,),
                    )
            return rows

        with patch.object(install_service._db, "fetchall", racing_fetchall):
            await install_service.prune_stale_lifecycle_rows(max_age_hours=1)

        # Row survives — its updated_at is now fresh, the DELETE's
        # `updated_at < cutoff` guard rejected the row.
        row = await _row(install_service, "tester", "racy-ts")
        assert row is not None
        assert row["state"] == "installing"
        # Files were rmtreed (rmtree happens before DELETE in our
        # ordering); recoverable by re-running the install which would
        # rewrite them.
        assert not old_dir.exists()

    async def test_mark_installing_raises_when_row_was_deleted(self, install_service):
        """Defensive: if the row vanishes between `get_effect` and
        `_mark_installing` (concurrent GC), `_mark_installing` raises
        so the install path's `except` arm runs and the user sees an
        explicit failure instead of a silent UPDATE that did nothing."""
        # Plant a row, then delete it under us.
        await install_service.install_from_archive(_zip_one(_manifest()))
        existing = await _row(install_service, "tester", "demo")
        assert existing is not None

        async with install_service._db.transaction() as conn:
            await conn.execute("DELETE FROM effects WHERE id = ?", (existing["id"],))

        with pytest.raises(ValueError, match="no longer exists"):
            await install_service._mark_installing(existing["id"])

    async def test_reaper_safe_under_concurrent_state_flip(self, install_service):
        """Simulate a race: between SELECT and DELETE the row gets flipped
        to `ready`. The DELETE's `AND state = 'installing'` guard makes
        that delete a no-op rather than wiping a now-live effect."""
        old_dir = await self._plant_installing(install_service, "racy", age_hours=2.0)

        # Patch fetchall to return the stale row, then immediately flip
        # the row to 'ready' before prune's DELETE runs.
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

        # Row is still there at state='ready' — the racy DELETE matched
        # nothing because the WHERE state='installing' guard rejected it.
        row = await _row(install_service, "tester", "racy")
        assert row is not None
        assert row["state"] == "ready"
        # The folder was rmtreed BEFORE the DELETE attempted (rmtree
        # happens first in our prune ordering). That's the documented
        # cost of the ordering — recovering the files needs a re-install.
        assert not old_dir.exists()
