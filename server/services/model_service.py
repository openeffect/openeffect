import logging
from collections.abc import Callable
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


# ─── Registry shape ──────────────────────────────────────────────────────────
#
# Each model has three layers:
#
#   1. `inputs` — canonical text/image role entries the author binds via
#      `manifest.inputs` (and via `generation.prompt` /
#      `generation.negative_prompt` for the always-present text roles).
#      Examples: `start_frame`, `end_frame`, `reference`, `prompt`,
#      `negative_prompt`.
#
#   2. `params` — canonical tunable knob entries, author-facing. These carry
#      the UI metadata (label, type, default, min/max, ui placement) plus
#      two routing flags:
#        - `user_only: True`    → never settable via manifest; runtime user
#                                 preference (e.g. `resolution`, `seed`).
#        - `effect_hidden: True`→ not shown on the effect page; manifest
#                                 authors tune via YAML. Playground still
#                                 renders it.
#
#   3. `providers.<id>` — wire layer. Each provider owns:
#        - `endpoint`        — wire URL / identifier.
#        - `cost`            — pricing string from the provider's page.
#        - `inputs`          — `{canonical_role: wire_key}`. Roles absent
#                              from this map are unsupported for this
#                              provider (UI greys them out upstream).
#        - `params`          — `{canonical_name: {wire: str|None, ...}}`.
#                              Canonicals absent here are silently dropped
#                              at send time for this provider. `wire: None`
#                              marks a canonical that's consumed by the
#                              transform rather than renamed directly.
#                              Any extra keys here (e.g. `max`, `default`,
#                              `options`) overlay the canonical UI metadata
#                              for this provider — use it when one provider
#                              accepts a tighter range or different default.
#        - `transform`       — optional callable `(canonical_dict) → dict`.
#                              Runs after value resolution, before the
#                              canonical→wire rename. Use it for derived
#                              fields (split one canonical into multiple
#                              wire keys) or per-provider value conversions.
#                              No active model uses one today; kept as a
#                              hook for any future provider that needs it.
#
# Effect manifests reference only the canonical layer (inputs + params).
# Adding a provider is purely additive — drop in a new `providers.<id>`
# entry; no manifest migration.


# ─── Providers registry ──────────────────────────────────────────────────────
PROVIDERS: dict[str, dict[str, Any]] = {
    "fal": {
        "name": "fal.ai",
        "type": "cloud",
    },
}

# Per-provider image-mime whitelists. Compared against each input file's
# sniffed `mime` (set server-side from magic bytes at upload time). The
# run-dispatch path consults this and transcodes unsupported uploads to
# PNG via `core.image_convert.ensure_mime` before sending. Single source
# of truth — every provider entry below references the constant rather
# than duplicating the list.
FAL_IMAGE_MIMES: tuple[str, ...] = (
    "image/jpeg", "image/png", "image/webp", "image/gif", "image/avif",
)


