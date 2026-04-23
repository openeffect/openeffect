import logging
from collections.abc import Iterator
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


# ─── Wire boundary ───────────────────────────────────────────────────────────
#
# This module owns all provider-specific wire concerns (endpoint URLs, wire
# param keys, wire-format transforms). Nothing outside this module should
# encode provider-specific details — effects bind by canonical `key`, clients
# consume the filtered `params` payload, and the rest is opaque.
#
# ─── Registry shape ──────────────────────────────────────────────────────────
#
# Each model declares a set of providers that host it. The `variants` layer
# inside each provider is preserved even though only `image_to_video` is
# populated today — it's a cheap, stable surface for additive modes later
# (e.g. `video_to_video`). A provider-variant owns everything needed to
# render the form AND call the wire API: the full `params` list (UI +
# headless), the `endpoint` URL, and an optional `transform_params` callable.
#
# Each param entry:
#   - `key`       — the provider's wire name (what goes on the API call).
#                   For most knobs this is all you need.
#   - `role`      — optional. Marks the param as carrying a canonical,
#                   cross-provider role that effects and the client bind to
#                   (e.g. `role: start_frame`, `role: end_frame`, `role: generate_audio`).
#                   Matches the `role` field on effect manifest inputs.
#                   When absent, the param is a plain wire knob with no
#                   role identity. When present, canonical == `role` and
#                   wire == `key` — the provider layer renames canonical→wire
#                   before calling the API. Always explicit: even when the
#                   wire name equals the canonical role, write both (e.g.
#                   `{"key": "start_frame", "role": "start_frame"}`).
#   - `type`      — image | select | slider | number | text | boolean.
#   - `required`  — for `type: image`, whether the user must supply it.
#   - `ui`        — main | advanced | none. Scalars only. Image-type and
#                   `role == "generate_audio"` always show regardless.
#   - `label`, `default`, `options`, `min`/`max`/`step`, `hint`, `multiline`
#                 — render metadata for the form.
#
# The AI-audio toggle is identified by the reserved canonical role
# `generate_audio` (`role: generate_audio`). Clients render a checkbox;
# providers write through via the param's wire `key`.
#
# Provider-variant:
#   - `endpoint`         — wire URL / identifier.
#   - `cost`             — pricing string copied from the provider's page.
#   - `transform_params` — callable that munges the canonical dict into wire
#                          values (int↔string enums, derived keys like
#                          num_frames = duration × fps). Runs before the
#                          canonical→wire key rename.
#   - `params`           — the full list (see above).


def _wan22_image_to_video_transform(params: dict[str, Any]) -> dict[str, Any]:
    """WAN 2.2 image-to-video wants num_frames (seconds × fps)."""
    out = dict(params)
    if "duration" in out:
        fps = 16
        seconds = int(out.pop("duration"))
        out["num_frames"] = seconds * fps
        out["frames_per_second"] = fps
    return out


# ─── Providers ───────────────────────────────────────────────────────────────
#
# Provider identity (display name, type) lives here so each model only needs
# to declare the provider-specific bits (cost, variants). The ModelService
# merges these when serving the client payload.
PROVIDERS: dict[str, dict[str, Any]] = {
    "fal": {
        "name": "fal.ai",
        "type": "cloud",
    },
}


