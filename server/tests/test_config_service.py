"""Tests for ConfigService."""
import json
import pytest
from pathlib import Path
from app.config.config_service import ConfigService


@pytest.fixture
def tmp_config(tmp_path: Path) -> Path:
    return tmp_path / "config.json"


class TestConfigService:
    def test_missing_file_returns_defaults(self, tmp_config: Path):
        service = ConfigService(tmp_config)
        config = service.get_public_config()
        assert config["has_api_key"] is False
        assert config["default_model"] == "fal-ai/wan-2.2"
        assert config["theme"] == "dark"

    def test_read_config_from_file(self, tmp_config: Path):
        tmp_config.write_text(json.dumps({"fal_api_key": "key_abc", "theme": "light"}))
        service = ConfigService(tmp_config)
        config = service.get_public_config()
        assert config["has_api_key"] is True
        assert config["theme"] == "light"

    def test_api_key_never_returned_in_public(self, tmp_config: Path):
        tmp_config.write_text(json.dumps({"fal_api_key": "secret_key_123"}))
        service = ConfigService(tmp_config)
        config = service.get_public_config()
        assert "fal_api_key" not in config
        assert config["has_api_key"] is True

    def test_get_api_key(self, tmp_config: Path):
        tmp_config.write_text(json.dumps({"fal_api_key": "key_xyz"}))
        service = ConfigService(tmp_config)
        assert service.get_api_key() == "key_xyz"

    def test_get_api_key_when_empty(self, tmp_config: Path):
        service = ConfigService(tmp_config)
        assert service.get_api_key() is None

    def test_write_config_persists(self, tmp_config: Path):
        service = ConfigService(tmp_config)
        service.update({"fal_api_key": "new_key", "theme": "light"})

        # Read from disk
        saved = json.loads(tmp_config.read_text())
        assert saved["fal_api_key"] == "new_key"
        assert saved["theme"] == "light"

    def test_partial_update_merges(self, tmp_config: Path):
        tmp_config.write_text(json.dumps({"fal_api_key": "old_key", "theme": "dark"}))
        service = ConfigService(tmp_config)
        service.update({"theme": "light"})

        raw = service.get_raw()
        assert raw["fal_api_key"] == "old_key"
        assert raw["theme"] == "light"

    def test_has_api_key_false_when_empty_string(self, tmp_config: Path):
        tmp_config.write_text(json.dumps({"fal_api_key": ""}))
        service = ConfigService(tmp_config)
        config = service.get_public_config()
        assert config["has_api_key"] is False
