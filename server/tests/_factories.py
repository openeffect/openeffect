"""Shared test fixtures for building manifest data.

Five test files used to keep their own near-identical `MANIFEST_BASE` /
`_make_manifest()` helpers. Centralizing them here means schema evolution
(e.g. adding `manifest_version`) only touches one file. Per-test variation
goes through keyword overrides on top of the base."""

import copy
from typing import Any

from effects.validator import EffectManifest

_DEFAULT_MANIFEST: dict[str, Any] = {
    "manifest_version": 1,
    "id": "tester/test-effect",
    "name": "Test Effect",
    "description": "A test effect",
    "version": "1.0.0",
    "author": "tester",
    "category": "transform",
    "tags": [],
    "showcases": [],
    "inputs": {
        "image": {
            "type": "image",
            "role": "start_frame",
            "required": True,
            "label": "Photo",
        },
    },
    "generation": {
        "prompt": "A test prompt. {{ prompt }}",
        "models": [],
    },
}


def make_manifest_dict(**overrides: Any) -> dict[str, Any]:
    """Return a fresh deep-copied manifest dict with `overrides` merged at
    the top level. Tests mutate the result freely without affecting other
    tests; nested dicts (`inputs`, `generation`) are also fresh copies."""
    data = copy.deepcopy(_DEFAULT_MANIFEST)
    data.update(overrides)
    return data


def make_manifest(**overrides: Any) -> EffectManifest:
    """Validated `EffectManifest` instance — for tests that need the typed
    pydantic object instead of a raw dict."""
    return EffectManifest.model_validate(make_manifest_dict(**overrides))
