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
        "type": "animation",
        "category": "test",
        "tags": [],
        "assets": {"thumbnail": "thumbnail.jpg"},
        "inputs": {
            "image": {
                "type": "image",
                "required": True,
                "label": "Photo",
                "role": "start_frame",
            },
        },
        "output": {
            "default_aspect_ratio": "9:16",
            "default_duration": 5,
        },
        "generation": {
            "prompt_template": "A test prompt. {prompt}",
            "supported_models": ["wan-2.2"],
            "default_model": "wan-2.2",
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

    def test_output_fields_are_optional(self):
        data = make_valid_manifest()
        data["output"] = {}
        manifest = EffectManifest(**data)
        assert manifest.output.aspect_ratios is None
        assert manifest.output.default_aspect_ratio is None
        assert manifest.output.durations is None
        assert manifest.output.default_duration is None

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
                    "type": "image",
                    "required": True,
                    "label": "Photo",
                    "role": "invalid_role",
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
                    "type": "image",
                    "required": True,
                    "label": "Image A",
                    "role": "start_frame",
                },
                "image_b": {
                    "type": "image",
                    "required": True,
                    "label": "Image B",
                    "role": "start_frame",
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
                    "type": "image",
                    "required": True,
                    "label": "Image A",
                    "role": "end_frame",
                },
                "image_b": {
                    "type": "image",
                    "required": True,
                    "label": "Image B",
                    "role": "end_frame",
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
                    "type": "image",
                    "required": True,
                    "label": "Start",
                    "role": "start_frame",
                },
                "image_end": {
                    "type": "image",
                    "required": True,
                    "label": "End",
                    "role": "end_frame",
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
                    "type": "text",
                    "required": False,
                    "label": "Prompt",
                    "role": "prompt_input",
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
                    "type": "image",
                    "required": False,
                    "label": "Reference",
                    "role": "reference",
                },
            },
        )
        manifest = EffectManifest(**data)
        assert manifest.inputs["ref_image"].role == "reference"
