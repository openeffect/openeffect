"""Tests for PromptBuilder — build_prompt() and build_provider_io()."""
from typing import Any

import pytest
import yaml
from pydantic import ValidationError

from effects.prompt_builder import PromptBuilder
from effects.validator import (
    Assets,
    EffectManifest,
    GenerationConfig,
    InputFieldSchema,
    ModelOverride,
    ModelParam,
    SelectOption,
)
from services.model_service import canonical_to_wire, get_model, get_provider


def apply_wire(model_id: str, canonical: dict) -> dict:
    """Simulate the full provider-layer wire pass: transform + canonical→wire.
    Kept here so the transform-behavior tests still integrate against the
    real provider config, even though `build_provider_io` no longer runs
    transforms itself."""
    model = get_model(model_id) or {}
    provider = get_provider(model_id, "fal") or {}
    return canonical_to_wire(model, provider, canonical)


def make_manifest(**overrides) -> EffectManifest:
    """Create a test manifest with sensible defaults."""
    manifest_kwargs: dict[str, Any] = {
        "id": "test-effect",
        "name": "Test Effect",
        "description": "A test effect",
        "version": "1.0.0",
        "author": "test",
        "category": "animation",
        "tags": [],
        "assets": Assets(),
        "inputs": {
            "image": InputFieldSchema(type="image", role="start_frame", required=True, label="Photo"),
            "prompt": InputFieldSchema(
                type="text", required=False, label="Prompt",
                placeholder="Describe...", max_length=300, multiline=False,
            ),
        },
        "generation": GenerationConfig(
            prompt="A cinematic shot. {{ prompt }} High quality.",
            negative_prompt="low quality, blurry",
            models=["kling-3.0", "wan-2.7"],
            default_model="kling-3.0",
            params={
                "guidance_scale": ModelParam(default=7.5),
                "num_inference_steps": ModelParam(default=30),
            },
            model_overrides={},
        ),
    }
    manifest_kwargs.update(overrides)
    return EffectManifest(**manifest_kwargs)


# -----------------------------------------
# build_prompt() tests
# -----------------------------------------

class TestBuildPrompt:
    def test_basic_prompt_substitution(self):
        manifest = make_manifest()
        result = PromptBuilder.build_prompt(manifest, "wan-2.7", {"prompt": "epic sunset"})
        assert "epic sunset" in result
        assert "{{" not in result

    def test_empty_prompt_no_double_spaces(self):
        manifest = make_manifest()
        result = PromptBuilder.build_prompt(manifest, "wan-2.7", {"prompt": ""})
        assert "  " not in result
        assert "{{" not in result

    def test_missing_prompt_field(self):
        manifest = make_manifest()
        result = PromptBuilder.build_prompt(manifest, "wan-2.7", {})
        assert "  " not in result
        assert "{{" not in result

    def test_text_field_substitution(self):
        manifest = make_manifest(
            inputs={
                "image": InputFieldSchema(type="image", role="start_frame", required=True, label="Photo"),
                "mood": InputFieldSchema(
                    type="text", required=False, label="Mood",
                    max_length=100, multiline=False,
                ),
            },
            generation=GenerationConfig(
                prompt="Shot with {{ mood }} mood. High quality.",
                models=["kling-3.0"],
                default_model="kling-3.0",
                params={},
            ),
        )
        result = PromptBuilder.build_prompt(manifest, "kling-3.0", {"mood": "dramatic"})
        assert "dramatic" in result
        assert "{{" not in result

    def test_select_field_uses_label_not_value(self):
        manifest = make_manifest(
            inputs={
                "image": InputFieldSchema(type="image", role="start_frame", required=True, label="Photo"),
                "style": InputFieldSchema(
                    type="select",
                    required=False,
                    label="Style",
                    options=[
                        SelectOption(value="particles", label="Particles"),
                        SelectOption(value="liquid", label="Liquid Flow"),
                    ],
                    default="particles",
                ),
            },
            generation=GenerationConfig(
                prompt="Cinematic {{ style }} transition.",
                models=["kling-3.0"],
                default_model="kling-3.0",
                params={},
            ),
        )
        result = PromptBuilder.build_prompt(manifest, "kling-3.0", {"style": "liquid"})
        assert "Liquid Flow" in result
        assert "liquid" not in result.lower().replace("liquid flow", "")

    def test_model_override_uses_different_template(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="Default template. {{ prompt }}",
                models=["kling-3.0", "wan-2.7"],
                default_model="kling-3.0",
                params={},
                model_overrides={
                    "kling-3.0": ModelOverride(prompt="Kling template. {{ prompt }}"),
                },
            ),
        )
        result_wan = PromptBuilder.build_prompt(manifest, "wan-2.7", {"prompt": "test"})
        result_kling = PromptBuilder.build_prompt(manifest, "kling-3.0", {"prompt": "test"})
        assert "Default template" in result_wan
        assert "Kling template" in result_kling

    def test_undeclared_variable_raises(self):
        """StrictUndefined turns author typos into explicit errors rather
        than silently stripping them (old regex behavior)."""
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="Shot with {{ typo_field }} effect.",
                models=["kling-3.0"],
                default_model="kling-3.0",
                params={},
            ),
        )
        with pytest.raises(ValueError, match="Prompt template error"):
            PromptBuilder.build_prompt(manifest, "kling-3.0", {})

    def test_multiple_consecutive_spaces_collapsed(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="Start  {{ prompt }}   end.",
                models=["kling-3.0"],
                default_model="kling-3.0",
                params={},
            ),
        )
        result = PromptBuilder.build_prompt(manifest, "kling-3.0", {"prompt": ""})
        assert "  " not in result


