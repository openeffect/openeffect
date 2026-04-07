import asyncio
import uuid
import logging
from pathlib import Path
from typing import Any, AsyncIterator, Callable

logger = logging.getLogger(__name__)


# ─── Model Registry ──────────────────────────────────────────────────────────
# supports_end_frame: "none" | "optional" | "required"
#
# Each model has a single `params` list. Every entry has a `ui`:
#   - "main"     → rendered in the main form
#   - "advanced" → rendered in the collapsed Advanced section
#   - "none"     → not rendered at all (headless knob settable from manifest)
#
# An optional `transform_params` callable on a model turns user-facing params
# into the model-native shape (e.g. WAN 2.2 wants num_frames, not duration in
# seconds). Transforms are arbitrary Python — no declarative mini-DSL.


def _wan22_transform(params: dict[str, Any]) -> dict[str, Any]:
    """WAN 2.2 wants num_frames (seconds × fps) instead of duration (seconds)."""
    out = dict(params)
    if "duration" in out:
        fps = 16
        seconds = int(out.pop("duration"))
        out["num_frames"] = seconds * fps
        out["fps"] = fps
    return out


MODELS: list[dict[str, Any]] = [
    # ── WAN ──────────────────────────────────────────────────────────────
    {
        "id": "wan-2.2",
        "name": "WAN 2.2",
        "group": "WAN",
        "description": "Affordable, good for quick iterations",
        "supports_start_frame": True,
        "supports_end_frame": "optional",
        "supports_audio": False,
        "providers": [
            {"id": "fal", "name": "fal.ai", "type": "cloud", "cost": "~$0.08/sec"},
        ],
        "fal": {
            "i2v_endpoint": "fal-ai/wan/v2.2-a14b/image-to-video",
            "t2v_endpoint": "fal-ai/wan/v2.2-a14b/text-to-video",
            "role_params": {"start_frame": "image_url", "end_frame": "end_image_url"},
        },
        "params": [
            {"key": "aspect_ratio", "ui": "main", "type": "select", "label": "Aspect Ratio", "default": "auto",
             "options": [{"value": "auto", "label": "Auto"}, {"value": "16:9", "label": "16:9"}, {"value": "9:16", "label": "9:16"}]},
            {"key": "duration", "ui": "main", "type": "slider", "label": "Duration (seconds)",
             "default": 5, "min": 1, "max": 10, "step": 1},
            {"key": "resolution", "ui": "main", "type": "select", "label": "Resolution", "default": "720p",
             "options": [{"value": "480p", "label": "480p"}, {"value": "720p", "label": "720p"}]},
            {"key": "cfg_scale", "ui": "advanced", "type": "slider", "label": "CFG scale",
             "default": 3.5, "min": 1.0, "max": 10.0, "step": 0.5, "hint": "Higher = closer to prompt"},
            {"key": "num_inference_steps", "ui": "advanced", "type": "slider", "label": "Quality steps",
             "default": 27, "min": 10, "max": 50, "step": 1, "hint": "More = better but slower"},
            {"key": "seed", "ui": "advanced", "type": "number", "label": "Seed", "default": -1, "hint": "-1 = random"},
            {"key": "negative_prompt", "ui": "none", "type": "text"},
        ],
        "transform_params": _wan22_transform,
    },
    {
        "id": "wan-2.6",
        "name": "WAN 2.6",
        "group": "WAN",
        "description": "Longer videos up to 15s, 1080p quality",
        "supports_start_frame": True,
        "supports_end_frame": "none",
        "supports_audio": False,
        "providers": [
            {"id": "fal", "name": "fal.ai", "type": "cloud", "cost": "~$0.10/sec"},
        ],
        "fal": {
            "i2v_endpoint": "wan/v2.6/image-to-video",
            "t2v_endpoint": "wan/v2.6/image-to-video",
            "role_params": {"start_frame": "image_url"},
        },
        "params": [
            {"key": "aspect_ratio", "ui": "main", "type": "select", "label": "Aspect Ratio", "default": "16:9",
             "options": [{"value": "16:9", "label": "16:9"}, {"value": "9:16", "label": "9:16"}, {"value": "1:1", "label": "1:1"}, {"value": "4:3", "label": "4:3"}, {"value": "3:4", "label": "3:4"}]},
            {"key": "duration", "ui": "main", "type": "select", "label": "Duration", "default": "5",
             "options": [{"value": "5", "label": "5s"}, {"value": "10", "label": "10s"}, {"value": "15", "label": "15s"}]},
            {"key": "resolution", "ui": "main", "type": "select", "label": "Resolution", "default": "720p",
             "options": [{"value": "720p", "label": "720p"}, {"value": "1080p", "label": "1080p"}]},
            {"key": "seed", "ui": "advanced", "type": "number", "label": "Seed", "default": -1, "hint": "-1 = random"},
            {"key": "negative_prompt", "ui": "none", "type": "text"},
        ],
    },
    # ── Kling 2.5 ────────────────────────────────────────────────────────
    {
        "id": "kling-2.5",
        "name": "Kling 2.5 Turbo",
        "group": "Kling",
        "description": "Fast and affordable",
        "supports_start_frame": True,
        "supports_end_frame": "optional",
        "supports_audio": False,
        "providers": [
            {"id": "fal", "name": "fal.ai", "type": "cloud", "cost": "~$0.07/sec"},
        ],
        "fal": {
            "i2v_endpoint": "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
            "t2v_endpoint": "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
            "role_params": {"start_frame": "image_url", "end_frame": "tail_image_url"},
        },
        "params": [
            {"key": "aspect_ratio", "ui": "main", "type": "select", "label": "Aspect Ratio", "default": "9:16",
             "options": [{"value": "9:16", "label": "9:16"}, {"value": "16:9", "label": "16:9"}, {"value": "1:1", "label": "1:1"}]},
            {"key": "duration", "ui": "main", "type": "select", "label": "Duration", "default": "5",
             "options": [{"value": "5", "label": "5s"}, {"value": "10", "label": "10s"}]},
            {"key": "cfg_scale", "ui": "advanced", "type": "slider", "label": "CFG scale",
             "default": 0.5, "min": 0.0, "max": 1.0, "step": 0.1, "hint": "0-1 range"},
            {"key": "negative_prompt", "ui": "none", "type": "text"},
        ],
    },
    # ── Kling 3.0 V3 ────────────────────────────────────────────────────
    {
        "id": "kling-v3",
        "name": "Kling 3.0 V3",
        "group": "Kling",
        "description": "Best for cinematic shots, supports AI audio",
        "supports_start_frame": True,
        "supports_end_frame": "none",
        "supports_audio": True,
        "audio_param_key": "generate_audio",
        "providers": [
            {"id": "fal", "name": "fal.ai (Standard)", "type": "cloud", "cost": "~$0.08/sec"},
        ],
        "fal": {
            "i2v_endpoint": "fal-ai/kling-video/v3/standard/image-to-video",
            "t2v_endpoint": "fal-ai/kling-video/v3/standard/text-to-video",
            "role_params": {"start_frame": "start_image_url"},
        },
        "params": [
            {"key": "duration", "ui": "main", "type": "slider", "label": "Duration (seconds)",
             "default": 5, "min": 3, "max": 15, "step": 1},
            {"key": "cfg_scale", "ui": "advanced", "type": "slider", "label": "CFG scale",
             "default": 0.5, "min": 0.0, "max": 1.0, "step": 0.1},
            {"key": "negative_prompt", "ui": "none", "type": "text"},
            {"key": "generate_audio", "ui": "none", "type": "boolean"},
        ],
    },
    # ── Kling 3.0 O3 ────────────────────────────────────────────────────
    {
        "id": "kling-o3",
        "name": "Kling 3.0 O3",
        "group": "Kling",
        "description": "Best quality, supports AI audio",
        "supports_start_frame": True,
        "supports_end_frame": "optional",
        "supports_audio": True,
        "audio_param_key": "generate_audio",
        "providers": [
            {"id": "fal", "name": "fal.ai (Standard)", "type": "cloud", "cost": "~$0.08/sec"},
        ],
        "fal": {
            "i2v_endpoint": "fal-ai/kling-video/o3/standard/image-to-video",
            "t2v_endpoint": "fal-ai/kling-video/o3/standard/image-to-video",
            "role_params": {"start_frame": "image_url", "end_frame": "end_image_url"},
        },
        "params": [
            {"key": "duration", "ui": "main", "type": "slider", "label": "Duration (seconds)",
             "default": 10, "min": 3, "max": 15, "step": 1},
            {"key": "cfg_scale", "ui": "advanced", "type": "slider", "label": "CFG scale",
             "default": 0.5, "min": 0.0, "max": 1.0, "step": 0.1},
            {"key": "generate_audio", "ui": "none", "type": "boolean"},
        ],
    },
    # ── PixVerse V6 ───────────────────────────────────────────────────
    {
        "id": "pixverse-v6",
        "name": "PixVerse V6",
        "group": "PixVerse",
        "description": "Creative styles, AI audio, up to 15s",
        "supports_start_frame": True,
        "supports_end_frame": "none",
        "supports_audio": True,
        "audio_param_key": "generate_audio_switch",
        "providers": [
            {"id": "fal", "name": "fal.ai", "type": "cloud", "cost": "~$0.05/sec"},
        ],
        "fal": {
            "i2v_endpoint": "fal-ai/pixverse/v6/image-to-video",
            "t2v_endpoint": "fal-ai/pixverse/v6/image-to-video",
            "role_params": {"start_frame": "image_url"},
        },
        "params": [
            {"key": "resolution", "ui": "main", "type": "select", "label": "Resolution", "default": "720p",
             "options": [{"value": "360p", "label": "360p"}, {"value": "540p", "label": "540p"}, {"value": "720p", "label": "720p"}, {"value": "1080p", "label": "1080p"}]},
            {"key": "duration", "ui": "main", "type": "slider", "label": "Duration (seconds)",
             "default": 5, "min": 1, "max": 15, "step": 1},
            {"key": "style", "ui": "main", "type": "select", "label": "Style", "default": "",
             "options": [{"value": "", "label": "None"}, {"value": "anime", "label": "Anime"}, {"value": "3d_animation", "label": "3D Animation"}, {"value": "clay", "label": "Clay"}, {"value": "comic", "label": "Comic"}, {"value": "cyberpunk", "label": "Cyberpunk"}]},
            {"key": "seed", "ui": "advanced", "type": "number", "label": "Seed", "default": -1, "hint": "-1 = random"},
            {"key": "negative_prompt", "ui": "none", "type": "text"},
            {"key": "generate_audio_switch", "ui": "none", "type": "boolean"},
            {"key": "generate_multi_clip_switch", "ui": "none", "type": "boolean"},
            {"key": "thinking_type", "ui": "none", "type": "text"},
        ],
    },
]