MODELS: list[dict[str, Any]] = [
    # ── WAN 2.2 ───────────────────────────────────────────────────────────
    {
        "id": "wan-2.2",
        "name": "WAN 2.2",
        "group": "WAN",
        "description": "Affordable, good for quick iterations",
        "providers": {
            "fal": {
                "variants": {
                    "image_to_video": {
                        "endpoint": "fal-ai/wan/v2.2-a14b/image-to-video",
                        "cost": "$0.04–$0.08 per second (by resolution)",
                        "transform_params": _wan22_image_to_video_transform,
                        "params": [
                            {"key": "image_url",     "role": "start_frame", "type": "image", "required": True},
                            {"key": "end_image_url", "role": "end_frame",   "type": "image"},
                            {"key": "aspect_ratio", "ui": "main", "type": "select", "label": "Aspect Ratio", "default": "auto",
                             "options": [{"value": "auto", "label": "Auto"}, {"value": "16:9", "label": "16:9"}, {"value": "9:16", "label": "9:16"}, {"value": "1:1", "label": "1:1"}]},
                            {"key": "duration", "ui": "main", "type": "slider", "label": "Duration (seconds)",
                             "default": 5, "min": 1, "max": 16, "step": 1},
                            {"key": "resolution", "ui": "main", "type": "select", "label": "Resolution", "default": "720p",
                             "options": [{"value": "480p", "label": "480p"}, {"value": "580p", "label": "580p"}, {"value": "720p", "label": "720p"}]},
                            {"key": "guidance_scale", "ui": "advanced", "type": "slider", "label": "Guidance scale",
                             "default": 3.5, "min": 1.0, "max": 10.0, "step": 0.5, "hint": "Higher = closer to prompt"},
                            {"key": "num_inference_steps", "ui": "advanced", "type": "slider", "label": "Quality steps",
                             "default": 27, "min": 1, "max": 50, "step": 1, "hint": "More = better but slower"},
                            {"key": "seed", "ui": "advanced", "type": "number", "label": "Seed", "default": -1, "hint": "-1 = random"},
                            # Headless
                            {"key": "negative_prompt", "ui": "none", "type": "text"},
                            {"key": "num_frames", "ui": "none", "type": "number"},
                            {"key": "frames_per_second", "ui": "none", "type": "number"},
                            {"key": "guidance_scale_2", "ui": "none", "type": "number"},
                            {"key": "shift", "ui": "none", "type": "number"},
                            {"key": "acceleration", "ui": "none", "type": "text"},
                            {"key": "interpolator_model", "ui": "none", "type": "text"},
                            {"key": "num_interpolated_frames", "ui": "none", "type": "number"},
                            {"key": "adjust_fps_for_interpolation", "ui": "none", "type": "boolean"},
                            {"key": "video_quality", "ui": "none", "type": "text"},
                            {"key": "video_write_mode", "ui": "none", "type": "text"},
                            {"key": "enable_safety_checker", "ui": "none", "type": "boolean"},
                            {"key": "enable_output_safety_checker", "ui": "none", "type": "boolean"},
                            {"key": "enable_prompt_expansion", "ui": "none", "type": "boolean"},
                        ],
                    },
                },
            },
        },
    },
    # ── Kling 3.0 V3 ──────────────────────────────────────────────────────
    {
        "id": "kling-v3",
        "name": "Kling 3.0 V3",
        "group": "Kling",
        "description": "Best for cinematic shots, supports AI audio",
        "providers": {
            "fal": {
                "variants": {
                    "image_to_video": {
                        "endpoint": "fal-ai/kling-video/v3/standard/image-to-video",
                        "cost": "$0.084 per second (audio off), $0.126 with audio",
                        "params": [
                            {"key": "start_image_url", "role": "start_frame", "type": "image", "required": True},
                            {"key": "end_image_url",   "role": "end_frame",   "type": "image"},
                            {"key": "duration", "ui": "main", "type": "slider", "label": "Duration (seconds)",
                             "default": 5, "min": 3, "max": 15, "step": 1},
                            {"key": "cfg_scale", "ui": "advanced", "type": "slider", "label": "CFG scale",
                             "default": 0.5, "min": 0.0, "max": 1.0, "step": 0.1},
                            {"key": "generate_audio", "role": "generate_audio", "type": "boolean", "ui": "none"},
                            {"key": "negative_prompt", "ui": "none", "type": "text"},
                            {"key": "shot_type", "ui": "none", "type": "text"},
                            {"key": "elements", "ui": "none", "type": "text"},
                        ],
                    },
                },
            },
        },
    },
    # ── PixVerse V6 ───────────────────────────────────────────────────────
    {
        "id": "pixverse-v6",
        "name": "PixVerse V6",
        "group": "PixVerse",
        "description": "Creative styles, AI audio, up to 15s",
        "providers": {
            "fal": {
                "variants": {
                    "image_to_video": {
                        "endpoint": "fal-ai/pixverse/v6/image-to-video",
                        "cost": "$0.025–$0.115 per second (by resolution / audio)",
                        "params": [
                            {"key": "image_url", "role": "start_frame", "type": "image", "required": True},
                            {"key": "resolution", "ui": "main", "type": "select", "label": "Resolution", "default": "720p",
                             "options": [{"value": "360p", "label": "360p"}, {"value": "540p", "label": "540p"}, {"value": "720p", "label": "720p"}, {"value": "1080p", "label": "1080p"}]},
                            {"key": "duration", "ui": "main", "type": "slider", "label": "Duration (seconds)",
                             "default": 5, "min": 1, "max": 15, "step": 1},
                            {"key": "style", "ui": "main", "type": "select", "label": "Style", "default": "",
                             "options": [{"value": "", "label": "None"}, {"value": "anime", "label": "Anime"}, {"value": "3d_animation", "label": "3D Animation"}, {"value": "clay", "label": "Clay"}, {"value": "comic", "label": "Comic"}, {"value": "cyberpunk", "label": "Cyberpunk"}]},
                            {"key": "generate_audio_switch", "role": "generate_audio", "type": "boolean", "ui": "none"},
                            {"key": "generate_multi_clip_switch", "ui": "none", "type": "boolean"},
                            {"key": "negative_prompt", "ui": "none", "type": "text"},
                            {"key": "seed", "ui": "advanced", "type": "number", "label": "Seed", "default": -1, "hint": "-1 = random"},
                            {"key": "thinking_type", "ui": "none", "type": "text"},
                        ],
                    },
                },
            },
        },
    },
]

