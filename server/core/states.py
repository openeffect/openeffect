"""Type-narrowed string enums for the persistent state machines.

Effect rows go through `installing → ready → uninstalling`; run rows go
through `processing → completed | failed`. SQL queries still use string
literals (embedding constants via f-strings would be uglier than the
status quo), but everywhere the values flow through Python - typed
dataclass fields, comparisons, kwarg assignments - the `Literal`
aliases let mypy catch typos before they hit a row."""

from typing import Literal

# Run lifecycle.
RunStatus = Literal["processing", "completed", "failed"]
RunKind = Literal["effect", "playground"]

# Effect lifecycle (row's `state` column).
EffectState = Literal["installing", "ready", "uninstalling"]

# Effect provenance (row's `source` column).
EffectSource = Literal["official", "installed", "local"]
