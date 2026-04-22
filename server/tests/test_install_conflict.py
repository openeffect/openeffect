"""Tests for install conflict detection and overwrite flow."""
import io
import zipfile
from typing import Any

import pytest
import yaml

from db.database import Database, init_db
from services.install_service import InstallConflictError, InstallService

MANIFEST_BASE: dict[str, Any] = {
    "id": "demo",
    "namespace": "tester",
    "name": "Demo",
    "description": "Demo effect",
    "version": "1.0.0",
    "author": "tester",
    "type": "transform",
    "tags": [],
    "assets": {},
    "inputs": {
        "image": {
            "type": "image",
            "role": "start_frame",
            "required": True,
            "label": "Image",
        },
    },
    "generation": {
        "prompt": "Demo prompt",
        "models": [],
    },
}


def _manifest(**overrides) -> dict:
    """Deep-ish copy of the base manifest with shallow overrides merged in."""
    data = {
        **MANIFEST_BASE,
        "assets": dict(MANIFEST_BASE["assets"]),
        "inputs": {k: dict(v) for k, v in MANIFEST_BASE["inputs"].items()},
        "generation": dict(MANIFEST_BASE["generation"]),
        "tags": list(MANIFEST_BASE["tags"]),
    }
    data.update(overrides)
    return data


def _zip_one(manifest: dict) -> bytes:
    """Build a ZIP with one effect inside `<id>/manifest.yaml`."""
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


class TestArchiveInstallConflict:
    async def test_fresh_install_succeeds(self, install_service):
        installed = await install_service.install_from_archive(_zip_one(_manifest()))
        assert installed == ["tester/demo"]

    async def test_duplicate_same_version_is_silent_noop(self, install_service):
        await install_service.install_from_archive(_zip_one(_manifest()))
        # Second call with the same version: no conflict, no-op
        installed = await install_service.install_from_archive(_zip_one(_manifest()))
        assert installed == ["tester/demo"]

    async def test_duplicate_different_version_raises(self, install_service):
        await install_service.install_from_archive(_zip_one(_manifest(version="1.0.0")))
        with pytest.raises(InstallConflictError) as excinfo:
            await install_service.install_from_archive(_zip_one(_manifest(version="2.0.0")))
        conflicts = excinfo.value.conflicts
        assert len(conflicts) == 1
        assert conflicts[0]["namespace"] == "tester"
        assert conflicts[0]["id"] == "demo"
        assert conflicts[0]["existing_version"] == "1.0.0"
        assert conflicts[0]["incoming_version"] == "2.0.0"

    async def test_duplicate_downgrade_also_raises(self, install_service):
        """A lower incoming version still prompts — user might be restoring."""
        await install_service.install_from_archive(_zip_one(_manifest(version="2.0.0")))
        with pytest.raises(InstallConflictError):
            await install_service.install_from_archive(_zip_one(_manifest(version="1.0.0")))

    async def test_overwrite_updates_in_place(self, install_service):
        await install_service.install_from_archive(_zip_one(_manifest(version="1.0.0")))
        installed = await install_service.install_from_archive(
            _zip_one(_manifest(version="2.0.0", name="Demo v2")),
            overwrite=True,
        )
        assert installed == ["tester/demo"]
        existing = await install_service.get_effect("tester", "demo")
        assert existing["version"] == "2.0.0"

    async def test_multi_effect_archive_with_one_duplicate_raises(self, install_service):
        # Seed one effect
        await install_service.install_from_archive(_zip_one(_manifest(id="existing")))
        # Archive with three effects, one of which conflicts
        archive = _zip_many([
            _manifest(id="existing", version="2.0.0"),
            _manifest(id="new-a"),
            _manifest(id="new-b"),
        ])
        with pytest.raises(InstallConflictError) as excinfo:
            await install_service.install_from_archive(archive)
        assert len(excinfo.value.conflicts) == 1
        assert excinfo.value.conflicts[0]["id"] == "existing"
        # Nothing else should have been installed
        assert await install_service.get_effect("tester", "new-a") is None
        assert await install_service.get_effect("tester", "new-b") is None

    async def test_allow_official_skips_conflict_check(self, install_service):
        """Boot-time bundled sync passes allow_official=True and updates silently."""
        await install_service.install_from_archive(
            _zip_one(_manifest(namespace="openeffect", id="bundled", version="1.0.0")),
            allow_official=True,
        )
        # Different version — should NOT raise, should update silently
        installed = await install_service.install_from_archive(
            _zip_one(_manifest(namespace="openeffect", id="bundled", version="2.0.0")),
            allow_official=True,
        )
        assert installed == ["openeffect/bundled"]
        existing = await install_service.get_effect("openeffect", "bundled")
        assert existing["version"] == "2.0.0"