# Build lookup dicts
MODELS_BY_ID: dict[str, dict[str, Any]] = {m["id"]: m for m in MODELS}


# ─── Helpers ─────────────────────────────────────────────────────────────────


def get_provider_variant(
    model_id: str, variant_key: str, provider_id: str,
) -> dict[str, Any] | None:
    """Returns the per-provider wire config for a (model, variant, provider)
    triple: `{endpoint, transform_params?, params}`, or None if any of the
    three is unknown."""
    model = MODELS_BY_ID.get(model_id)
    if not model:
        return None
    provider = model.get("providers", {}).get(provider_id)
    if not provider:
        return None
    return provider.get("variants", {}).get(variant_key)


def get_provider_variant_params(
    model_id: str, variant_key: str, provider_id: str,
) -> list[dict[str, Any]]:
    """Returns the params list for a (model, variant, provider), or empty."""
    pv = get_provider_variant(model_id, variant_key, provider_id)
    return list(pv.get("params", [])) if pv else []


def model_variant_keys(model: dict[str, Any]) -> set[str]:
    """Union of variant names across all providers of a model. Returns
    `{"image_to_video"}` today; kept for forward-compat when additional
    modes (e.g. `video_to_video`) land."""
    keys: set[str] = set()
    for provider in model.get("providers", {}).values():
        keys.update(provider.get("variants", {}).keys())
    return keys


def _provider_variants(model: dict[str, Any]) -> Iterator[tuple[str, dict[str, Any]]]:
    """Yield (variant_key, provider_variant_dict) across all providers."""
    for provider in model.get("providers", {}).values():
        yield from provider.get("variants", {}).items()


def canonical_key(param: dict[str, Any]) -> str:
    """The canonical role name for a param, or its wire key if it carries
    no role. `role` always wins when present; otherwise `key` is both the
    wire name AND the (non-role) identifier."""
    return param.get("role", param["key"])


def get_image_inputs(variant: dict[str, Any]) -> list[dict[str, Any]]:
    """Return params of `type: image` for a provider-variant."""
    return [p for p in variant.get("params", []) if p.get("type") == "image"]


def variant_has_image_key(variant: dict[str, Any], role: str) -> bool:
    """True if the provider-variant has an image-type param tagged with the given canonical role."""
    return any(
        p.get("type") == "image" and canonical_key(p) == role
        for p in variant.get("params", [])
    )


def variant_image_key_required(variant: dict[str, Any], role: str) -> bool:
    for p in variant.get("params", []):
        if p.get("type") == "image" and canonical_key(p) == role:
            return bool(p.get("required", False))
    return False


def _variant_supports_image_keys(variant: dict[str, Any], input_keys: set[str]) -> bool:
    """Whether a provider-variant satisfies the given input image keys.

    Rules:
      - start+end       → compatible if variant supports end_frame.
      - start only      → compatible if variant supports start_frame and
                          does not require end_frame.
      - end only        → same as start-only (end-only is treated like
                          start-only after `reverse:` flips the video).
      - no inputs       → compatible only if the variant requires neither
                          frame. With the current i2v-only registry every
                          variant requires start_frame, so this branch
                          evaluates to False — and the effect validator
                          enforces start_frame's presence anyway.
    """
    has_start = "start_frame" in input_keys
    has_end = "end_frame" in input_keys
    supports_start = variant_has_image_key(variant, "start_frame")
    supports_end = variant_has_image_key(variant, "end_frame")
    start_required = variant_image_key_required(variant, "start_frame")
    end_required = variant_image_key_required(variant, "end_frame")

    if not (has_start or has_end):
        return not start_required and not end_required
    if has_start and has_end:
        return supports_end
    # start-only or end-only
    return supports_start and not end_required


def model_supported_image_keys(model: dict[str, Any]) -> list[str]:
    """Union of image-input canonical roles across every provider-variant."""
    keys: set[str] = set()
    for _, variant in _provider_variants(model):
        for p in get_image_inputs(variant):
            keys.add(canonical_key(p))
    return sorted(keys)


