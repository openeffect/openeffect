"""Tests for install conflict detection and overwrite flow."""
import io
import zipfile
from typing import Any

import pytest
import yaml
from PIL import Image

from db.database import Database, init_db
from services.file_service import FileService
from services.install_service import InstallConflictError, InstallService


def _png_bytes(color: tuple[int, int, int] = (50, 50, 50)) -> bytes:
    """Real PNG so the file store's thumbnail pipeline accepts it."""
    img = Image.new("RGB", (16, 16), color=color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()

MANIFEST_BASE: dict[str, Any] = {
    "manifest_version": 1,
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
    "generation": {
        "prompt": "Demo prompt",
        "models": [],
    },
}


def _manifest(**overrides) -> dict:
    """Deep-ish copy of the base manifest with shallow overrides merged in."""
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
    files_dir = tmp_path / "files"
    files_dir.mkdir()
    await init_db(db_path)
    db = Database(db_path)
    await db.connect()
    file_service = FileService(files_dir, db)
    yield InstallService(db, file_service)
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
        assert conflicts[0]["slug"] == "demo"
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
        await install_service.install_from_archive(_zip_one(_manifest(id="tester/existing")))
        # Archive with three effects, one of which conflicts
        archive = _zip_many([
            _manifest(id="tester/existing", version="2.0.0"),
            _manifest(id="tester/new-a"),
            _manifest(id="tester/new-b"),
        ])
        with pytest.raises(InstallConflictError) as excinfo:
            await install_service.install_from_archive(archive)
        assert len(excinfo.value.conflicts) == 1
        assert excinfo.value.conflicts[0]["slug"] == "existing"
        # Nothing else should have been installed
        assert await install_service.get_effect("tester", "new-a") is None
        assert await install_service.get_effect("tester", "new-b") is None

    async def test_allow_official_skips_conflict_check(self, install_service):
        """Boot-time bundled sync passes allow_official=True and updates silently."""
        await install_service.install_from_archive(
            _zip_one(_manifest(id="openeffect/bundled", version="1.0.0")),
            allow_official=True,
        )
        # Different version — should NOT raise, should update silently
        installed = await install_service.install_from_archive(
            _zip_one(_manifest(id="openeffect/bundled", version="2.0.0")),
            allow_official=True,
        )
        assert installed == ["openeffect/bundled"]
        existing = await install_service.get_effect("openeffect", "bundled")
        assert existing["version"] == "2.0.0"

    async def test_reserved_namespace_in_archive_blocks_whole_install(self, install_service):
        """A multi-effect archive where one manifest claims a reserved
        namespace must reject the whole install — not partially install
        the other effects before hitting the bad one."""
        archive = _zip_many([
            _manifest(id="tester/clean-a"),
            _manifest(id="openeffect/sneaky"),  # reserved
            _manifest(id="tester/clean-b"),
        ])
        with pytest.raises(ValueError, match="reserved"):
            await install_service.install_from_archive(archive)
        # None of the clean ones should have leaked in
        assert (await install_service.get_effect("tester", "clean-a")) is None
        assert (await install_service.get_effect("tester", "clean-b")) is None
        assert (await install_service.get_effect("openeffect", "sneaky")) is None


class TestArchiveMalformedManifest:
    """Manifest parse / schema failures inside an archive must surface as
    `ValueError` (so the route layer translates them to a clean 400) and
    must reject the whole archive without partially installing anything."""

    async def test_invalid_yaml_syntax_rejects_archive(self, install_service):
        m = _manifest()
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(f"{m['id']}/manifest.yaml", "this: is: not: valid yaml: : :")
        with pytest.raises(ValueError, match="Invalid YAML syntax"):
            await install_service.install_from_archive(buf.getvalue())
        assert (await install_service.get_effect("tester", "demo")) is None

    async def test_schema_invalid_manifest_rejects_archive(self, install_service):
        # Missing required `name` field — Pydantic rejects on validation.
        bad = _manifest()
        del bad["name"]
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(f"{bad['id']}/manifest.yaml", yaml.dump(bad))
        # Pydantic message bubbles up, not a generic 500-style exception
        with pytest.raises(ValueError, match="name"):
            await install_service.install_from_archive(buf.getvalue())
        assert (await install_service.get_effect("tester", "demo")) is None

    async def test_one_bad_manifest_blocks_other_clean_effects(self, install_service):
        clean = _manifest(id="tester/clean")
        # Bad manifest — list under `tags` would be a string, fails schema
        bad = _manifest(id="tester/broken")
        bad["tags"] = "not-a-list"
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(f"{clean['id']}/manifest.yaml", yaml.dump(clean))
            zf.writestr(f"{bad['id']}/manifest.yaml", yaml.dump(bad))
        with pytest.raises(ValueError, match="tags"):
            await install_service.install_from_archive(buf.getvalue())
        # The clean one must NOT be installed — upfront pass should bail
        # on the broken manifest before any disk write.
        assert (await install_service.get_effect("tester", "clean")) is None
        assert (await install_service.get_effect("tester", "broken")) is None


# ──────────────────────────────────────────────────────────────────────────────
# Security: URL download + zip extraction safeguards
# ──────────────────────────────────────────────────────────────────────────────


class TestInstallUrlScheme:
    async def test_file_scheme_rejected(self, install_service):
        with pytest.raises(ValueError, match="Only http/https"):
            await install_service.install_from_url("file:///etc/passwd")

    async def test_data_scheme_rejected(self, install_service):
        with pytest.raises(ValueError, match="Only http/https"):
            await install_service.install_from_url("data:text/yaml;base64,aGVsbG8=")

    async def test_ftp_scheme_rejected(self, install_service):
        with pytest.raises(ValueError, match="Only http/https"):
            await install_service.install_from_url("ftp://example.com/effect.yaml")

    async def test_missing_scheme_rejected(self, install_service):
        with pytest.raises(ValueError, match="Only http/https"):
            await install_service.install_from_url("example.com/effect.yaml")


class TestInstallUrlSSRF:
    async def test_localhost_rejected(self, install_service):
        with pytest.raises(ValueError, match="only public addresses"):
            await install_service.install_from_url("http://127.0.0.1/effect.yaml")

    async def test_ipv6_loopback_rejected(self, install_service):
        with pytest.raises(ValueError, match="only public addresses"):
            await install_service.install_from_url("http://[::1]/effect.yaml")

    async def test_private_ip_rejected(self, install_service):
        with pytest.raises(ValueError, match="only public addresses"):
            await install_service.install_from_url("http://10.0.0.1/effect.yaml")

    async def test_aws_metadata_link_local_rejected(self, install_service):
        """AWS / cloud metadata endpoint — classic SSRF target."""
        with pytest.raises(ValueError, match="only public addresses"):
            await install_service.install_from_url("http://169.254.169.254/latest/meta-data/")

    async def test_unresolvable_host_raises(self, install_service):
        with pytest.raises(ValueError, match="Cannot resolve"):
            await install_service.install_from_url(
                "http://this-host-should-never-exist.invalid/m.yaml"
            )


class TestSetSource:
    """`set_source` moves non-official effects between the `installed`
    and `local` buckets (bidirectional). Official effects can't be
    touched."""

    async def _seed_installed(self, install_service, **overrides):
        await install_service.install_from_archive(_zip_one(_manifest(**overrides)))
        return await install_service.get_effect("tester", overrides.get("id", "tester/demo").split("/")[1])

    async def test_installed_to_local(self, install_service):
        row = await self._seed_installed(install_service)
        assert row["source"] == "installed"
        await install_service.set_source("tester", "demo", "local")
        row = await install_service.get_effect("tester", "demo")
        assert row["source"] == "local"

    async def test_local_to_installed(self, install_service):
        await self._seed_installed(install_service)
        await install_service.set_source("tester", "demo", "local")
        await install_service.set_source("tester", "demo", "installed")
        row = await install_service.get_effect("tester", "demo")
        assert row["source"] == "installed"

    async def test_same_source_noop(self, install_service):
        """Setting the current value is a silent no-op, not an error."""
        await self._seed_installed(install_service)
        await install_service.set_source("tester", "demo", "installed")  # already installed
        row = await install_service.get_effect("tester", "demo")
        assert row["source"] == "installed"

    async def test_official_rejected(self, install_service):
        await install_service.install_from_archive(
            _zip_one(_manifest(id="openeffect/bundled")),
            allow_official=True,
        )
        with pytest.raises(ValueError, match="official"):
            await install_service.set_source("openeffect", "bundled", "local")

    async def test_invalid_value_rejected(self, install_service):
        await self._seed_installed(install_service)
        with pytest.raises(ValueError, match="Invalid source"):
            await install_service.set_source("tester", "demo", "garbage")

    async def test_missing_effect_rejected(self, install_service):
        with pytest.raises(ValueError, match="not found"):
            await install_service.set_source("nobody", "ghost", "local")


class TestArchiveSymlinkGuard:
    async def test_symlink_entry_rejected(self, install_service):
        """A ZIP member with Unix mode marking it as a symlink must be
        rejected before extraction (symlinks can point anywhere on disk)."""
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            info = zipfile.ZipInfo("evil/manifest.yaml")
            # Unix symlink mode: 0o120000 | 0o777
            info.external_attr = (0o120777 & 0xFFFF) << 16
            zf.writestr(info, "/etc/passwd")
        with pytest.raises(ValueError, match="Symlink not allowed"):
            await install_service.install_from_archive(buf.getvalue())


class TestArchiveAssetWhitelist:
    """Install only copies files listed in manifest.showcases (preview +
    inputs.*) — extras in the zip's assets/ folder are ignored. Matches
    the URL install path, which fetches only declared assets."""

    async def test_extra_asset_in_zip_not_copied(self, install_service):
        m = _manifest(
            showcases=[{"preview": "preview.png", "inputs": {"image": "in.png"}}],
        )
        png_a = _png_bytes(color=(10, 10, 10))
        png_b = _png_bytes(color=(20, 20, 20))
        png_c = _png_bytes(color=(30, 30, 30))
        png_d = _png_bytes(color=(40, 40, 40))
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(f"{m['id']}/manifest.yaml", yaml.dump(m))
            zf.writestr(f"{m['id']}/assets/preview.png", png_a)
            zf.writestr(f"{m['id']}/assets/in.png", png_b)
            # Undeclared extras the author might have left in the folder
            zf.writestr(f"{m['id']}/assets/leftover.png", png_c)
            zf.writestr(f"{m['id']}/assets/notes.png", png_d)

        await install_service.install_from_archive(buf.getvalue())

        row = await install_service.get_effect("tester", "demo")
        assert row is not None
        # Only declared assets get bound — the install path ignores
        # extras in the zip's assets/ folder.
        rows = await install_service._db.fetchall(
            "SELECT logical_name FROM effect_files WHERE effect_id = ?",
            (row["id"],),
        )
        declared = {r["logical_name"] for r in rows}
        assert declared == {"preview.png", "in.png"}

    async def test_missing_declared_asset_raises(self, install_service):
        m = _manifest(showcases=[{"preview": "preview.mp4", "inputs": {}}])
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr(f"{m['id']}/manifest.yaml", yaml.dump(m))
            # preview.mp4 is declared but absent from the archive

        with pytest.raises(ValueError, match="declared in manifest but missing"):
            await install_service.install_from_archive(buf.getvalue())
