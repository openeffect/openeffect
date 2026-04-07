import asyncio
import uuid
import logging
from pathlib import Path
from typing import Any, AsyncIterator

logger = logging.getLogger(__name__)


# ─── Model Registry ──────────────────────────────────────────────────────────
# supports_end_frame: "none" | "optional" | "required"

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
            "output_translation": {"aspect_ratio": "passthrough", "duration": "num_frames"},
            "fps": 16,
        },
        "output_params": [
            {"key": "aspect_ratio", "label": "Aspect Ratio", "type": "select", "default": "auto",
             "options": [{"value": "auto", "label": "Auto"}, {"value": "16:9", "label": "16:9"}, {"value": "9:16", "label": "9:16"}]},
            {"key": "duration", "label": "Duration (seconds)", "type": "slider", "default": 5, "min": 1, "max": 10, "step": 1},
            {"key": "resolution", "label": "Resolution", "type": "select", "default": "720p",
             "options": [{"value": "480p", "label": "480p"}, {"value": "720p", "label": "720p"}]},
        ],
        "advanced_params": [
            {"key": "cfg_scale", "label": "CFG scale", "type": "slider", "default": 3.5, "min": 1.0, "max": 10.0, "step": 0.5, "hint": "Higher = closer to prompt"},
            {"key": "num_inference_steps", "label": "Quality steps", "type": "slider", "default": 27, "min": 10, "max": 50, "step": 1, "hint": "More = better but slower"},
            {"key": "seed", "label": "Seed", "type": "number", "default": -1, "hint": "-1 = random"},
        ],
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
            "output_translation": {"aspect_ratio": "passthrough", "duration": "passthrough"},
        },
        "output_params": [
            {"key": "aspect_ratio", "label": "Aspect Ratio", "type": "select", "default": "16:9",
             "options": [{"value": "16:9", "label": "16:9"}, {"value": "9:16", "label": "9:16"}, {"value": "1:1", "label": "1:1"}, {"value": "4:3", "label": "4:3"}, {"value": "3:4", "label": "3:4"}]},
            {"key": "duration", "label": "Duration", "type": "select", "default": "5",
             "options": [{"value": "5", "label": "5s"}, {"value": "10", "label": "10s"}, {"value": "15", "label": "15s"}]},
            {"key": "resolution", "label": "Resolution", "type": "select", "default": "720p",
             "options": [{"value": "720p", "label": "720p"}, {"value": "1080p", "label": "1080p"}]},
        ],
        "advanced_params": [
            {"key": "seed", "label": "Seed", "type": "number", "default": -1, "hint": "-1 = random"},
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
            "output_translation": {"aspect_ratio": "passthrough", "duration": "passthrough"},
        },
        "output_params": [
            {"key": "aspect_ratio", "label": "Aspect Ratio", "type": "select", "default": "9:16",
             "options": [{"value": "9:16", "label": "9:16"}, {"value": "16:9", "label": "16:9"}, {"value": "1:1", "label": "1:1"}]},
            {"key": "duration", "label": "Duration", "type": "select", "default": "5",
             "options": [{"value": "5", "label": "5s"}, {"value": "10", "label": "10s"}]},
        ],
        "advanced_params": [
            {"key": "cfg_scale", "label": "CFG scale", "type": "slider", "default": 0.5, "min": 0.0, "max": 1.0, "step": 0.1, "hint": "0-1 range"},
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
            "output_translation": {"duration": "passthrough"},
        },
        "output_params": [
            {"key": "duration", "label": "Duration (seconds)", "type": "slider", "default": 5, "min": 3, "max": 15, "step": 1},
        ],
        "advanced_params": [
            {"key": "cfg_scale", "label": "CFG scale", "type": "slider", "default": 0.5, "min": 0.0, "max": 1.0, "step": 0.1},
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
            "output_translation": {"duration": "passthrough"},
        },
        "output_params": [
            {"key": "duration", "label": "Duration (seconds)", "type": "slider", "default": 10, "min": 3, "max": 15, "step": 1},
        ],
        "advanced_params": [
            {"key": "cfg_scale", "label": "CFG scale", "type": "slider", "default": 0.5, "min": 0.0, "max": 1.0, "step": 0.1},
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
            "output_translation": {"duration": "passthrough"},
        },
        "output_params": [
            {"key": "resolution", "label": "Resolution", "type": "select", "default": "720p",
             "options": [{"value": "360p", "label": "360p"}, {"value": "540p", "label": "540p"}, {"value": "720p", "label": "720p"}, {"value": "1080p", "label": "1080p"}]},
            {"key": "duration", "label": "Duration (seconds)", "type": "slider", "default": 5, "min": 1, "max": 15, "step": 1},
            {"key": "style", "label": "Style", "type": "select", "default": "",
             "options": [{"value": "", "label": "None"}, {"value": "anime", "label": "Anime"}, {"value": "3d_animation", "label": "3D Animation"}, {"value": "clay", "label": "Clay"}, {"value": "comic", "label": "Comic"}, {"value": "cyberpunk", "label": "Cyberpunk"}]},
        ],
        "advanced_params": [
            {"key": "seed", "label": "Seed", "type": "number", "default": -1, "hint": "-1 = random"},
        ],
    },
]

# Build lookup dicts
MODELS_BY_ID: dict[str, dict[str, Any]] = {m["id"]: m for m in MODELS}


def get_fal_config(model_id: str) -> dict[str, Any] | None:
    """Get the fal.ai endpoint config for a model."""
    model = MODELS_BY_ID.get(model_id)
    return model.get("fal") if model else None


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


class ModelService:
    def __init__(self, models_dir: Path):
        self._models_dir = models_dir

    def get_available_models(self, api_key: str | None = None) -> list[dict[str, Any]]:
        models = []
        for model in MODELS:
            m = {k: v for k, v in model.items() if k != "fal"}
            # Surface image roles supported by the provider so the playground UI
            # can render uploaders without knowing about fal internals.
            fal_cfg = model.get("fal") or {}
            m["supported_image_roles"] = list((fal_cfg.get("role_params") or {}).keys())
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
