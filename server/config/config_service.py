import json
import os
from pathlib import Path
from typing import Any

DEFAULT_CONFIG = {
    "fal_api_key": "",
    "default_model": "wan-2.2",
    "theme": "dark",
    "server_port": 3131,
    "history_limit": 50,
    "output_storage": "tmp",
}


class ConfigService:
    def __init__(self, config_path: Path):
        self._path = config_path
        self._cache: dict[str, Any] | None = None

    def _read_raw(self) -> dict[str, Any]:
        if self._cache is not None:
            return self._cache
        if self._path.exists():
            with open(self._path) as f:
                self._cache = {**DEFAULT_CONFIG, **json.load(f)}
        else:
            self._cache = dict(DEFAULT_CONFIG)
        return self._cache

    def get_public_config(self) -> dict[str, Any]:
        raw = self._read_raw()
        return {
            "has_api_key": bool(self.get_api_key()),
            "default_model": raw.get("default_model", "wan-2.2"),
            "theme": raw.get("theme", "dark"),
            "history_limit": raw.get("history_limit", 50),
        }

    def get_api_key(self) -> str | None:
        # FAL_KEY env var takes precedence (used in Docker)
        env_key = os.environ.get("FAL_KEY", "")
        if env_key:
            return env_key
        raw = self._read_raw()
        key = raw.get("fal_api_key", "")
        return key if key else None

    def update(self, patch: dict[str, Any]) -> dict[str, Any]:
        raw = self._read_raw()
        raw.update(patch)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        with open(self._path, "w") as f:
            json.dump(raw, f, indent=2)
        self._cache = raw
        return self.get_public_config()

    def get_raw(self) -> dict[str, Any]:
        return dict(self._read_raw())