MODELS: list[dict[str, Any]] = [
    # Registry entries are ordered alphabetically by `id`. Within each
    # entry, `inputs` and `params` follow UI flow: image roles first (the
    # effect's subject) → text roles → main knobs (user-configurable) →
    # advanced knobs (collapsed by default) → wire-only knobs (manifest-
    # tunable, not rendered). `seed` and feature toggles (`generate_audio`)
    # end each block by convention.

    # ── Kling 3.0 ─────────────────────────────────────────────────────────
    {
        "id": "kling-3.0",
        "name": "Kling 3.0",
        "group": "Kling",
        "description": "Best for character-driven shots and emotional pacing",
        "inputs": [
            {"role": "start_frame",     "type": "image", "required": True},
            {"role": "end_frame",       "type": "image"},
            {"role": "prompt",          "type": "text",  "required": True},
            {"role": "negative_prompt", "type": "text"},
        ],
        "params": [
            # ─── Main (user-facing) ───
            # `generate_audio` goes last in main — it's a feature toggle,
            # conceptually separate from the output-shaping knobs above.
            {"name": "duration", "type": "slider", "ui": "main",
             "label": "Duration (seconds)",
             "default": 5, "min": 3, "max": 15, "step": 1},
            # Resolution routes to fal's standard (720p) vs pro (1080p)
            # endpoint — see the lambda in `providers.fal.endpoint` below.
            # Pro pricing is materially higher, hence `price_affecting`.
            {"name": "resolution", "type": "select", "ui": "main",
             "label": "Resolution", "default": "720p",
             "options": [
                 {"value": "720p",  "label": "720p"},
                 {"value": "1080p", "label": "1080p"},
             ],
             "user_only": True,
             "price_affecting": True},
            {"name": "generate_audio", "type": "boolean", "ui": "main",
             "label": "Generate audio", "default": False,
             "price_affecting": True},

            # ─── Advanced (collapsed) ───
            # `guidance_scale` is kling-specific here (wan-2.7 drops it);
            # wire key stays `cfg_scale` — that's what kling's fal endpoint
            # accepts.
            {"name": "guidance_scale", "type": "slider", "ui": "advanced",
             "label": "Guidance scale",
             "default": 0.5, "min": 0.0, "max": 1.0, "step": 0.05,
             "effect_hidden": True},
            {"name": "seed", "type": "number", "ui": "advanced",
             "label": "Seed", "default": -1, "hint": "-1 = random",
             "user_only": True},
        ],
        "providers": {
            "fal": {
                "accepted_image_mimes": FAL_IMAGE_MIMES,
                # Endpoint is a function so we can route 1080p to fal's
                # pro tier. Any provider whose URL depends on a canonical
                # value can do the same.
                "endpoint": lambda p: (
                    "fal-ai/kling-video/v3/pro/image-to-video"
                    if p.get("resolution") == "1080p"
                    else "fal-ai/kling-video/v3/standard/image-to-video"
                ),
                # Rendered in the tooltip with `whitespace-pre font-mono`,
                # so the spaces below become real columns (resolution · price
                # · price-with-audio).
                "cost": (
                    "720p   $0.084/s  $0.126/s with audio\n"
                    "1080p  $0.112/s  $0.168/s with audio"
                ),
                "inputs": {
                    "start_frame":     "start_image_url",
                    "end_frame":       "end_image_url",
                    "prompt":          "prompt",
                    "negative_prompt": "negative_prompt",
                },
                "params": {
                    # Main
                    "duration":       {"wire": "duration"},
                    # `resolution` is consumed by the endpoint resolver above;
                    # fal's kling endpoints don't accept it as a field, so
                    # `wire: None` drops it from the outgoing payload.
                    "resolution":     {"wire": None},
                    "generate_audio": {"wire": "generate_audio"},
                    # Advanced — canonical `guidance_scale`, wire `cfg_scale`.
                    "guidance_scale": {"wire": "cfg_scale"},
                    # seed not declared on kling v3 fal → silently dropped
                },
            },
        },
    },
    # ── PixVerse V6 ───────────────────────────────────────────────────────
    {
        "id": "pixverse-v6",
        "name": "PixVerse V6",
        "group": "PixVerse",
        "description": "Best for movement-heavy or stylized effects",
        "inputs": [
            {"role": "start_frame",     "type": "image", "required": True},
            {"role": "end_frame",       "type": "image"},
            {"role": "prompt",          "type": "text",  "required": True},
            {"role": "negative_prompt", "type": "text"},
        ],
        "params": [
            # ─── Main (user-facing) ───
            # Output shape (duration, resolution, aspect_ratio) → look
            # (style) → feature toggle (generate_audio, last).
            {"name": "duration", "type": "slider", "ui": "main",
             "label": "Duration (seconds)",
             "default": 5, "min": 1, "max": 15, "step": 1},
            # Resolution spans 4 tiers here; pricing scales ~4× across
            # them (see the `cost` string below), so it's price_affecting.
            {"name": "resolution", "type": "select", "ui": "main",
             "label": "Resolution", "default": "720p",
             "options": [
                 {"value": "360p",  "label": "360p"},
                 {"value": "540p",  "label": "540p"},
                 {"value": "720p",  "label": "720p"},
                 {"value": "1080p", "label": "1080p"},
             ],
             "user_only": True,
             "price_affecting": True},
            {"name": "aspect_ratio", "type": "select", "ui": "main",
             "label": "Aspect Ratio", "default": "16:9",
             "options": [
                 {"value": "16:9", "label": "16:9"},
                 {"value": "9:16", "label": "9:16"},
                 {"value": "1:1",  "label": "1:1"},
             ],
             "user_only": True},
            # `style` is an author-tuning knob: the effect's prompt already
            # expresses the intended look, so we don't surface a second
            # "pick a style" control on the effect page. Manifest authors
            # can still lock a style via YAML, and Playground shows it
            # (Playground ignores `effect_hidden`).
            {"name": "style", "type": "select", "ui": "main",
             "label": "Style", "default": "",
             "options": [
                 {"value": "",             "label": "None"},
                 {"value": "anime",        "label": "Anime"},
                 {"value": "3d_animation", "label": "3D Animation"},
                 {"value": "clay",         "label": "Clay"},
                 {"value": "comic",        "label": "Comic"},
                 {"value": "cyberpunk",    "label": "Cyberpunk"},
             ],
             "effect_hidden": True},
            {"name": "generate_audio", "type": "boolean", "ui": "main",
             "label": "Generate audio", "default": False,
             "price_affecting": True},

            # ─── Advanced (collapsed) ───
            {"name": "seed", "type": "number", "ui": "advanced",
             "label": "Seed", "default": -1, "hint": "-1 = random",
             "user_only": True},
        ],
        "providers": {
            "fal": {
                "accepted_image_mimes": FAL_IMAGE_MIMES,
                "endpoint": "fal-ai/pixverse/v6/image-to-video",
                "cost": (
                    "360p   $0.025/s  $0.035/s with audio\n"
                    "540p   $0.035/s  $0.045/s with audio\n"
                    "720p   $0.045/s  $0.060/s with audio\n"
                    "1080p  $0.090/s  $0.115/s with audio"
                ),
                "inputs": {
                    "start_frame":     "image_url",
                    # end_frame omitted — fal's i2v doesn't support it
                    "prompt":          "prompt",
                    "negative_prompt": "negative_prompt",
                },
                "params": {
                    # Main
                    "duration":       {"wire": "duration"},
                    "resolution":     {"wire": "resolution"},
                    # aspect_ratio omitted — fal's i2v doesn't accept it
                    "style":          {"wire": "style"},
                    "generate_audio": {"wire": "generate_audio_switch"},
                    # Advanced
                    "seed":           {"wire": "seed"},
                },
            },
        },
    },
    # ── Wan 2.7 ───────────────────────────────────────────────────────────
    # fal's v2.7 accepts `duration` natively as an integer 2–15 s, so no
    # transform is needed — the canonical flows straight to the wire.
    {
        "id": "wan-2.7",
        "name": "Wan 2.7",
        "group": "Wan",
        "description": "Best for action, transformations, and detail-rich scenes",
        "inputs": [
            {"role": "start_frame",     "type": "image", "required": True},
            {"role": "end_frame",       "type": "image"},
            {"role": "prompt",          "type": "text",  "required": True},
            {"role": "negative_prompt", "type": "text"},
        ],
        "params": [
            # ─── Main (user-facing) ───
            {"name": "duration", "type": "slider", "ui": "main",
             "label": "Duration (seconds)",
             "default": 5, "min": 2, "max": 15, "step": 1},
            {"name": "resolution", "type": "select", "ui": "main",
             "label": "Resolution", "default": "1080p",
             "options": [
                 {"value": "720p",  "label": "720p"},
                 {"value": "1080p", "label": "1080p"},
             ],
             "user_only": True},

            # ─── Advanced (collapsed) ───
            {"name": "seed", "type": "number", "ui": "advanced",
             "label": "Seed", "default": -1, "hint": "-1 = random",
             "user_only": True},

            # ─── Wire-only knobs (no `ui` key → never reaches the client) ───
            {"name": "enable_safety_checker",   "type": "boolean"},
            {"name": "enable_prompt_expansion", "type": "boolean"},
        ],
        "providers": {
            "fal": {
                "accepted_image_mimes": FAL_IMAGE_MIMES,
                "endpoint": "fal-ai/wan/v2.7/image-to-video",
                # Flat rate across resolution and audio — no tier table.
                "cost": "$0.10/s",
                "inputs": {
                    "start_frame":     "image_url",
                    "end_frame":       "end_image_url",
                    "prompt":          "prompt",
                    "negative_prompt": "negative_prompt",
                },
                "params": {
                    # Main
                    "duration":                {"wire": "duration"},
                    "resolution":              {"wire": "resolution"},
                    # Advanced
                    "seed":                    {"wire": "seed"},
                    # Wire-only
                    "enable_safety_checker":   {"wire": "enable_safety_checker"},
                    "enable_prompt_expansion": {"wire": "enable_prompt_expansion"},
                },
            },
        },
    },
]

