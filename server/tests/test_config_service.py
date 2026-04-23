"""Tests for ConfigService — SQLite-backed settings with keychain or
DB-plaintext-fallback storage for the FAL API key."""
import sqlite3
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
def db_path(tmp_path: Path, database: Database) -> Path:
    """Tests that poke the DB directly via sync sqlite3 need the file path.
    Depends on `database` to guarantee the schema is initialized first."""
    return database._path


@pytest.fixture
async def service(database: Database) -> ConfigService:
    return ConfigService(database)


class TestDefaults:
    async def test_empty_db_returns_defaults(self, service: ConfigService):
        config = await service.get_public_config()
        assert config == {
            "has_api_key": False,
            "api_key_from_env": False,
            "theme": "dark",
            "keyring_available": True,
        }

    async def test_api_key_missing_returns_none(self, service: ConfigService):
        assert await service.get_api_key() is None


class TestThemeRoundTrip:
    async def test_set_theme_persists(self, service: ConfigService, database: Database):
        await service.update({"theme": "light"})
        # Fresh instance on the same Database reads the persisted value
        assert (await ConfigService(database).get_public_config())["theme"] == "light"

    async def test_unknown_key_ignored_by_service(self, service: ConfigService):
        """Unknown keys at the service layer are no-ops (the route's
        ConfigPatch is the real input guard)."""
        await service.update({"theme": "light", "bogus": "x"})
        assert (await service.get_public_config())["theme"] == "light"


class TestApiKeyKeychainPath:
    async def test_save_key_goes_to_keychain_not_db(
        self, service: ConfigService, db_path: Path, _isolate_keyring
    ):
        await service.update({"fal_api_key": "sk-live-abc"})

        assert _isolate_keyring[("openeffect", "fal_api_key")] == "sk-live-abc"
        with sqlite3.connect(str(db_path)) as db:
            rows = db.execute("SELECT key FROM config").fetchall()
        assert all(r[0] != "fal_api_key" for r in rows)

    async def test_get_api_key_reads_keychain(
        self, service: ConfigService, _isolate_keyring
    ):
        await service.update({"fal_api_key": "sk-live-xyz"})
        assert await service.get_api_key() == "sk-live-xyz"
        assert (await service.get_public_config())["has_api_key"] is True

    async def test_empty_string_clears_key(
        self, service: ConfigService, _isolate_keyring
    ):
        await service.update({"fal_api_key": "sk-initial"})
        await service.update({"fal_api_key": ""})
        assert await service.get_api_key() is None
        assert (await service.get_public_config())["has_api_key"] is False

    async def test_clear_when_no_existing_key_is_noop(self, service: ConfigService):
        await service.update({"fal_api_key": ""})
        assert await service.get_api_key() is None

    async def test_successful_keychain_write_scrubs_stale_db_row(
        self, service: ConfigService, database: Database, _isolate_keyring
    ):
        """Imagine the user previously saved a key while keyring was broken
        (landed in the DB), then the keyring became available. Saving a new
        key should write to keyring AND remove the DB row."""
        async with database.transaction() as conn:
            await conn.execute(
                "INSERT INTO config (key, value) VALUES ('fal_api_key', 'stale')"
            )

        await service.update({"fal_api_key": "sk-new"})
        assert await service.get_api_key() == "sk-new"
        row = await database.fetchone(
            "SELECT value FROM config WHERE key = 'fal_api_key'"
        )
        assert row is None


class TestEnvPrecedence:
    async def test_env_var_overrides_keychain(
        self, service: ConfigService, _isolate_keyring, monkeypatch
    ):
        await service.update({"fal_api_key": "sk-from-keychain"})
        monkeypatch.setenv("FAL_KEY", "sk-from-env")
        assert await service.get_api_key() == "sk-from-env"

    async def test_has_api_key_true_when_only_env_set(
        self, service: ConfigService, monkeypatch
    ):
        monkeypatch.setenv("FAL_KEY", "sk-env-only")
        assert (await service.get_public_config())["has_api_key"] is True

    async def test_api_key_from_env_flag_reflects_env(
        self, service: ConfigService, _isolate_keyring, monkeypatch
    ):
        """Client uses `api_key_from_env` to swap the settings input for a
        read-only notice — it should be True only when FAL_KEY is set."""
        monkeypatch.setenv("FAL_KEY", "sk-env-only")
        assert (await service.get_public_config())["api_key_from_env"] is True

        monkeypatch.setenv("FAL_KEY", "")
        await service.update({"fal_api_key": "sk-keychain"})
        assert (await service.get_public_config())["api_key_from_env"] is False

    async def test_empty_env_falls_back_to_keychain(
        self, service: ConfigService, _isolate_keyring, monkeypatch
    ):
        await service.update({"fal_api_key": "sk-keychain"})
        monkeypatch.setenv("FAL_KEY", "")
        assert await service.get_api_key() == "sk-keychain"


class TestKeyringUnavailable:
    """When the probe fails (headless Linux / minimal Docker), the service
    exposes `keyring_available=False` and transparently stores the FAL key as
    plaintext in the `config` table — the UI is expected to have warned the
    user and recommended setting FAL_KEY via env var instead."""

    @pytest.fixture
    def broken_keyring(self, monkeypatch):
        import keyring.errors

        def _boom(*_args, **_kwargs):
            raise keyring.errors.KeyringError("backend unavailable")

        monkeypatch.setattr("keyring.get_password", _boom)
        monkeypatch.setattr("keyring.set_password", _boom)
        monkeypatch.setattr("keyring.delete_password", _boom)

    @pytest.fixture
    async def service_no_keyring(self, database: Database, broken_keyring) -> ConfigService:
        return ConfigService(database)

    async def test_probe_reports_unavailable(self, service_no_keyring: ConfigService):
        assert (await service_no_keyring.get_public_config())["keyring_available"] is False

    async def test_save_falls_back_to_db(
        self, service_no_keyring: ConfigService, database: Database
    ):
        await service_no_keyring.update({"fal_api_key": "sk-fallback"})
        row = await database.fetchone(
            "SELECT value FROM config WHERE key = 'fal_api_key'"
        )
        assert row is not None
        assert row[0] == "sk-fallback"

    async def test_get_reads_db_fallback(self, service_no_keyring: ConfigService):
        await service_no_keyring.update({"fal_api_key": "sk-fallback"})
        assert await service_no_keyring.get_api_key() == "sk-fallback"
        assert (await service_no_keyring.get_public_config())["has_api_key"] is True

    async def test_clear_removes_from_db(
        self, service_no_keyring: ConfigService, database: Database
    ):
        await service_no_keyring.update({"fal_api_key": "sk-initial"})
        await service_no_keyring.update({"fal_api_key": ""})
        assert await service_no_keyring.get_api_key() is None

        row = await database.fetchone(
            "SELECT value FROM config WHERE key = 'fal_api_key'"
        )
        assert row is None

    async def test_env_var_still_overrides(
        self, service_no_keyring: ConfigService, monkeypatch
    ):
        await service_no_keyring.update({"fal_api_key": "sk-db-value"})
        monkeypatch.setenv("FAL_KEY", "sk-env-wins")
        assert await service_no_keyring.get_api_key() == "sk-env-wins"
