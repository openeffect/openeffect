"""Tests for PromptBuilder — build_prompt() and build_provider_io()."""
import pytest
import yaml
from pydantic import ValidationError
from effects.prompt_builder import PromptBuilder
from effects.validator import (
    EffectManifest,
    InputFieldSchema,
    SelectOption,
    Assets,
    GenerationConfig,
    ModelOverride,
    ModelParam,
)


def make_manifest(**overrides) -> EffectManifest:
    """Create a test manifest with sensible defaults."""
    manifest_kwargs = {
        "id": "test-effect",
        "name": "Test Effect",
        "description": "A test effect",
        "version": "1.0.0",
        "author": "test",
        "type": "animation",
        "tags": [],
        "assets": Assets(),
        "inputs": {
            "image": InputFieldSchema(type="image", role="start_frame", required=True, label="Photo"),
            "prompt": InputFieldSchema(type="text", role="prompt_input", required=False, label="Prompt", placeholder="Describe...", max_length=300, multiline=False),
        },
        "generation": GenerationConfig(
            prompt="A cinematic shot. {prompt} High quality.",
            negative_prompt="low quality, blurry",
            models=["kling-v3", "wan-2.2"],
            default_model="kling-v3",
            model_params={
                "cfg_scale": ModelParam(default=7.5),
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
        result = PromptBuilder.build_prompt(manifest, "wan-2.2", {"prompt": "epic sunset"})
        assert "epic sunset" in result
        assert "{prompt}" not in result

    def test_empty_prompt_no_double_spaces(self):
        manifest = make_manifest()
        result = PromptBuilder.build_prompt(manifest, "wan-2.2", {"prompt": ""})
        assert "  " not in result
        assert "{prompt}" not in result

    def test_missing_prompt_field(self):
        manifest = make_manifest()
        result = PromptBuilder.build_prompt(manifest, "wan-2.2", {})
        assert "  " not in result
        assert "{prompt}" not in result

    def test_text_field_substitution(self):
        manifest = make_manifest(
            inputs={
                "image": InputFieldSchema(type="image", role="start_frame", required=True, label="Photo"),
                "mood": InputFieldSchema(type="text", role="prompt_input", required=False, label="Mood", max_length=100, multiline=False),
            },
            generation=GenerationConfig(
                prompt="Shot with {mood} mood. High quality.",
                models=["kling-v3"],
                default_model="kling-v3",
                model_params={},
            ),
        )
        result = PromptBuilder.build_prompt(manifest, "kling-v3", {"mood": "dramatic"})
        assert "dramatic" in result
        assert "{mood}" not in result

    def test_select_field_uses_label_not_value(self):
        manifest = make_manifest(
            inputs={
                "style": InputFieldSchema(
                    type="select",
                    role="prompt_input",
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
                prompt="Cinematic {style} transition.",
                models=["kling-v3"],
                default_model="kling-v3",
                model_params={},
            ),
        )
        result = PromptBuilder.build_prompt(manifest, "kling-v3", {"style": "liquid"})
        assert "Liquid Flow" in result
        assert "liquid" not in result.lower().replace("liquid flow", "")

    def test_model_override_uses_different_template(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="Default template. {prompt}",
                models=["kling-v3", "wan-2.2"],
                default_model="kling-v3",
                model_params={},
                model_overrides={
                    "kling-v3": ModelOverride(prompt="Kling template. {prompt}"),
                },
            ),
        )
        result_wan = PromptBuilder.build_prompt(manifest, "wan-2.2", {"prompt": "test"})
        result_kling = PromptBuilder.build_prompt(manifest, "kling-v3", {"prompt": "test"})
        assert "Default template" in result_wan
        assert "Kling template" in result_kling

    def test_unknown_placeholder_becomes_empty(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="Shot with {unknown_field} effect.",
                models=["kling-v3"],
                default_model="kling-v3",
                model_params={},
            ),
        )
        result = PromptBuilder.build_prompt(manifest, "kling-v3", {})
        assert "{unknown_field}" not in result
        assert "  " not in result

    def test_multiple_consecutive_spaces_collapsed(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="Start  {prompt}   end.",
                models=["kling-v3"],
                default_model="kling-v3",
                model_params={},
            ),
        )
        result = PromptBuilder.build_prompt(manifest, "kling-v3", {"prompt": ""})
        assert "  " not in result


# -----------------------------------------
# build_provider_io() — merge precedence and filtering
# -----------------------------------------
# We test with kling-v3 for most scenarios because kling-v3 has no
# transform_params (params pass through unchanged, easy to assert on).
# Transform behavior is covered in TestTransformParams.

class TestBuildProviderIO:
    def test_unknown_key_in_model_params_dropped(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["kling-v3"],
                default_model="kling-v3",
                model_params={
                    "cfg_scale": ModelParam(default=0.7),
                    "unknown_param": ModelParam(default=42),
                },
            ),
        )
        params = PromptBuilder.build_provider_io("kling-v3", manifest=manifest)
        assert params["cfg_scale"] == 0.7
        assert "unknown_param" not in params

    def test_unknown_key_in_raw_params_dropped(self):
        manifest = make_manifest()
        params = PromptBuilder.build_provider_io(
            "kling-v3",
            raw_params={"cfg_scale": 0.8, "fake_key": 99},
            manifest=manifest,
        )
        assert params["cfg_scale"] == 0.8
        assert "fake_key" not in params

    def test_manifest_default_lands_in_result(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["kling-v3"],
                default_model="kling-v3",
                model_params={"cfg_scale": ModelParam(default=0.8)},
            ),
        )
        params = PromptBuilder.build_provider_io("kling-v3", manifest=manifest)
        assert params["cfg_scale"] == 0.8

    def test_model_override_replaces_top_level(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["kling-v3", "wan-2.2"],
                default_model="kling-v3",
                model_params={"cfg_scale": ModelParam(default=0.5)},
                model_overrides={
                    "kling-v3": ModelOverride(model_params={"cfg_scale": ModelParam(default=0.9)}),
                },
            ),
        )
        params = PromptBuilder.build_provider_io("kling-v3", manifest=manifest)
        assert params["cfg_scale"] == 0.9

    def test_raw_params_beat_manifest_defaults(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["kling-v3"],
                default_model="kling-v3",
                model_params={"cfg_scale": ModelParam(default=0.5)},
                model_overrides={
                    "kling-v3": ModelOverride(model_params={"cfg_scale": ModelParam(default=0.7)}),
                },
            ),
        )
        params = PromptBuilder.build_provider_io(
            "kling-v3",
            raw_params={"cfg_scale": 0.95},
            manifest=manifest,
        )
        assert params["cfg_scale"] == 0.95

    def test_no_raw_params_no_manifest_returns_empty(self):
        params = PromptBuilder.build_provider_io("kling-v3")
        assert params == {}

    def test_unknown_model_returns_empty(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["unknown-model"],
                default_model="unknown-model",
                model_params={"cfg_scale": ModelParam(default=0.5)},
            ),
        )
        params = PromptBuilder.build_provider_io("unknown-model", manifest=manifest)
        assert params == {}

    def test_playground_mode_no_manifest(self):
        """Playground path: no manifest, route raw_params via registry."""
        params = PromptBuilder.build_provider_io(
            "kling-v3",
            raw_params={"cfg_scale": 0.8, "duration": 6, "fake": "dropped"},
        )
        assert params == {"cfg_scale": 0.8, "duration": 6}

    def test_prompt_input_keys_never_in_params(self):
        """Prompt-input fields from the manifest.inputs map are unrelated to
        model_params; they must not leak through build_provider_io."""
        manifest = make_manifest(
            inputs={
                "style": InputFieldSchema(
                    type="select", role="prompt_input", required=False, label="Style",
                    options=[SelectOption(value="particles", label="Particles")],
                    default="particles",
                ),
            },
        )
        # "style" is not a valid key for kling-v3's model params
        params = PromptBuilder.build_provider_io(
            "kling-v3",
            raw_params={"style": "particles"},
            manifest=manifest,
        )
        assert "style" not in params