# Build lookup dicts
MODELS_BY_ID: dict[str, dict[str, Any]] = {m["id"]: m for m in MODELS}


def get_fal_config(model_id: str) -> dict[str, Any] | None:
    """Get the fal.ai endpoint config for a model."""
    model = MODELS_BY_ID.get(model_id)
    return model.get("fal") if model else None


def get_model_params(model_id: str) -> list[dict[str, Any]]:
    """Returns the consolidated params list for a model, or empty if unknown."""
    model = MODELS_BY_ID.get(model_id)
    return list(model.get("params", [])) if model else []


def get_model_transform(model_id: str) -> Callable[[dict[str, Any]], dict[str, Any]] | None:
    """Returns the model's params transform callable, if defined."""
    model = MODELS_BY_ID.get(model_id)
    return model.get("transform_params") if model else None


def get_compatible_model_ids(input_roles: set[str]) -> list[str]:
    """Return model IDs compatible with the given input roles."""
    has_start = "start_frame" in input_roles
    has_end = "end_frame" in input_roles
    has_any_image = has_start or has_end

    result = []
    for model in MODELS:
        if not has_any_image:
            # Text-only: all models work
            result.append(model["id"])
        elif has_start and has_end:
            # Both frames: need end_frame support ("optional" or "required")
            if model["supports_end_frame"] in ("optional", "required"):
                result.append(model["id"])
        elif has_start:
            # Start only: any model that supports start_frame, skip those requiring end_frame
            if model["supports_start_frame"] and model["supports_end_frame"] != "required":
                result.append(model["id"])
        elif has_end:
            # End only: we swap to start_frame + reverse, so need start_frame support
            if model["supports_start_frame"] and model["supports_end_frame"] != "required":
                result.append(model["id"])

    return result