# -----------------------------------------
# Jinja-specific: conditionals, sandbox, negative_prompt
# -----------------------------------------

class TestJinjaConditionals:
    def test_if_block_omitted_when_var_empty(self):
        manifest = make_manifest(
            inputs={
                "image": InputFieldSchema(type="image", role="start_frame", required=True, label="Photo"),
                "scene": InputFieldSchema(
                    type="text", required=False, label="Scene",
                ),
            },
            generation=GenerationConfig(
                prompt="Cinematic shot.{% if scene %} Scene: {{ scene }}.{% endif %} High quality.",
                models=["kling-3.0"],
                default_model="kling-3.0",
                params={},
            ),
        )
        result = PromptBuilder.build_prompt(manifest, "kling-3.0", {})
        assert result == "Cinematic shot. High quality."

    def test_if_block_rendered_when_var_set(self):
        manifest = make_manifest(
            inputs={
                "image": InputFieldSchema(type="image", role="start_frame", required=True, label="Photo"),
                "scene": InputFieldSchema(
                    type="text", required=False, label="Scene",
                ),
            },
            generation=GenerationConfig(
                prompt="Cinematic shot.{% if scene %} Scene: {{ scene }}.{% endif %} High quality.",
                models=["kling-3.0"],
                default_model="kling-3.0",
                params={},
            ),
        )
        result = PromptBuilder.build_prompt(manifest, "kling-3.0", {"scene": "dawn in Tokyo"})
        assert "Scene: dawn in Tokyo." in result


class TestSandbox:
    def test_object_graph_escape_rejected(self):
        """SandboxedEnvironment blocks the classic `__class__.__mro__[1]…`
        escape; errors surface as ValueError from build_prompt."""
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="{{ ''.__class__.__mro__[1].__subclasses__() }}",
                models=["kling-3.0"],
                default_model="kling-3.0",
                params={},
            ),
        )
        with pytest.raises(ValueError, match="Prompt template error"):
            PromptBuilder.build_prompt(manifest, "kling-3.0", {})


class TestBuildNegativePrompt:
    def test_flat_string_passes_through(self):
        manifest = make_manifest()  # negative_prompt="low quality, blurry"
        result = PromptBuilder.build_negative_prompt(manifest, "wan-2.7", {})
        assert result == "low quality, blurry"

    def test_conditional_block_works(self):
        manifest = make_manifest(
            inputs={
                "image": InputFieldSchema(type="image", role="start_frame", required=True, label="Photo"),
                "avoid": InputFieldSchema(
                    type="text", required=False, label="Avoid",
                ),
            },
            generation=GenerationConfig(
                prompt="go",
                negative_prompt="low quality{% if avoid %}, {{ avoid }}{% endif %}",
                models=["kling-3.0"],
                default_model="kling-3.0",
                params={},
            ),
        )
        empty = PromptBuilder.build_negative_prompt(manifest, "kling-3.0", {})
        withvar = PromptBuilder.build_negative_prompt(manifest, "kling-3.0", {"avoid": "blur"})
        assert empty == "low quality"
        assert withvar == "low quality, blur"


# -----------------------------------------
# build_provider_io() — merge precedence and filtering
# -----------------------------------------
# We test with kling-3.0 for most scenarios because kling-3.0 has no
# transform_params (params pass through unchanged, easy to assert on).
# Transform behavior is covered in TestTransformParams.

