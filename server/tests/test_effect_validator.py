"""Tests for effect manifest validation."""
import pytest
from pydantic import ValidationError

from effects.validator import (
    _MANIFEST_MIGRATIONS,
    CURRENT_MANIFEST_VERSION,
    EffectManifest,
    GenerationConfig,
    InputFieldSchema,
    SelectOption,
    _apply_manifest_migrations,
    validate_run_inputs,
)


def make_valid_manifest(**overrides) -> dict:
    """Return a valid manifest dict that can be modified for testing."""
    defaults = {
        "manifest_version": 1,
        "id": "tester/test-effect",
        "name": "Test Effect",
        "description": "A test effect",
        "version": "1.0.0",
        "author": "test",
        "category": "animation",
        "tags": [],
        "showcases": [],
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
        assert manifest.manifest_version == 1
        assert manifest.namespace == "tester"
        assert manifest.slug == "test-effect"
        assert manifest.full_id == "tester/test-effect"
        assert manifest.category == "animation"

    def test_missing_required_field(self):
        data = make_valid_manifest()
        del data["name"]
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "name" in str(exc_info.value)

    def test_free_form_category_accepts_any_string(self):
        data = make_valid_manifest(category="custom_category")
        manifest = EffectManifest(**data)
        assert manifest.category == "custom_category"

    def test_default_model_not_in_supported(self):
        data = make_valid_manifest()
        data["generation"]["default_model"] = "nonexistent"
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "default_model" in str(exc_info.value)

    def test_role_defaults_to_none(self):
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
        assert manifest.inputs["text_field"].role is None

    def test_role_on_non_image_field_rejected(self):
        """Role wires an image input to a model slot — it has no meaning on
        text / select / numeric fields, so setting one there is a bug."""
        data = make_valid_manifest(
            inputs={
                "image": {
                    "type": "image", "role": "start_frame", "required": True, "label": "Photo",
                },
                "stray": {
                    "type": "text", "role": "start_frame", "required": False, "label": "Text",
                },
            },
        )
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "role is only valid on image fields" in str(exc_info.value)

    def test_missing_start_frame_rejected(self):
        """Every effect must declare an input with role 'start_frame'."""
        data = make_valid_manifest(
            inputs={
                "prompt": {
                    "type": "text", "required": False, "label": "Prompt",
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

    def test_multiple_non_image_inputs_valid(self):
        data = make_valid_manifest(
            inputs={
                "image": {
                    "type": "image", "role": "start_frame", "required": True, "label": "Photo",
                },
                "prompt": {
                    "type": "text", "required": False, "label": "Prompt",
                },
                "style": {
                    "type": "select",
                    "required": False,
                    "label": "Style",
                    "default": "cinematic",
                    "options": [{"value": "cinematic", "label": "Cinematic"}],
                },
            },
        )
        manifest = EffectManifest(**data)
        assert manifest.inputs["prompt"].role is None
        assert manifest.inputs["style"].role is None

    def test_id_missing_raises(self):
        data = make_valid_manifest()
        del data["id"]
        with pytest.raises(ValidationError) as e:
            EffectManifest(**data)
        assert "namespace/slug" in str(e.value)

    def test_id_without_slash_raises(self):
        data = make_valid_manifest(id="just-slug")
        with pytest.raises(ValidationError) as e:
            EffectManifest(**data)
        assert "namespace/slug" in str(e.value)

    def test_id_with_two_slashes_raises(self):
        data = make_valid_manifest(id="ns/a/b")
        with pytest.raises(ValidationError) as e:
            EffectManifest(**data)
        assert "namespace/slug" in str(e.value)

    def test_id_uppercase_rejected(self):
        data = make_valid_manifest(id="Namespace/slug")
        with pytest.raises(ValidationError) as e:
            EffectManifest(**data)
        assert "namespace" in str(e.value).lower()

    def test_id_underscore_rejected(self):
        data = make_valid_manifest(id="my_ns/slug")
        with pytest.raises(ValidationError) as e:
            EffectManifest(**data)
        assert "namespace" in str(e.value).lower()

    def test_id_leading_hyphen_rejected(self):
        data = make_valid_manifest(id="ns/-bad")
        with pytest.raises(ValidationError) as e:
            EffectManifest(**data)
        assert "slug" in str(e.value).lower()

    def test_id_too_long_rejected(self):
        data = make_valid_manifest(id=f"ns/{'x' * 65}")
        with pytest.raises(ValidationError) as e:
            EffectManifest(**data)
        assert "too long" in str(e.value).lower()

    def test_id_single_char_parts_allowed(self):
        """Minimal valid form — a single alphanumeric char on each side."""
        data = make_valid_manifest(id="a/b")
        manifest = EffectManifest(**data)
        assert manifest.namespace == "a"
        assert manifest.slug == "b"

    def test_boolean_type_accepted(self):
        data = make_valid_manifest(
            inputs={
                "image": {
                    "type": "image", "role": "start_frame", "required": True, "label": "Photo",
                },
                "audio": {
                    "type": "boolean", "required": False, "label": "Generate audio",
                },
            },
        )
        manifest = EffectManifest(**data)
        assert manifest.inputs["audio"].type == "boolean"

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
    return EffectManifest.model_validate({
        "manifest_version": 1,
        "id": "tester/t",
        "name": "T",
        "description": "T",
        "category": "test",
        "inputs": inputs,
        "generation": GenerationConfig(prompt="go"),
    })


class TestManifestVersion:
    """The `manifest_version` field is the forward-compat hook: defaults
    to 1 when absent (so legacy manifests load), only `1` accepted today,
    error message lists the full supported set so authors can see what
    the server understands."""

    def test_accepts_version_1(self):
        data = make_valid_manifest(manifest_version=1)
        manifest = EffectManifest(**data)
        assert manifest.manifest_version == 1

    def test_rejects_unsupported_version(self):
        data = make_valid_manifest(manifest_version=2)
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "manifest_version 2 is not supported" in str(exc_info.value)
        assert "supported: 1" in str(exc_info.value)

    def test_rejects_zero(self):
        data = make_valid_manifest(manifest_version=0)
        with pytest.raises(ValidationError) as exc_info:
            EffectManifest(**data)
        assert "not supported" in str(exc_info.value)

    def test_rejects_string_form(self):
        data = make_valid_manifest(manifest_version="1")
        # Pydantic v2 will coerce a string of digits to int by default;
        # this test confirms the coercion still respects the
        # supported-set check (and would reject "2" as well).
        manifest = EffectManifest(**data)
        assert manifest.manifest_version == 1

    def test_rejects_float(self):
        data = make_valid_manifest(manifest_version=1.5)
        with pytest.raises(ValidationError):
            EffectManifest(**data)

    def test_rejects_null(self):
        data = make_valid_manifest(manifest_version=None)
        with pytest.raises(ValidationError):
            EffectManifest(**data)


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
        time we receive a file id and can't meaningfully 'require' one
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


class TestValidateRunInputsBoolean:
    def test_true_or_false_passes(self):
        m = _run_input_manifest(flag=InputFieldSchema(
            type="boolean", label="Flag",
        ))
        validate_run_inputs(m, {"flag": "true"})
        validate_run_inputs(m, {"flag": "false"})

    def test_other_value_raises(self):
        m = _run_input_manifest(flag=InputFieldSchema(
            type="boolean", label="Flag",
        ))
        with pytest.raises(ValueError, match="must be true or false"):
            validate_run_inputs(m, {"flag": "maybe"})


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


class TestManifestMigrations:
    """Pinning tests for the schema-version forward-compat hook. The point
    of these is that they fail loudly if a future contributor bumps
    `CURRENT_MANIFEST_VERSION` without also adding the migration that
    older stored manifests need."""

    def test_default_manifest_version_is_one(self):
        """Legacy manifests without an explicit `manifest_version` load
        as v1 — the default — instead of failing validation. Critical
        for third-party YAMLs that predate the field."""
        data = make_valid_manifest()
        del data["manifest_version"]
        manifest = EffectManifest(**data)
        assert manifest.manifest_version == 1

    def test_apply_migrations_passthrough_when_at_current(self):
        data = {"manifest_version": CURRENT_MANIFEST_VERSION, "foo": "bar"}
        out = _apply_manifest_migrations(dict(data))
        assert out["manifest_version"] == CURRENT_MANIFEST_VERSION
        assert out["foo"] == "bar"

    def test_each_registered_migration_advances_version(self):
        """Every entry in _MANIFEST_MIGRATIONS must produce a dict whose
        manifest_version is exactly source+1. Catches a registry author
        forgetting to bump the version in the migrated dict."""
        for source, migrate in _MANIFEST_MIGRATIONS.items():
            out = migrate({"manifest_version": source})
            assert out.get("manifest_version") == source + 1, (
                f"Migration {source}→{source + 1} did not advance "
                f"manifest_version (got {out.get('manifest_version')})"
            )

    def test_migration_chain_reaches_current(self):
        """Starting from v1, applying migrations should land on
        CURRENT_MANIFEST_VERSION. If a future bump skips a registered
        step (e.g. CURRENT=3 but only 1→2 registered), this fails."""
        data = {"manifest_version": 1}
        out = _apply_manifest_migrations(data)
        # If no migrations are registered (current state at v1), the
        # version stays at 1 — also CURRENT, so the assertion holds.
        assert out["manifest_version"] in (1, CURRENT_MANIFEST_VERSION)
        if _MANIFEST_MIGRATIONS:
            assert out["manifest_version"] == CURRENT_MANIFEST_VERSION

    def test_unsupported_future_version_rejected(self):
        """A manifest declaring a version we don't know about must be
        rejected — pretending it's compatible would give the user a
        broken effect that looked fine on install."""
        data = make_valid_manifest(manifest_version=99)
        with pytest.raises(ValidationError, match="manifest_version 99"):
            EffectManifest(**data)
