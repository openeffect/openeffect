import sys
from pathlib import Path

# Add server/ to sys.path so imports like `from config.settings import ...` work
sys.path.insert(0, str(Path(__file__).parent.parent))

import pytest


@pytest.fixture(autouse=True)
def _isolate_keyring(monkeypatch):
    """Swap the three keyring methods we use for an in-memory dict so tests
    never touch the dev's real OS keychain."""
    store: dict[tuple[str, str], str] = {}

    def _get(service: str, user: str) -> str | None:
        return store.get((service, user))

    def _set(service: str, user: str, value: str) -> None:
        store[(service, user)] = value

    def _delete(service: str, user: str) -> None:
        if (service, user) not in store:
            import keyring.errors
            raise keyring.errors.PasswordDeleteError("not found")
        del store[(service, user)]

    monkeypatch.setattr("keyring.get_password", _get)
    monkeypatch.setattr("keyring.set_password", _set)
    monkeypatch.setattr("keyring.delete_password", _delete)
    yield store