class TestBuildProviderIO:
    def test_unknown_key_in_params_dropped(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["kling-3.0"],
                default_model="kling-3.0",
                params={
                    "guidance_scale": ModelParam(default=0.7),
                    "unknown_param": ModelParam(default=42),
                },
            ),
        )
        params = PromptBuilder.build_provider_io("kling-3.0", "fal", manifest=manifest)
        assert params["guidance_scale"] == 0.7
        assert "unknown_param" not in params

    def test_unknown_key_in_raw_params_dropped(self):
        manifest = make_manifest()
        params = PromptBuilder.build_provider_io("kling-3.0", "fal",
            raw_params={"guidance_scale": 0.8, "fake_key": 99},
            manifest=manifest,
        )
        assert params["guidance_scale"] == 0.8
        assert "fake_key" not in params

    def test_manifest_default_lands_in_result(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["kling-3.0"],
                default_model="kling-3.0",
                params={"guidance_scale": ModelParam(default=0.8)},
            ),
        )
        params = PromptBuilder.build_provider_io("kling-3.0", "fal", manifest=manifest)
        assert params["guidance_scale"] == 0.8

    def test_model_override_replaces_top_level(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["kling-3.0", "wan-2.7"],
                default_model="kling-3.0",
                params={"guidance_scale": ModelParam(default=0.5)},
                model_overrides={
                    "kling-3.0": ModelOverride(params={"guidance_scale": ModelParam(default=0.9)}),
                },
            ),
        )
        params = PromptBuilder.build_provider_io("kling-3.0", "fal", manifest=manifest)
        assert params["guidance_scale"] == 0.9

    def test_raw_params_beat_manifest_defaults(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["kling-3.0"],
                default_model="kling-3.0",
                params={"guidance_scale": ModelParam(default=0.5)},
                model_overrides={
                    "kling-3.0": ModelOverride(params={"guidance_scale": ModelParam(default=0.7)}),
                },
            ),
        )
        params = PromptBuilder.build_provider_io("kling-3.0", "fal",
            raw_params={"guidance_scale": 0.95},
            manifest=manifest,
        )
        assert params["guidance_scale"] == 0.95

    def test_no_raw_params_no_manifest_returns_empty(self):
        params = PromptBuilder.build_provider_io("kling-3.0", "fal")
        assert params == {}

    def test_unknown_model_returns_empty(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["unknown-model"],
                default_model="unknown-model",
                params={"guidance_scale": ModelParam(default=0.5)},
            ),
        )
        params = PromptBuilder.build_provider_io("unknown-model", "fal", manifest=manifest)
        assert params == {}

    def test_unknown_provider_returns_empty(self):
        """Unknown provider → no known params → everything dropped."""
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["kling-3.0"],
                default_model="kling-3.0",
                params={"guidance_scale": ModelParam(default=0.5)},
            ),
        )
        params = PromptBuilder.build_provider_io("kling-3.0", "replicate",
            raw_params={"guidance_scale": 0.9},
            manifest=manifest,
        )
        assert params == {}

    def test_playground_mode_no_manifest(self):
        """Playground path: no manifest, route raw_params via registry."""
        params = PromptBuilder.build_provider_io("kling-3.0", "fal",
            raw_params={"guidance_scale": 0.8, "duration": 6, "fake": "dropped"},
        )
        assert params == {"guidance_scale": 0.8, "duration": 6}

    def test_manifest_input_keys_never_in_params(self):
        """manifest.inputs fields (image / text / select etc.) are unrelated
        to model params; they must not leak through build_provider_io."""
        manifest = make_manifest(
            inputs={
                "image": InputFieldSchema(type="image", role="start_frame", required=True, label="Photo"),
                "style": InputFieldSchema(
                    type="select", required=False, label="Style",
                    options=[SelectOption(value="particles", label="Particles")],
                    default="particles",
                ),
            },
        )
        # "style" is not a valid key for kling-3.0's model params
        params = PromptBuilder.build_provider_io("kling-3.0", "fal",
            raw_params={"style": "particles"},
            manifest=manifest,
        )
        assert "style" not in params


# -----------------------------------------
# Direct-wire models (no transform layer)
# -----------------------------------------
# All three current models accept their canonical params natively — duration
# flows straight through to the wire without a derivation step.