# Build lookup dicts
MODELS_BY_ID: dict[str, dict[str, Any]] = {m["id"]: m for m in MODELS}


# ─── Helpers ─────────────────────────────────────────────────────────────────


def get_model(model_id: str) -> dict[str, Any] | None:
    return MODELS_BY_ID.get(model_id)


def get_provider(model_id: str, provider_id: str) -> dict[str, Any] | None:
    """Returns the per-provider wire config
    `{endpoint, cost, inputs, params, transform?}`, or None."""
    model = MODELS_BY_ID.get(model_id)
    if not model:
        return None
    return model.get("providers", {}).get(provider_id)


def resolve_endpoint(
    provider_cfg: dict[str, Any],
    canonical: dict[str, Any],
) -> str | None:
    """`provider.endpoint` can be either a bare URL string or a callable
    taking the canonical param dict and returning the URL. The callable
    form is how models route to per-tier endpoints (e.g. kling's
    pro/standard split driven by resolution)."""
    endpoint = provider_cfg.get("endpoint")
    if callable(endpoint):
        return endpoint(canonical)
    return endpoint


def model_input_roles(model: dict[str, Any]) -> list[str]:
    """Canonical input roles this model declares (both image and text)."""
    return [entry["role"] for entry in model.get("inputs", [])]