# -----------------------------------------
# Model-level transform_params
# -----------------------------------------
# WAN 2.2 has _wan22_transform registered. It converts duration (seconds) to
# num_frames (duration × 16 fps) and adds an fps key.

class TestTransformParams:
    def test_wan22_transform_applied_to_manifest_default(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["wan-2.2"],
                default_model="wan-2.2",
                model_params={"duration": ModelParam(default=5)},
            ),
        )
        params = PromptBuilder.build_provider_io("wan-2.2", manifest=manifest)
        # duration → num_frames via _wan22_transform
        assert params.get("num_frames") == 80  # 5 × 16
        assert params.get("fps") == 16
        assert "duration" not in params  # original key consumed by transform

    def test_wan22_transform_applied_to_raw_params(self):
        params = PromptBuilder.build_provider_io(
            "wan-2.2",
            raw_params={"duration": 3},
        )
        assert params["num_frames"] == 48  # 3 × 16
        assert params["fps"] == 16
        assert "duration" not in params

    def test_wan22_transform_applied_after_lock(self):
        """Locked duration takes precedence over user input, THEN transform runs."""
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["wan-2.2"],
                default_model="wan-2.2",
                model_params={"duration": ModelParam(value=4)},
            ),
        )
        params = PromptBuilder.build_provider_io(
            "wan-2.2",
            raw_params={"duration": 9},
            manifest=manifest,
        )
        # Lock wins: duration = 4 → num_frames = 64
        assert params["num_frames"] == 64

    def test_kling_v3_has_no_transform(self):
        """Models without transform_params leave duration as-is."""
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["kling-v3"],
                default_model="kling-v3",
                model_params={"duration": ModelParam(default=7)},
            ),
        )
        params = PromptBuilder.build_provider_io("kling-v3", manifest=manifest)
        assert params["duration"] == 7
        assert "num_frames" not in params
        assert "fps" not in params

    def test_other_wan_params_passthrough(self):
        """Transform only touches duration; other WAN params are unchanged."""
        params = PromptBuilder.build_provider_io(
            "wan-2.2",
            raw_params={"duration": 5, "cfg_scale": 4.0, "aspect_ratio": "16:9"},
        )
        assert params["cfg_scale"] == 4.0
        assert params["aspect_ratio"] == "16:9"
        assert params["num_frames"] == 80


