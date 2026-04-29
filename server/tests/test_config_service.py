"""Tests for ConfigService — SQLite-backed `theme` plus a JSON file for the
FAL API key (mode 0o600 at `~/.openeffect/config.json` in production)."""
import json
import logging
import os
import stat
from pathlib import Path

import pytest

from config.config_service import ConfigService
from db.database import Database, init_db


@pytest.fixture
async def database(tmp_path: Path):
    p = tmp_path / "test.db"
    await init_db(p)
    db = Database(p)
    await db.connect()
    yield db
    await db.close()


@pytest.fixture
def config_path(tmp_path: Path) -> Path:
    return tmp_path / "config.json"


@pytest.fixture
async def service(database: Database, config_path: Path) -> ConfigService:
    return ConfigService(database, config_path)


class TestDefaults:
    async def test_empty_state_returns_defaults(self, service: ConfigService):
        config = await service.get_public_config()
        assert config == {
            "has_api_key": False,
            "api_key_from_env": False,
            "theme": "dark",
        }

    async def test_api_key_missing_returns_none(self, service: ConfigService):
        assert await service.get_api_key() is None


class TestThemeRoundTrip:
    async def test_set_theme_persists(
        self, service: ConfigService, database: Database, config_path: Path
    ):
        await service.update({"theme": "light"})
        # Fresh instance on the same Database reads the persisted value
        fresh = ConfigService(database, config_path)
        assert (await fresh.get_public_config())["theme"] == "light"

    async def test_unknown_key_ignored_by_service(self, service: ConfigService):
        """Unknown keys at the service layer are no-ops (the route's
        ConfigPatch is the real input guard)."""
        await service.update({"theme": "light", "bogus": "x"})
        assert (await service.get_public_config())["theme"] == "light"


class TestApiKeyFileStorage:
    async def test_save_writes_to_config_json(
        self, service: ConfigService, config_path: Path
    ):
        await service.update({"fal_api_key": "sk-live-abc"})
        data = json.loads(config_path.read_text())
        assert data == {"config_version": 1, "fal_api_key": "sk-live-abc"}
        # Version must be the leading field so a `head -1 config.json`
        # reveals the schema before any sensitive value follows.
        assert next(iter(data)) == "config_version"

    @pytest.mark.skipif(os.name != "posix", reason="POSIX permission semantics")
    async def test_file_is_mode_0o600(
        self, service: ConfigService, config_path: Path
    ):
        await service.update({"fal_api_key": "sk-live-abc"})
        mode = stat.S_IMODE(config_path.stat().st_mode)
        assert mode == 0o600, f"expected 0o600, got 0o{mode:03o}"

    async def test_get_reads_from_config_json(self, service: ConfigService):
        await service.update({"fal_api_key": "sk-live-xyz"})
        assert await service.get_api_key() == "sk-live-xyz"
        assert (await service.get_public_config())["has_api_key"] is True

    async def test_overwrite_replaces_value(
        self, service: ConfigService, config_path: Path
    ):
        await service.update({"fal_api_key": "sk-old"})
        await service.update({"fal_api_key": "sk-new"})
        assert await service.get_api_key() == "sk-new"
        assert json.loads(config_path.read_text()) == {
            "config_version": 1,
            "fal_api_key": "sk-new",
        }

    async def test_empty_string_clears_key(
        self, service: ConfigService, config_path: Path
    ):
        await service.update({"fal_api_key": "sk-initial"})
        await service.update({"fal_api_key": ""})
        assert await service.get_api_key() is None
        assert (await service.get_public_config())["has_api_key"] is False
        # File still exists (room for future fields), but the key is gone
        assert "fal_api_key" not in json.loads(config_path.read_text())

    async def test_clear_when_no_existing_key_is_noop(
        self, service: ConfigService, config_path: Path
    ):
        """Saving an empty key when nothing is stored shouldn't create a
        useless empty file on disk."""
        await service.update({"fal_api_key": ""})
        assert await service.get_api_key() is None
        assert not config_path.exists()

    async def test_missing_file_returns_none(
        self, service: ConfigService, config_path: Path
    ):
        assert not config_path.exists()
        assert await service.get_api_key() is None
        assert (await service.get_public_config())["has_api_key"] is False

    async def test_corrupt_json_returns_none_and_warns(
        self,
        service: ConfigService,
        config_path: Path,
        caplog: pytest.LogCaptureFixture,
    ):
        config_path.write_text("{not valid json")
        with caplog.at_level(logging.WARNING):
            assert await service.get_api_key() is None
        assert any("not valid JSON" in m for m in caplog.messages)

    async def test_non_object_json_returns_none_and_warns(
        self,
        service: ConfigService,
        config_path: Path,
        caplog: pytest.LogCaptureFixture,
    ):
        """A user editing the file to a JSON array or string shouldn't
        crash the app; treat it the same as an empty config."""
        config_path.write_text('"just a string"')
        with caplog.at_level(logging.WARNING):
            assert await service.get_api_key() is None
        assert any("does not contain a JSON object" in m for m in caplog.messages)


class TestEnvPrecedence:
    async def test_env_var_overrides_file(
        self, service: ConfigService, monkeypatch
    ):
        await service.update({"fal_api_key": "sk-from-file"})
        monkeypatch.setenv("FAL_KEY", "sk-from-env")
        assert await service.get_api_key() == "sk-from-env"

    async def test_has_api_key_true_when_only_env_set(
        self, service: ConfigService, monkeypatch
    ):
        monkeypatch.setenv("FAL_KEY", "sk-env-only")
        assert (await service.get_public_config())["has_api_key"] is True

    async def test_api_key_from_env_flag_reflects_env(
        self, service: ConfigService, monkeypatch
    ):
        """Client uses `api_key_from_env` to swap the settings input for a
        read-only notice — it should be True only when FAL_KEY is set."""
        monkeypatch.setenv("FAL_KEY", "sk-env-only")
        assert (await service.get_public_config())["api_key_from_env"] is True

        monkeypatch.setenv("FAL_KEY", "")
        await service.update({"fal_api_key": "sk-file"})
        assert (await service.get_public_config())["api_key_from_env"] is False

    async def test_empty_env_falls_back_to_file(
        self, service: ConfigService, monkeypatch
    ):
        await service.update({"fal_api_key": "sk-file"})
        monkeypatch.setenv("FAL_KEY", "")
        assert await service.get_api_key() == "sk-file"
