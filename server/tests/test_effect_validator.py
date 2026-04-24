"""Tests for effect manifest validation."""
import pytest
from pydantic import ValidationError

from effects.validator import (
    EffectManifest,
    GenerationConfig,
    InputFieldSchema,
    SelectOption,
    validate_run_inputs,
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
            "prompt": "A test prompt. {{ prompt }}",
            "models": ["kling-3.0"],
            "default_model": "kling-3.0",
            "params": {},
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
                "image": {
                    "type": "image", "role": "start_frame", "required": True, "label": "Photo",
                },
                "text_field": {
                    "type": "text",
                    "required": False,
                    "label": "Prompt",
                },
            },
        )
        manifest = EffectManifest(**data)
        assert manifest.inputs["text_field"].role == "prompt_input"

    def test_missing_start_frame_rejected(self):
        """Every effect must declare an input with role 'start_frame'."""
        data = make_valid_manifest(
            inputs={
                "prompt": {
                    "type": "text", "role": "prompt_input", "required": False, "label": "Prompt",
                },
            },
        )
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "start_frame" in str(exc_info.value)

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
                "image_start": {
                    "type": "image", "role": "start_frame", "required": True, "label": "Start",
                },
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
                "image": {
                    "type": "image", "role": "start_frame", "required": True, "label": "Photo",
                },
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
                "image": {
                    "type": "image", "role": "start_frame", "required": True, "label": "Photo",
                },
                "ref_image": {
                    "type": "image", "role": "reference", "required": False, "label": "Reference",
                },
            },
        )
        manifest = EffectManifest(**data)
        assert manifest.inputs["ref_image"].role == "reference"

    def test_invalid_jinja_in_prompt_rejected(self):
        """Parse-time Jinja syntax check — unclosed tag fails manifest load."""
        data = make_valid_manifest()
        data["generation"]["prompt"] = "A shot. {% if scene %}unclosed"
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "Invalid template in prompt" in str(exc_info.value)

    def test_invalid_jinja_in_negative_prompt_rejected(self):
        data = make_valid_manifest()
        data["generation"]["negative_prompt"] = "{{ dangling"
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "Invalid template in negative_prompt" in str(exc_info.value)

    def test_invalid_jinja_in_model_override_rejected(self):
        data = make_valid_manifest()
        data["generation"]["model_overrides"] = {
            "kling-3.0": {"prompt": "Kling {% for %}"},
        }
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "model_overrides.kling-3.0.prompt" in str(exc_info.value)


# ──────────────────────────────────────────────────────────────────────────────
# `validate_run_inputs` — runtime gate that rejects values that violate the
# manifest's per-field constraints before we hand them to the provider.
# ──────────────────────────────────────────────────────────────────────────────


def _run_input_manifest(**extra_inputs: InputFieldSchema) -> EffectManifest:
    """Build a minimal valid manifest — start_frame image is mandated by
    the manifest-level validator, so every case carries it."""
    inputs = {
        "photo": InputFieldSchema(
            type="image", role="start_frame", required=True, label="Photo",
        ),
        **extra_inputs,
    }
    return EffectManifest(
        id="t",
        name="T",
        description="T",
        type="test",
        inputs=inputs,
        generation=GenerationConfig(prompt="go"),
    )


class TestValidateRunInputsRequired:
    def test_missing_required_text_raises(self):
        m = _run_input_manifest(prompt=InputFieldSchema(
            type="text", required=True, label="Prompt",
        ))
        with pytest.raises(ValueError, match="Required input 'Prompt'"):
            validate_run_inputs(m, {})

    def test_empty_string_counts_as_missing(self):
        m = _run_input_manifest(prompt=InputFieldSchema(
            type="text", required=True, label="Prompt",
        ))
        with pytest.raises(ValueError, match="Required input 'Prompt'"):
            validate_run_inputs(m, {"prompt": "   "})

    def test_optional_field_absent_passes(self):
        m = _run_input_manifest(extra=InputFieldSchema(
            type="text", required=False, label="Extra",
        ))
        validate_run_inputs(m, {})  # no raise

    def test_required_select_missing_raises(self):
        m = _run_input_manifest(style=InputFieldSchema(
            type="select", required=True, label="Style",
            options=[SelectOption(value="a", label="A")],
        ))
        with pytest.raises(ValueError, match="Required input 'Style'"):
            validate_run_inputs(m, {})

    def test_image_required_is_not_enforced_here(self):
        """start_frame required-ness is an author-time invariant; at run
        time we receive a ref_id and can't meaningfully 'require' one
        without a separate request-shape check."""
        m = _run_input_manifest()
        validate_run_inputs(m, {})  # no raise, despite required image


