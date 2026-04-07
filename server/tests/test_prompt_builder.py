"""Tests for PromptBuilder - build_prompt() and build_params() separately."""
import pytest
from effects.prompt_builder import PromptBuilder
from effects.validator import (
    EffectManifest,
    InputFieldSchema,
    SelectOption,
    Assets,
    GenerationConfig,
    ModelOverride,
)


def make_manifest(**overrides) -> EffectManifest:
    """Create a test manifest with sensible defaults."""
    defaults = {
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
            defaults={"cfg_scale": 7.5, "num_inference_steps": 30},
            model_overrides={},
        ),
    }
    defaults.update(overrides)
    return EffectManifest(**defaults)


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
                defaults={},
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
                defaults={},
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
                defaults={},
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
                defaults={},
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
                defaults={},
            ),
        )
        result = PromptBuilder.build_prompt(manifest, "kling-v3", {"prompt": ""})
        assert "  " not in result


# -----------------------------------------
# build_params() tests
# -----------------------------------------

class TestBuildParams:
    def test_unknown_key_in_defaults_filtered(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["kling-v3"],
                default_model="kling-v3",
                defaults={"cfg_scale": 7.5, "unknown_param": 42},
            ),
        )
        result = PromptBuilder.build_params(manifest, "kling-v3")
        assert "cfg_scale" in result
        assert "unknown_param" not in result

    def test_unknown_key_in_user_params_filtered(self):
        manifest = make_manifest()
        result = PromptBuilder.build_params(manifest, "wan-2.2", {"cfg_scale": 8.0, "fake_key": 99})
        assert result["cfg_scale"] == 8.0
        assert "fake_key" not in result

    def test_model_override_merges_on_top(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["kling-v3", "wan-2.2"],
                default_model="kling-v3",
                defaults={"cfg_scale": 7.5},
                model_overrides={
                    "kling-v3": ModelOverride(defaults={"cfg_scale": 9.0}),
                },
            ),
        )
        result = PromptBuilder.build_params(manifest, "kling-v3")
        assert result["cfg_scale"] == 9.0

    def test_user_params_merge_on_top_of_override(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["kling-v3"],
                default_model="kling-v3",
                defaults={"cfg_scale": 7.5},
                model_overrides={
                    "kling-v3": ModelOverride(defaults={"cfg_scale": 9.0}),
                },
            ),
        )
        result = PromptBuilder.build_params(manifest, "kling-v3", {"cfg_scale": 12.0})
        assert result["cfg_scale"] == 12.0

    def test_empty_user_params(self):
        manifest = make_manifest()
        result = PromptBuilder.build_params(manifest, "wan-2.2", None)
        assert result["cfg_scale"] == 7.5
        assert result["num_inference_steps"] == 30

    def test_unknown_model_returns_empty(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt="test",
                models=["unknown-model"],
                default_model="unknown-model",
                defaults={"cfg_scale": 7.5},
            ),
        )
        result = PromptBuilder.build_params(manifest, "unknown-model")
        assert result == {}

    def test_prompt_inputs_never_in_params(self):
        """Prompt input fields (style, camera_movement) must never appear in params."""
        manifest = make_manifest(
            inputs={
                "style": InputFieldSchema(
                    type="select", role="prompt_input", required=False, label="Style",
                    options=[SelectOption(value="particles", label="Particles")],
                    default="particles",
                ),
            },
        )
        result = PromptBuilder.build_params(manifest, "wan-2.2", {"style": "particles"})
        assert "style" not in result