class TestDirectWire:
    def test_duration_passes_through_unchanged(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["wan-2.7"],
                default_model="wan-2.7",
                params={"duration": ModelParam(default=5)},
            ),
        )
        canonical = PromptBuilder.build_provider_io("wan-2.7", "fal", manifest=manifest)
        wire = apply_wire("wan-2.7", canonical)
        assert wire["duration"] == 5

    def test_locked_duration_wins_over_raw_params(self):
        """Locked duration takes precedence over user input on wan-2.7."""
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["wan-2.7"],
                default_model="wan-2.7",
                params={"duration": ModelParam(value=4)},
            ),
        )
        canonical = PromptBuilder.build_provider_io("wan-2.7", "fal",
            raw_params={"duration": 9},
            manifest=manifest,
        )
        wire = apply_wire("wan-2.7", canonical)
        assert wire["duration"] == 4

    def test_kling_duration_passes_through(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["kling-3.0"],
                default_model="kling-3.0",
                params={"duration": ModelParam(default=7)},
            ),
        )
        canonical = PromptBuilder.build_provider_io("kling-3.0", "fal", manifest=manifest)
        wire = apply_wire("kling-3.0", canonical)
        assert wire["duration"] == 7

    def test_unknown_canonical_dropped(self):
        """A key not declared in the provider's params map is silently dropped."""
        params = PromptBuilder.build_provider_io("wan-2.7", "fal",
            raw_params={"duration": 5, "nonexistent_knob": 123},
        )
        assert params.get("duration") == 5
        assert "nonexistent_knob" not in params


# -----------------------------------------
# Locked params (value:) — merge precedence
# -----------------------------------------

class TestLockedModelParams:
    def test_locked_value_overrides_raw_params(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["kling-3.0"],
                default_model="kling-3.0",
                params={"guidance_scale": ModelParam(value=0.8)},
            ),
        )
        params = PromptBuilder.build_provider_io("kling-3.0", "fal",
            raw_params={"guidance_scale": 0.95},
            manifest=manifest,
        )
        assert params["guidance_scale"] == 0.8

    def test_override_can_lock_a_default(self):
        """A model override may flip a top-level default into a locked value."""
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["kling-3.0"],
                default_model="kling-3.0",
                params={"guidance_scale": ModelParam(default=0.5)},
                model_overrides={
                    "kling-3.0": ModelOverride(params={"guidance_scale": ModelParam(value=0.85)}),
                },
            ),
        )
        params = PromptBuilder.build_provider_io("kling-3.0", "fal",
            raw_params={"guidance_scale": 0.95},
            manifest=manifest,
        )
        assert params["guidance_scale"] == 0.85

    def test_override_can_unlock_a_value(self):
        """A model override with a default unlocks a top-level locked value."""
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["kling-3.0"],
                default_model="kling-3.0",
                params={"guidance_scale": ModelParam(value=0.5)},
                model_overrides={
                    "kling-3.0": ModelOverride(params={"guidance_scale": ModelParam(default=0.75)}),
                },
            ),
        )
        params = PromptBuilder.build_provider_io("kling-3.0", "fal",
            raw_params={"guidance_scale": 0.95},
            manifest=manifest,
        )
        assert params["guidance_scale"] == 0.95  # override unlocked → user wins

    def test_scalar_shorthand_parses_as_locked(self):
        """A bare scalar in YAML is coerced to {value: scalar} (locked).
        Visible seeded defaults require the explicit long form."""
        yaml_text = """
        id: yaml-test
        name: Yaml Test
        description: ''
        category: animation
        inputs:
          image:
            type: image
            role: start_frame
            required: true
            label: Photo
        generation:
          prompt: 'test'
          models: [kling-3.0]
          default_model: kling-3.0
          params:
            guidance_scale: 0.7
            num_inference_steps: 32
        """
        manifest = EffectManifest(**yaml.safe_load(yaml_text))
        assert manifest.generation.params["guidance_scale"].value == 0.7
        assert manifest.generation.params["guidance_scale"].is_locked is True
        assert manifest.generation.params["num_inference_steps"].value == 32

    def test_explicit_default_form_parses_as_visible(self):
        yaml_text = """
        id: yaml-test
        name: Yaml Test
        description: ''
        category: animation
        inputs:
          image:
            type: image
            role: start_frame
            required: true
            label: Photo
        generation:
          prompt: 'test'
          models: [kling-3.0]
          default_model: kling-3.0
          params:
            guidance_scale:
              default: 0.65
        """
        manifest = EffectManifest(**yaml.safe_load(yaml_text))
        entry = manifest.generation.params["guidance_scale"]
        assert entry.default == 0.65
        assert entry.is_locked is False

    def test_both_default_and_value_rejected(self):
        with pytest.raises(ValidationError):
            ModelParam(default=5, value=10)

    def test_neither_default_nor_value_rejected(self):
        with pytest.raises(ValidationError):
            ModelParam()
