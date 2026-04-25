from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    effects_dir: Path = Path(__file__).parent.parent.parent / "effects"
    user_data_dir: Path = Path.home() / ".openeffect"
    server_port: int = 3131
    server_host: str = "127.0.0.1"
    log_level: str = "info"
    update_version: str = ""
    file_ttl_hours: int = 1
    file_reaper_interval_seconds: int = 3600

    model_config = SettingsConfigDict(env_prefix="OPENEFFECT_")


@lru_cache
def get_settings() -> Settings:
    return Settings()
