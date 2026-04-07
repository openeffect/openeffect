"""Tests for effect manifest validation."""
import pytest
from pydantic import ValidationError
from effects.validator import (
    EffectManifest,
    InputFieldSchema,
    Assets,
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
        "type": "animation",
        "tags": [],
        "assets": {},
        "inputs": {
            "image": {
                "type": "image", "role": "start_frame", "required": True, "label": "Photo",
            },
        },
        "generation": {
            "prompt": "A test prompt. {prompt}",
            "models": ["kling-v3"],
            "default_model": "kling-v3",
            "model_params": {},
        },
    }
    defaults.update(overrides)
    return defaults


class TestEffectValidator:
    def test_valid_manifest_passes(self):
        data = make_valid_manifest()
        manifest = EffectManifest(**data)
        assert manifest.id == "test-effect"
        assert manifest.type == "animation"

    def test_missing_required_field(self):
        data = make_valid_manifest()
        del data["name"]
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "name" in str(exc_info.value)

    def test_free_form_type_accepts_any_string(self):
        data = make_valid_manifest(type="custom_type")
        manifest = EffectManifest(**data)
        assert manifest.type == "custom_type"

    def test_default_model_not_in_supported(self):
        data = make_valid_manifest()
        data["generation"]["default_model"] = "nonexistent"
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "default_model" in str(exc_info.value)

    def test_role_defaults_to_prompt_input(self):
        data = make_valid_manifest(
            inputs={
                "text_field": {
                    "type": "text",
                    "required": False,
                    "label": "Prompt",
                },
            },
        )
        manifest = EffectManifest(**data)
        assert manifest.inputs["text_field"].role == "prompt_input"

    def test_invalid_role_rejected(self):
        data = make_valid_manifest(
            inputs={
                "image": {
                    "type": "image", "role": "invalid_role", "required": True, "label": "Photo",
                },
            },
        )
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "role" in str(exc_info.value).lower()

    def test_max_one_start_frame(self):
        data = make_valid_manifest(
            inputs={
                "image_a": {
                    "type": "image", "role": "start_frame", "required": True, "label": "Image A",
                },
                "image_b": {
                    "type": "image", "role": "start_frame", "required": True, "label": "Image B",
                },
            },
        )
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "start_frame" in str(exc_info.value)

    def test_max_one_end_frame(self):
        data = make_valid_manifest(
            inputs={
                "image_a": {
                    "type": "image", "role": "end_frame", "required": True, "label": "Image A",
                },
                "image_b": {
                    "type": "image", "role": "end_frame", "required": True, "label": "Image B",
                },
            },
        )
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "end_frame" in str(exc_info.value)

    def test_start_and_end_frame_together_valid(self):
        data = make_valid_manifest(
            inputs={
                "image_start": {
                    "type": "image", "role": "start_frame", "required": True, "label": "Start",
                },
                "image_end": {
                    "type": "image", "role": "end_frame", "required": True, "label": "End",
                },
            },
        )
        manifest = EffectManifest(**data)
        assert manifest.inputs["image_start"].role == "start_frame"
        assert manifest.inputs["image_end"].role == "end_frame"

    def test_multiple_prompt_inputs_valid(self):
        data = make_valid_manifest(
            inputs={
                "prompt": {
                    "type": "text", "role": "prompt_input", "required": False, "label": "Prompt",
                },
                "style": {
                    "type": "select",
                    "required": False,
                    "label": "Style",
                    "role": "prompt_input",
                    "default": "cinematic",
                    "options": [{"value": "cinematic", "label": "Cinematic"}],
                },
            },
        )
        manifest = EffectManifest(**data)
        assert manifest.inputs["prompt"].role == "prompt_input"
        assert manifest.inputs["style"].role == "prompt_input"

    def test_reference_role_valid(self):
        data = make_valid_manifest(
            inputs={
                "ref_image": {
                    "type": "image", "role": "reference", "required": False, "label": "Reference",
                },
            },
        )
        manifest = EffectManifest(**data)
        assert manifest.inputs["ref_image"].role == "reference"