class TestValidateRunInputsText:
    def test_within_max_length_passes(self):
        m = _run_input_manifest(prompt=InputFieldSchema(
            type="text", label="Prompt", max_length=10,
        ))
        validate_run_inputs(m, {"prompt": "short"})

    def test_exceeds_max_length_raises(self):
        m = _run_input_manifest(prompt=InputFieldSchema(
            type="text", label="Prompt", max_length=10,
        ))
        with pytest.raises(ValueError, match="at most 10 characters"):
            validate_run_inputs(m, {"prompt": "x" * 11})

    def test_no_max_length_means_no_limit(self):
        m = _run_input_manifest(prompt=InputFieldSchema(type="text", label="Prompt"))
        validate_run_inputs(m, {"prompt": "x" * 100_000})


class TestValidateRunInputsSelect:
    def test_valid_option_passes(self):
        m = _run_input_manifest(mood=InputFieldSchema(
            type="select", label="Mood",
            options=[SelectOption(value="happy", label="Happy"),
                     SelectOption(value="sad", label="Sad")],
        ))
        validate_run_inputs(m, {"mood": "happy"})

    def test_invalid_option_raises(self):
        m = _run_input_manifest(mood=InputFieldSchema(
            type="select", label="Mood",
            options=[SelectOption(value="happy", label="Happy"),
                     SelectOption(value="sad", label="Sad")],
        ))
        with pytest.raises(ValueError, match="must be one of: happy, sad"):
            validate_run_inputs(m, {"mood": "angry"})


class TestValidateRunInputsSlider:
    def test_in_range_passes(self):
        m = _run_input_manifest(intensity=InputFieldSchema(
            type="slider", label="Intensity", min=0, max=100,
        ))
        validate_run_inputs(m, {"intensity": "50"})

    def test_below_min_raises(self):
        m = _run_input_manifest(intensity=InputFieldSchema(
            type="slider", label="Intensity", min=0, max=100,
        ))
        with pytest.raises(ValueError, match="at least 0"):
            validate_run_inputs(m, {"intensity": "-5"})

    def test_above_max_raises(self):
        m = _run_input_manifest(intensity=InputFieldSchema(
            type="slider", label="Intensity", min=0, max=100,
        ))
        with pytest.raises(ValueError, match="at most 100"):
            validate_run_inputs(m, {"intensity": "150"})

    def test_non_numeric_raises(self):
        m = _run_input_manifest(intensity=InputFieldSchema(
            type="slider", label="Intensity", min=0, max=100,
        ))
        with pytest.raises(ValueError, match="must be a number"):
            validate_run_inputs(m, {"intensity": "pretty high"})


class TestValidateRunInputsNumber:
    def test_only_min_below_raises(self):
        m = _run_input_manifest(count=InputFieldSchema(
            type="number", label="Count", min=1,
        ))
        with pytest.raises(ValueError, match="at least 1"):
            validate_run_inputs(m, {"count": "0"})

    def test_only_max_above_raises(self):
        m = _run_input_manifest(count=InputFieldSchema(
            type="number", label="Count", max=10,
        ))
        with pytest.raises(ValueError, match="at most 10"):
            validate_run_inputs(m, {"count": "11"})

    def test_no_bounds_means_anything_goes(self):
        m = _run_input_manifest(count=InputFieldSchema(type="number", label="Count"))
        validate_run_inputs(m, {"count": "999999"})
        validate_run_inputs(m, {"count": "-500"})

    def test_float_formatting_drops_trailing_zero(self):
        """0.5 renders as '0.5', 1.0 as '1' — the :g formatter keeps
        error labels readable for mixed float/int bounds."""
        m = _run_input_manifest(weight=InputFieldSchema(
            type="number", label="Weight", min=0.5, max=1.0,
        ))
        with pytest.raises(ValueError, match="at least 0.5"):
            validate_run_inputs(m, {"weight": "0.1"})
        with pytest.raises(ValueError, match="at most 1$"):
            validate_run_inputs(m, {"weight": "2"})
