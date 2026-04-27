"""Typed domain errors raised by service layer.

Each subclass of `ValueError` so existing `except ValueError` arms (in
`routes/run.py` and the playground route, which want a single 422 for any
invalid request) keep working. Routes that need to disambiguate HTTP
status by category (`routes/effects.py`) catch the typed subclasses
*before* the generic `ValueError` arm — so a service rename of an error
message can never silently shift status from 404 to 400 again.
"""


class EffectNotFoundError(ValueError):
    """Raised when an effect lookup by namespace/slug or UUID misses."""


class AssetNotFoundError(ValueError):
    """Raised when an effect-asset lookup by logical_name misses."""


class OfficialReadOnlyError(ValueError):
    """Raised when a write is attempted against an `official` (bundled)
    effect — uninstall, source change, edit. The route maps this to 400
    with `OFFICIAL_READONLY` so the UI can render a specific message."""
