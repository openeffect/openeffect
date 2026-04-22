import logging
import os
from typing import Any

import keyring
import keyring.errors

from db.database import Database

logger = logging.getLogger(__name__)

# Live settings and their defaults. Add a new setting by dropping a row in this
# dict; the SQLite `config` table is key/value so no schema migration is needed.
DEFAULTS: dict[str, Any] = {
    "theme": "dark",
}

# Keyring service + username for the FAL API key. The key is stored in the OS
# credential store (macOS Keychain, Windows Credential Manager, Linux
# SecretService) when available; see precedence in `get_api_key`.
_KEYRING_SERVICE = "openeffect"
_KEYRING_KEY_USER = "fal_api_key"
_PROBE_USER = "__openeffect_keyring_probe__"
# DB row key used as a last-resort plaintext fallback on hosts where the OS
# keyring isn't usable (headless Linux, some Docker images). The UI surfaces
# `keyring_available=False` so users can choose to set `FAL_KEY` via env var
# instead of persisting plaintext.
_FAL_KEY_DB_KEY = "fal_api_key"


class ConfigService:
    """Reads / writes non-sensitive settings from a `config` KV table in the
    app's SQLite DB. The FAL API key is stored in the OS keychain when the
    backend supports it, otherwise in the same `config` table as a plaintext
    fallback (for Docker / headless hosts where no OS keyring exists)."""

    def __init__(self, db: Database):
        self._db = db
        self._keyring_available = self._probe_keyring()
        if not self._keyring_available:
            logger.warning(
                "OS keyring is not available — FAL API key saved from the UI "
                "will be stored as plaintext in the SQLite `config` table. "
                "For hosted deployments, set FAL_KEY via env var instead."
            )

    # ─── Public surface ──────────────────────────────────────────────────────

    async def get_public_config(self) -> dict[str, Any]:
        return {
            "has_api_key": bool(await self.get_api_key()),
            "theme": await self._get("theme"),
            "keyring_available": self._keyring_available,
        }

    async def get_api_key(self) -> str | None:
        """Precedence: env FAL_KEY > keychain > DB fallback > None."""
        env_key = os.environ.get("FAL_KEY", "")
        if env_key:
            return env_key
        if self._keyring_available:
            try:
                value = keyring.get_password(_KEYRING_SERVICE, _KEYRING_KEY_USER)
                if value:
                    return value
            except keyring.errors.KeyringError as e:
                logger.warning("keyring read failed: %s", e)
        # DB plaintext fallback (only used on hosts without a usable keyring)
        return await self._get_raw(_FAL_KEY_DB_KEY)

    async def update(self, patch: dict[str, Any]) -> dict[str, Any]:
        """Apply a partial patch. FAL key → keychain or DB fallback; other
        fields → SQLite `config` table."""
        for key, value in patch.items():
            if key == "fal_api_key":
                await self._set_api_key(value)
            elif key in DEFAULTS:
                if value is None:
                    continue
                await self._set(key, str(value))
            # Unknown keys are silently ignored — the route's ConfigPatch
            # already rejects anything that isn't declared.
        return await self.get_public_config()

    # ─── Internals ──────────────────────────────────────────────────────────

    def _probe_keyring(self) -> bool:
        """Round-trip a sentinel credential to verify the backend can actually
        read + write (distinct from `get_keyring()` which returns a backend
        object but may still raise on use)."""
        try:
            keyring.set_password(_KEYRING_SERVICE, _PROBE_USER, "probe")
            keyring.delete_password(_KEYRING_SERVICE, _PROBE_USER)
            return True
        except keyring.errors.KeyringError:
            return False

    async def _get(self, key: str) -> Any:
        """Read a setting with default-fallback."""
        value = await self._get_raw(key)
        return value if value is not None else DEFAULTS.get(key)

    async def _get_raw(self, key: str) -> str | None:
        """Read a row from the `config` table without applying defaults.
        Returns None when the row is absent."""
        row = await self._db.fetchone("SELECT value FROM config WHERE key = ?", (key,))
        return row[0] if row else None

    async def _set(self, key: str, value: str) -> None:
        async with self._db.transaction() as conn:
            await conn.execute(
                "INSERT INTO config (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                (key, value),
            )

    async def _delete(self, key: str) -> None:
        async with self._db.transaction() as conn:
            await conn.execute("DELETE FROM config WHERE key = ?", (key,))

    async def _set_api_key(self, value: str | None) -> None:
        """Empty/None clears the key from every storage location. A non-empty
        value goes into the keychain when available, otherwise into the DB as
        plaintext. When a keychain write succeeds we also scrub any stale DB
        row to avoid split state."""
        if not value:
            if self._keyring_available:
                try:
                    keyring.delete_password(_KEYRING_SERVICE, _KEYRING_KEY_USER)
                except keyring.errors.PasswordDeleteError:
                    pass  # nothing to delete — fine
                except keyring.errors.KeyringError as e:
                    logger.warning("keyring delete failed: %s", e)
            await self._delete(_FAL_KEY_DB_KEY)
            return

        if self._keyring_available:
            try:
                keyring.set_password(_KEYRING_SERVICE, _KEYRING_KEY_USER, value)
                # Scrub any stale DB fallback so get_api_key can't return a
                # different value than the keychain on a later read.
                await self._delete(_FAL_KEY_DB_KEY)
                return
            except keyring.errors.KeyringError as e:
                logger.warning("keyring write failed, falling back to DB: %s", e)

        # Fallback: plaintext in SQLite. The UI is expected to have surfaced
        # `keyring_available=False` so the user made an informed choice.
        await self._set(_FAL_KEY_DB_KEY, value)