def model_image_input_roles(model: dict[str, Any]) -> list[str]:
    """Only the image-type input roles for this model (start_frame, etc.)."""
    return [e["role"] for e in model.get("inputs", []) if e.get("type") == "image"]


def model_input_required(model: dict[str, Any], role: str) -> bool:
    for e in model.get("inputs", []):
        if e.get("role") == role:
            return bool(e.get("required", False))
    return False


def provider_has_input(provider: dict[str, Any], role: str) -> bool:
    return role in provider.get("inputs", {})


def provider_has_param(provider: dict[str, Any], canonical: str) -> bool:
    return canonical in provider.get("params", {})


def model_has_generate_audio(model: dict[str, Any]) -> bool:
    """True if the model declares a `generate_audio` canonical param."""
    return any(p.get("name") == "generate_audio" for p in model.get("params", []))


def canonical_to_wire(
    model: dict[str, Any],
    provider: dict[str, Any],
    canonical: dict[str, Any],
) -> dict[str, Any]:
    """Apply the provider's canonical→wire mapping + optional transform.

    Steps:
      1. Run the provider's `transform` on the canonical dict, if it has
         one (derived fields, value conversions). Transforms may drop
         canonical keys and/or add new wire-level keys; no current provider
         registers one, but the hook stays for future use.
      2. For each remaining key:
           - If it's declared in `provider.inputs` → rename to its wire key.
           - If it's declared in `provider.params` → rename (or drop when
             `wire: None` indicates the transform should have consumed it).
           - If it's a known canonical of this model but *not* declared on
             this provider → silent drop (provider doesn't support it).
           - Else (not a canonical at all) → pass through as a wire key
             (produced by the transform).
    """
    transform: Callable[[dict[str, Any]], dict[str, Any]] | None = provider.get("transform")
    if transform is not None:
        canonical = transform(canonical)

    inputs_map: dict[str, str] = provider.get("inputs", {})
    params_map: dict[str, dict[str, Any]] = provider.get("params", {})

    model_canonicals: set[str] = {
        entry["role"] for entry in model.get("inputs", [])
    } | {
        entry["name"] for entry in model.get("params", [])
    }

    out: dict[str, Any] = {}
    for k, v in canonical.items():
        if k in inputs_map:
            out[inputs_map[k]] = v
        elif k in params_map:
            wire = params_map[k].get("wire")
            if wire is not None:
                out[wire] = v
            # wire=None → consumed by transform; drop defensively
        elif k in model_canonicals:
            # Known canonical for the model but not declared on this provider
            # → silent drop (e.g. pixverse's `aspect_ratio` canonical when
            # running on fal, whose pixverse endpoint doesn't accept it).
            pass
        else:
            # Not a canonical at all — transform-produced wire key, pass through
            out[k] = v
    return out


def _any_provider_wires(model: dict[str, Any], scenario: set[str]) -> bool:
    """True iff at least one of the model's providers declares every image
    role in `scenario` in its `inputs` map. A model whose canonical claims
    to support a scenario but whose only provider(s) don't wire the roles
    is unusable today — surfacing it in the picker would silently drop
    the user's uploaded image at run time."""
    for provider in model.get("providers", {}).values():
        wired = set(provider.get("inputs", {}).keys())
        if scenario.issubset(wired):
            return True
    return False