def _params_for_ui(model: dict[str, Any], ui_value: str) -> list[dict[str, Any]]:
    """Filter a model's params by ui placement and strip the ui field."""
    out = []
    for p in model.get("params", []):
        if p.get("ui") != ui_value:
            continue
        clean = {k: v for k, v in p.items() if k != "ui"}
        out.append(clean)
    return out


class ModelService:
    def __init__(self, models_dir: Path):
        self._models_dir = models_dir

    def get_available_models(self, api_key: str | None = None) -> list[dict[str, Any]]:
        models = []
        for model in MODELS:
            m = {k: v for k, v in model.items() if k not in ("fal", "params", "transform_params")}
            # Surface image roles supported by the provider so the playground UI
            # can render uploaders without knowing about fal internals.
            fal_cfg = model.get("fal") or {}
            m["supported_image_roles"] = list((fal_cfg.get("role_params") or {}).keys())
            # Derive the per-ui param lists. `ui: "none"` entries are not
            # exposed to the client — they're declared for routing/merging only.
            m["output_params"] = _params_for_ui(model, "main")
            m["advanced_params"] = _params_for_ui(model, "advanced")
            providers = []
            for provider in model["providers"]:
                p = dict(provider)
                if provider["type"] == "cloud":
                    p["is_available"] = bool(api_key)
                else:
                    p["is_available"] = False
                providers.append(p)
            m["providers"] = providers
            models.append(m)
        return models