def model_has_generate_audio(model: dict[str, Any]) -> bool:
    """True if any provider-variant exposes the canonical `generate_audio` toggle."""
    for _, variant in _provider_variants(model):
        for p in variant.get("params", []):
            if canonical_key(p) == "generate_audio":
                return True
    return False


def canonical_to_wire(
    params: list[dict[str, Any]], canonical: dict[str, Any],
) -> dict[str, Any]:
    """Rename canonical role names to wire keys using each param's `role` field.
    Entries whose incoming key isn't a canonical role pass through unchanged
    (their name is already the wire name)."""
    rename = {p["role"]: p["key"] for p in params if "role" in p}
    return {rename.get(k, k): v for k, v in canonical.items()}


def pick_variant(model_id: str, image_keys: set[str] | frozenset[str] | None) -> str | None:
    """Choose the variant key for the given inputs.

    With only `image_to_video` available today, this returns
    `"image_to_video"` for any model that has it. `image_keys` is kept in
    the signature (and unused) to avoid churn at call sites — it matters
    again when a second variant lands (e.g. `video_to_video`).
    """
    model = MODELS_BY_ID.get(model_id)
    if not model:
        return None
    variants = model_variant_keys(model)
    if "image_to_video" in variants:
        return "image_to_video"
    return None


def get_compatible_model_ids(
    required_keys: set[str],
    optional_keys: set[str] | None = None,
) -> list[str]:
    """Return model IDs compatible with the given input image keys.

    - `required_keys`: image roles the effect *must* supply.
    - `optional_keys`: image roles the effect *may* supply but doesn't have
      to. When present, a model also qualifies as compatible if it can run
      with the optional keys provided (not just without them).

    A model is compatible if **any** of its provider-variants can satisfy at
    least one of the viable input scenarios (required alone, or required +
    optional). Per-provider gating stays deferred.
    """
    optional_keys = optional_keys or set()
    scenarios: list[set[str]] = [set(required_keys)]
    if optional_keys:
        scenarios.append(set(required_keys) | optional_keys)

    result: list[str] = []
    for model in MODELS:
        for _, variant in _provider_variants(model):
            if any(_variant_supports_image_keys(variant, keys) for keys in scenarios):
                result.append(model["id"])
                break
    return result


def _client_visible_params(variant: dict[str, Any]) -> list[dict[str, Any]]:
    """Filter a provider-variant's params down to what the client needs.

    Rule: include if `type == "image"` (upload slot), OR its `ui` placement
    is main/advanced, OR its canonical role is `generate_audio` (reserved
    role for the AI-audio toggle). Pure pass-through scalars (`ui: "none"`
    with no special meaning) are hidden.

    The output uses the canonical name as `key` (the wire name stays
    server-side) — the client always operates in the canonical space.
    """
    out: list[dict[str, Any]] = []
    for p in variant.get("params", []):
        role = canonical_key(p)
        if (
            p.get("type") == "image"
            or p.get("ui") in ("main", "advanced")
            or role == "generate_audio"
        ):
            pp = dict(p)
            pp["key"] = role
            pp.pop("role", None)
            out.append(pp)
    return out


class ModelService:
    def __init__(self, models_dir: Path):
        self._models_dir = models_dir

    def get_available_models(self, api_key: str | None = None) -> list[dict[str, Any]]:
        models = []
        for model in MODELS:
            m = {k: v for k, v in model.items() if k != "providers"}

            # Nest variants under each provider so the client can look up
            # params by (provider, variant). Each provider-variant exposes
            # its client-visible params + `cost` — endpoint/transform stay
            # server-side. Provider identity (name/type) comes from the
            # top-level PROVIDERS registry.
            providers_out = []
            for provider_id, provider in model.get("providers", {}).items():
                identity = PROVIDERS.get(provider_id, {})
                variants_out: dict[str, Any] = {}
                for vkey, pvariant in provider.get("variants", {}).items():
                    v_out: dict[str, Any] = {
                        "params": _client_visible_params(pvariant),
                    }
                    if "cost" in pvariant:
                        v_out["cost"] = pvariant["cost"]
                    variants_out[vkey] = v_out
                provider_type = identity.get("type", "cloud")
                p = {
                    "id": provider_id,
                    "name": identity.get("name", provider_id),
                    "type": provider_type,
                    "variants": variants_out,
                    "is_available": bool(api_key) if provider_type == "cloud" else False,
                }
                providers_out.append(p)
            m["providers"] = providers_out

            models.append(m)
        return models
