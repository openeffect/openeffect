"""Tests for PromptBuilder - build_prompt() and build_params() separately."""
import pytest
from effects.prompt_builder import PromptBuilder
from effects.validator import (
    EffectManifest,
    InputFieldSchema,
    SelectOption,
    Assets,
    OutputConfig,
    GenerationConfig,
    ModelOverride,
    AdvancedParameter,
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
        "category": "test",
        "tags": [],
        "assets": Assets(thumbnail="thumbnail.jpg"),
        "inputs": {
            "image": InputFieldSchema(type="image", required=True, label="Photo", role="start_frame"),
            "prompt": InputFieldSchema(type="text", required=False, label="Prompt", role="prompt_input", placeholder="Describe...", max_length=300, multiline=False),
        },
        "output": OutputConfig(
            default_aspect_ratio="9:16",
            default_duration=5,
        ),
        "generation": GenerationConfig(
            prompt_template="A cinematic shot. {prompt} High quality.",
            negative_prompt="low quality, blurry",
            supported_models=["wan-2.2", "kling-v3"],
            default_model="wan-2.2",
            parameters={"guidance_scale": 7.5, "num_inference_steps": 30},
            model_overrides={},
            advanced_parameters=[],
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
                "image": InputFieldSchema(type="image", required=True, label="Photo", role="start_frame"),
                "mood": InputFieldSchema(type="text", required=False, label="Mood", role="prompt_input", max_length=100, multiline=False),
            },
            generation=GenerationConfig(
                prompt_template="Shot with {mood} mood. High quality.",
                supported_models=["wan-2.2"],
                default_model="wan-2.2",
                parameters={},
            ),
        )
        result = PromptBuilder.build_prompt(manifest, "wan-2.2", {"mood": "dramatic"})
        assert "dramatic" in result
        assert "{mood}" not in result

    def test_select_field_uses_label_not_value(self):
        manifest = make_manifest(
            inputs={
                "style": InputFieldSchema(
                    type="select",
                    required=False,
                    label="Style",
                    role="prompt_input",
                    default="particles",
                    options=[
                        SelectOption(value="particles", label="Particles"),
                        SelectOption(value="liquid", label="Liquid Flow"),
                    ],
                ),
            },
            generation=GenerationConfig(
                prompt_template="Cinematic {style} transition.",
                supported_models=["wan-2.2"],
                default_model="wan-2.2",
                parameters={},
            ),
        )
        result = PromptBuilder.build_prompt(manifest, "wan-2.2", {"style": "liquid"})
        assert "Liquid Flow" in result
        assert "liquid" not in result.lower().replace("liquid flow", "")

    def test_model_override_uses_different_template(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt_template="Default template. {prompt}",
                supported_models=["wan-2.2", "kling-v3"],
                default_model="wan-2.2",
                parameters={},
                model_overrides={
                    "kling-v3": ModelOverride(prompt_template="Kling template. {prompt}"),
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
                prompt_template="Shot with {unknown_field} effect.",
                supported_models=["wan-2.2"],
                default_model="wan-2.2",
                parameters={},
            ),
        )
        result = PromptBuilder.build_prompt(manifest, "wan-2.2", {})
        assert "{unknown_field}" not in result
        assert "  " not in result

    def test_multiple_consecutive_spaces_collapsed(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt_template="Start  {prompt}   end.",
                supported_models=["wan-2.2"],
                default_model="wan-2.2",
                parameters={},
            ),
        )
        result = PromptBuilder.build_prompt(manifest, "wan-2.2", {"prompt": ""})
        assert "  " not in result


# -----------------------------------------
# build_params() tests
# -----------------------------------------

class TestBuildParams:
    def test_unknown_key_in_defaults_filtered(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt_template="test",
                supported_models=["wan-2.2"],
                default_model="wan-2.2",
                parameters={"guidance_scale": 7.5, "unknown_param": 42},
            ),
        )
        result = PromptBuilder.build_params(manifest, "wan-2.2")
        assert "guidance_scale" in result
        assert "unknown_param" not in result

    def test_unknown_key_in_user_params_filtered(self):
        manifest = make_manifest()
        result = PromptBuilder.build_params(manifest, "wan-2.2", {"guidance_scale": 8.0, "fake_key": 99})
        assert result["guidance_scale"] == 8.0
        assert "fake_key" not in result

    def test_model_override_merges_on_top(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt_template="test",
                supported_models=["wan-2.2", "kling-v3"],
                default_model="wan-2.2",
                parameters={"guidance_scale": 7.5},
                model_overrides={
                    "kling-v3": ModelOverride(parameters={"guidance_scale": 9.0}),
                },
            ),
        )
        result = PromptBuilder.build_params(manifest, "kling-v3")
        assert result["guidance_scale"] == 9.0

    def test_user_params_merge_on_top_of_override(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt_template="test",
                supported_models=["kling-v3"],
                default_model="kling-v3",
                parameters={"guidance_scale": 7.5},
                model_overrides={
                    "kling-v3": ModelOverride(parameters={"guidance_scale": 9.0}),
                },
            ),
        )
        result = PromptBuilder.build_params(manifest, "kling-v3", {"guidance_scale": 12.0})
        assert result["guidance_scale"] == 12.0

    def test_empty_user_params(self):
        manifest = make_manifest()
        result = PromptBuilder.build_params(manifest, "wan-2.2", None)
        assert result["guidance_scale"] == 7.5
        assert result["num_inference_steps"] == 30

    def test_unknown_model_returns_empty(self):
        manifest = make_manifest(
            generation=GenerationConfig(
                prompt_template="test",
                supported_models=["unknown/model"],
                default_model="unknown/model",
                parameters={"guidance_scale": 7.5},
            ),
        )
        result = PromptBuilder.build_params(manifest, "unknown/model")
        assert result == {}

    def test_prompt_inputs_never_in_params(self):
        """Prompt input fields (style, camera_movement) must never appear in params."""
        manifest = make_manifest(
            inputs={
                "style": InputFieldSchema(
                    type="select", required=False, label="Style", role="prompt_input", default="particles",
                    options=[SelectOption(value="particles", label="Particles")],
                ),
            },
        )
        result = PromptBuilder.build_params(manifest, "wan-2.2", {"style": "particles"})
        assert "style" not in result