# -----------------------------------------
# Locked model_params (value:) — merge precedence
# -----------------------------------------

class TestLockedModelParams:
    def test_locked_value_overrides_raw_params(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["kling-v3"],
                default_model="kling-v3",
                model_params={"cfg_scale": ModelParam(value=0.8)},
            ),
        )
        params = PromptBuilder.build_provider_io(
            "kling-v3",
            raw_params={"cfg_scale": 0.95},
            manifest=manifest,
        )
        assert params["cfg_scale"] == 0.8

    def test_override_can_lock_a_default(self):
        """A model override may flip a top-level default into a locked value."""
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["kling-v3"],
                default_model="kling-v3",
                model_params={"cfg_scale": ModelParam(default=0.5)},
                model_overrides={
                    "kling-v3": ModelOverride(model_params={"cfg_scale": ModelParam(value=0.85)}),
                },
            ),
        )
        params = PromptBuilder.build_provider_io(
            "kling-v3",
            raw_params={"cfg_scale": 0.95},
            manifest=manifest,
        )
        assert params["cfg_scale"] == 0.85

    def test_override_can_unlock_a_value(self):
        """A model override with a default unlocks a top-level locked value."""
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["kling-v3"],
                default_model="kling-v3",
                model_params={"cfg_scale": ModelParam(value=0.5)},
                model_overrides={
                    "kling-v3": ModelOverride(model_params={"cfg_scale": ModelParam(default=0.75)}),
                },
            ),
        )
        params = PromptBuilder.build_provider_io(
            "kling-v3",
            raw_params={"cfg_scale": 0.95},
            manifest=manifest,
        )
        assert params["cfg_scale"] == 0.95  # override unlocked → user wins

    def test_scalar_shorthand_parses_as_default(self):
        """A bare scalar in YAML is coerced to {default: scalar}."""
        yaml_text = """
        id: yaml-test
        name: Yaml Test
        description: ''
        type: animation
        inputs:
          image:
            type: image
            role: start_frame
            required: true
            label: Photo
        generation:
          prompt: 'test'
          models: [kling-v3]
          default_model: kling-v3
          model_params:
            cfg_scale: 0.7
            num_inference_steps: 32
        """
        manifest = EffectManifest(**yaml.safe_load(yaml_text))
        assert manifest.generation.model_params["cfg_scale"].default == 0.7
        assert manifest.generation.model_params["cfg_scale"].is_locked is False
        assert manifest.generation.model_params["num_inference_steps"].default == 32

    def test_explicit_value_form_parses_as_locked(self):
        yaml_text = """
        id: yaml-test
        name: Yaml Test
        description: ''
        type: animation
        inputs:
          image:
            type: image
            role: start_frame
            required: true
            label: Photo
        generation:
          prompt: 'test'
          models: [kling-v3]
          default_model: kling-v3
          model_params:
            cfg_scale:
              value: 0.65
        """
        manifest = EffectManifest(**yaml.safe_load(yaml_text))
        entry = manifest.generation.model_params["cfg_scale"]
        assert entry.value == 0.65
        assert entry.is_locked is True

    def test_both_default_and_value_rejected(self):
        with pytest.raises(ValidationError):
            ModelParam(default=5, value=10)

    def test_neither_default_nor_value_rejected(self):
        with pytest.raises(ValidationError):
            ModelParam()
