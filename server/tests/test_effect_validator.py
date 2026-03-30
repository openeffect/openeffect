"""Tests for effect manifest validation."""
import pytest
from pydantic import ValidationError
from effects.validator import (
    EffectManifest,
    InputFieldSchema,
    Assets,
    OutputConfig,
    GenerationConfig,
)


def make_valid_manifest(**overrides) -> dict:
    """Return a valid manifest dict that can be modified for testing."""
    defaults = {
        "id": "test-effect",
        "name": "Test Effect",
        "description": "A test effect",
        "version": "1.0.0",
        "author": "test",
        "effect_type": "single_image",
        "category": "test",
        "tags": [],
        "assets": {"thumbnail": "thumbnail.jpg"},
        "inputs": {
            "image": {
                "type": "image",
                "required": True,
                "label": "Photo",
                "accept": ["image/jpeg"],
                "max_size_mb": 10,
            },
        },
        "output": {
            "aspect_ratios": ["9:16", "1:1"],
            "default_aspect_ratio": "9:16",
            "durations": [3, 5],
            "default_duration": 5,
        },
        "generation": {
            "prompt_template": "A test prompt. {prompt}",
            "supported_models": ["fal-ai/wan-2.2"],
            "default_model": "fal-ai/wan-2.2",
            "parameters": {},
        },
    }
    defaults.update(overrides)
    return defaults


class TestEffectValidator:
    def test_valid_manifest_passes(self):
        data = make_valid_manifest()
        manifest = EffectManifest(**data)
        assert manifest.id == "test-effect"
        assert manifest.effect_type == "single_image"

    def test_missing_required_field(self):
        data = make_valid_manifest()
        del data["name"]
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "name" in str(exc_info.value)

    def test_invalid_effect_type(self):
        data = make_valid_manifest(effect_type="invalid_type")
        with pytest.raises(ValidationError):
            EffectManifest(**data)

    def test_default_model_not_in_supported(self):
        data = make_valid_manifest()
        data["generation"]["default_model"] = "fal-ai/nonexistent"
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "default_model" in str(exc_info.value)

    def test_default_aspect_ratio_not_in_list(self):
        data = make_valid_manifest()
        data["output"]["default_aspect_ratio"] = "4:3"
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "default_aspect_ratio" in str(exc_info.value)

    def test_default_duration_not_in_list(self):
        data = make_valid_manifest()
        data["output"]["default_duration"] = 10
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "default_duration" in str(exc_info.value)

    def test_image_transition_requires_image_start_and_end(self):
        data = make_valid_manifest(
            effect_type="image_transition",
            inputs={
                "image": {
                    "type": "image",
                    "required": True,
                    "label": "Photo",
                    "accept": ["image/jpeg"],
                    "max_size_mb": 10,
                },
            },
        )
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "image_start" in str(exc_info.value) or "image_end" in str(exc_info.value)

    def test_image_transition_with_correct_fields(self):
        data = make_valid_manifest(
            effect_type="image_transition",
            inputs={
                "image_start": {
                    "type": "image",
                    "required": True,
                    "label": "Start",
                    "accept": ["image/jpeg"],
                    "max_size_mb": 10,
                },
                "image_end": {
                    "type": "image",
                    "required": True,
                    "label": "End",
                    "accept": ["image/jpeg"],
                    "max_size_mb": 10,
                },
            },
        )
        manifest = EffectManifest(**data)
        assert manifest.effect_type == "image_transition"

    def test_text_to_video_requires_prompt(self):
        data = make_valid_manifest(
            effect_type="text_to_video",
            inputs={
                "style": {
                    "type": "select",
                    "required": False,
                    "label": "Style",
                    "default": "cinematic",
                    "options": [{"value": "cinematic", "label": "Cinematic"}],
                },
            },
        )
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "prompt" in str(exc_info.value)

    def test_text_to_video_prompt_must_be_required(self):
        data = make_valid_manifest(
            effect_type="text_to_video",
            inputs={
                "prompt": {
                    "type": "text",
                    "required": False,
                    "label": "Prompt",
                    "max_length": 300,
                    "multiline": True,
                },
            },
        )
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "required" in str(exc_info.value).lower()

    def test_text_to_video_valid(self):
        data = make_valid_manifest(
            effect_type="text_to_video",
            inputs={
                "prompt": {
                    "type": "text",
                    "required": True,
                    "label": "Prompt",
                    "max_length": 600,
                    "multiline": True,
                },
            },
        )
        manifest = EffectManifest(**data)
        assert manifest.effect_type == "text_to_video"
