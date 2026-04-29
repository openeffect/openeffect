import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any

from db.database import Database

logger = logging.getLogger(__name__)

# Live settings and their defaults. Add a new setting by dropping a row in this
# dict; the SQLite `config` table is key/value so no schema migration is needed.
DEFAULTS: dict[str, Any] = {
    "theme": "dark",
}

# Schema version stamped into ~/.openeffect/config.json so future shape
# changes (e.g. richer auth blob, new stored secrets) can migrate by
# `if data.get("config_version", 0) < N: …` instead of guessing from the
# absence of fields. Bump when changing the file's shape.
CONFIG_VERSION = 1


class ConfigService:
    """Reads / writes non-sensitive settings (theme, etc.) from the SQLite
    `config` KV table. The FAL API key lives separately in a JSON file at
    `~/.openeffect/config.json` with mode 0o600 - a single-user desktop app
    on localhost uses filesystem perms as the security boundary, so we skip
    the OS keyring and its native dependency."""

    def __init__(self, db: Database, config_path: Path):
        self._db = db
        self._config_path = config_path
        # Serializes concurrent writers to the JSON file so two near-
        # simultaneous saves don't fight over the same tmp path.
        self._lock = asyncio.Lock()

    # ─── Public surface ──────────────────────────────────────────────────────

    async def get_public_config(self) -> dict[str, Any]:
        return {
            "has_api_key": bool(await self.get_api_key()),
            # When FAL_KEY is set in the environment it wins over any saved
            # value and can't be overridden from the UI. The client uses this
            # to render a read-only settings notice instead of the editable
            # input.
            "api_key_from_env": bool(os.environ.get("FAL_KEY", "")),
            "theme": await self._get("theme"),
        }

    async def get_api_key(self) -> str | None:
        """Precedence: env FAL_KEY > config.json > None."""
        env_key = os.environ.get("FAL_KEY", "")
        if env_key:
            return env_key
        secrets = await asyncio.to_thread(self._read_secrets_sync)
        return secrets.get("fal_api_key") or None

    async def update(self, patch: dict[str, Any]) -> dict[str, Any]:
        """Apply a partial patch. FAL key → config.json; other fields →
        SQLite `config` table."""
        for key, value in patch.items():
            if key == "fal_api_key":
                await self._set_api_key(value)
            elif key in DEFAULTS:
                if value is None:
                    continue
                await self._set(key, str(value))
            # Unknown keys are silently ignored - the route's ConfigPatch
            # already rejects anything that isn't declared.
        return await self.get_public_config()

    # ─── Internals ──────────────────────────────────────────────────────────

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

    async def _set_api_key(self, value: str | None) -> None:
        """Empty/None removes the key from the JSON file (no-op when nothing
        is stored). A non-empty value replaces it. The lock serializes writers
        so two saves don't race over the tmp file."""
        async with self._lock:
            secrets = await asyncio.to_thread(self._read_secrets_sync)
            if value:
                secrets["fal_api_key"] = value
            elif "fal_api_key" in secrets:
                secrets.pop("fal_api_key")
            else:
                return  # nothing to clear - skip the write
            await asyncio.to_thread(self._write_secrets_sync, secrets)

    def _read_secrets_sync(self) -> dict[str, Any]:
        """Read the JSON secrets file. Missing → empty dict. Malformed →
        empty dict + warn so the user can repair the file by hand (we don't
        crash on a manually-edited typo)."""
        try:
            text = self._config_path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return {}
        try:
            data = json.loads(text)
        except json.JSONDecodeError as e:
            logger.warning(
                "config file %s is not valid JSON (%s) - ignoring saved key. "
                "Re-save from Settings to repair.",
                self._config_path, e,
            )
            return {}
        if not isinstance(data, dict):
            logger.warning(
                "config file %s does not contain a JSON object - ignoring.",
                self._config_path,
            )
            return {}
        return data

    def _write_secrets_sync(self, data: dict[str, Any]) -> None:
        """Atomically replace the secrets file with `data`. Any leftover tmp
        file from a crashed write is unlinked first so `O_EXCL`'s `0o600`
        mode arg actually applies - `O_CREAT|O_TRUNC` wouldn't reset perms
        on an already-existing file. `config_version` is always re-stamped
        as the leading key so the file's first line tells you the schema."""
        data = {
            "config_version": CONFIG_VERSION,
            **{k: v for k, v in data.items() if k != "config_version"},
        }
        tmp_path = self._config_path.with_suffix(".json.tmp")
        tmp_path.unlink(missing_ok=True)
        fd = os.open(tmp_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
                f.flush()
                os.fsync(f.fileno())
            os.chmod(tmp_path, 0o600)  # belt-and-suspenders against umask
            os.replace(tmp_path, self._config_path)
        except Exception:
            tmp_path.unlink(missing_ok=True)
            raise