def get_compatible_model_ids(
    required_keys: set[str],
    optional_keys: set[str] | None = None,
) -> list[str]:
    """Return model IDs whose canonical inputs cover the required image roles
    AND whose at-least-one provider actually wires those roles.

    - `required_keys`: image roles the effect *must* supply.
    - `optional_keys`: image roles the effect *may* supply but doesn't have
      to. When present, a model also qualifies if it can run with the
      optional keys provided.

    The check spans two layers: the model's canonical inputs (author
    contract) and each provider's `inputs` map (wire layer). A model with
    a matching canonical but no provider that wires the scenario is
    excluded — e.g. pixverse-v6's canonical declares `end_frame`, but its
    only provider (fal) doesn't wire it, so pixverse-v6 is NOT compatible
    with effects that supply end_frame.
    """
    optional_keys = optional_keys or set()
    scenarios: list[set[str]] = [set(required_keys)]
    if optional_keys:
        scenarios.append(set(required_keys) | optional_keys)

    result: list[str] = []
    for model in MODELS:
        supported = set(model_image_input_roles(model))
        start_required = model_input_required(model, "start_frame")
        end_required = model_input_required(model, "end_frame")

        for scenario in scenarios:
            has_start = "start_frame" in scenario
            has_end = "end_frame" in scenario
            if not (has_start or has_end):
                ok = not start_required and not end_required
            elif has_start and has_end:
                ok = "end_frame" in supported
            else:
                ok = "start_frame" in supported and not end_required
            if ok and _any_provider_wires(model, scenario):
                result.append(model["id"])
                break
    return result


def model_supported_image_keys(model: dict[str, Any]) -> list[str]:
    """Canonical image-input roles this model declares."""
    return sorted(model_image_input_roles(model))


# ─── Client-facing payload ───────────────────────────────────────────────────


def _client_params_for(model: dict[str, Any], provider: dict[str, Any]) -> list[dict[str, Any]]:
    """Build the param list the client renders for this (model, provider).

    The client consumes canonical names. A param is included if:
      - `type == "image"` (image input slot from model.inputs), OR
      - It's a declared `model.params` entry with `ui` in (main, advanced).

    User-only params are included so the UI can render them as runtime
    controls (the effect-page and playground renderers decide how).
    `effect_hidden` stays on the param so the client knows whether to
    show it in the effect form.

    Per-provider overrides: any key on `provider.params[name]` other than
    `wire` overlays the canonical entry — useful when the same canonical
    has different UI constraints per provider (tighter `max`, different
    `default`, restricted `options`, …). `wire` is wire-layer only and
    never leaks to the client.

    Params the provider doesn't declare are dropped.
    """
    out: list[dict[str, Any]] = []

    # 1) Image inputs (from model.inputs, filtered by provider support).
    for entry in model.get("inputs", []):
        if entry.get("type") != "image":
            continue
        role = entry["role"]
        if not provider_has_input(provider, role):
            continue
        out.append({
            "key": role,                      # canonical name
            "role": role,                     # kept for client-side role lookup
            "type": "image",
            "required": bool(entry.get("required", False)),
        })

    # 2) Tunable params (from model.params, filtered by provider support).
    provider_params = provider.get("params", {})
    for entry in model.get("params", []):
        name = entry["name"]
        provider_entry = provider_params.get(name)
        if provider_entry is None:
            continue
        if entry.get("ui") not in ("main", "advanced"):
            continue
        pp = dict(entry)
        for k, v in provider_entry.items():
            if k == "wire":
                continue
            pp[k] = v
        pp["key"] = name
        pp.pop("name", None)
        out.append(pp)

    return out


class ModelService:
    def __init__(self, models_dir: Path):
        self._models_dir = models_dir

    @property
    def models_dir(self) -> Path:
        """Directory where local-provider model weights live. Public so
        callers (e.g. RunService) don't have to reach into `_models_dir`."""
        return self._models_dir

    def get_available_models(self, api_key: str | None = None) -> list[dict[str, Any]]:
        models = []
        for model in MODELS:
            m = {k: v for k, v in model.items() if k not in ("providers", "inputs", "params")}

            providers_out = []
            for provider_id, provider in model.get("providers", {}).items():
                identity = PROVIDERS.get(provider_id, {})
                provider_type = identity.get("type", "cloud")
                p = {
                    "id": provider_id,
                    "name": identity.get("name", provider_id),
                    "type": provider_type,
                    # Params land under `variants.image_to_video` — the
                    # client reads from that path. Keeping the nesting
                    # leaves room to add sibling variants (e.g. a future
                    # `video_to_video`) without reshaping this response.
                    "variants": {
                        "image_to_video": {
                            "params": _client_params_for(model, provider),
                            "cost": provider.get("cost", ""),
                        },
                    },
                    "is_available": bool(api_key) if provider_type == "cloud" else False,
                }
                providers_out.append(p)
            m["providers"] = providers_out

            models.append(m)
        return models
