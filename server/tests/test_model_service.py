"""Tests for the model registry helpers."""
from services.model_service import (
    MODELS_BY_ID,
    canonical_to_wire,
    get_compatible_model_ids,
    get_provider,
    model_has_generate_audio,
    model_image_input_roles,
    model_input_required,
    model_supported_image_keys,
    provider_has_input,
)


class TestGetCompatibleModelIds:
    def test_start_frame_only(self):
        result = get_compatible_model_ids({"start_frame"})
        assert len(result) > 0
        for model_id in result:
            model = MODELS_BY_ID[model_id]
            assert "start_frame" in model_image_input_roles(model)
            assert not model_input_required(model, "end_frame")

    def test_end_frame_only(self):
        # end_frame alone is treated as start-only semantically; every model
        # that supports start_frame and doesn't require end_frame qualifies.
        result = get_compatible_model_ids({"end_frame"})
        assert len(result) > 0
        for model_id in result:
            model = MODELS_BY_ID[model_id]
            assert "start_frame" in model_image_input_roles(model)

    def test_start_and_end_frame(self):
        result = get_compatible_model_ids({"start_frame", "end_frame"})
        assert len(result) > 0
        for model_id in result:
            model = MODELS_BY_ID[model_id]
            assert "end_frame" in model_image_input_roles(model)

    def test_known_models_present(self):
        """Verify our specific models appear in expected scenarios."""
        start_only = get_compatible_model_ids({"start_frame"})
        both = get_compatible_model_ids({"start_frame", "end_frame"})

        # Wan 2.7 wires both roles on fal → in both lists
        assert "wan-2.7" in start_only
        assert "wan-2.7" in both

        # Kling 3.0 wires both roles on fal → in both lists
        assert "kling-3.0" in start_only
        assert "kling-3.0" in both

        # PixVerse V6's canonical declares end_frame, but its only provider
        # (fal) doesn't wire it — so pixverse-v6 is compatible with start-
        # only effects but excluded from start+end effects.
        assert "pixverse-v6" in start_only
        assert "pixverse-v6" not in both

    def test_pixverse_excluded_when_end_frame_required(self):
        """Regression: a model whose canonical declares a role but whose
        provider(s) don't wire it must not appear as compatible. Picking
        such a model would silently drop the user's uploaded image."""
        result = get_compatible_model_ids({"start_frame", "end_frame"})
        assert "pixverse-v6" not in result

    def test_returns_list_of_strings(self):
        result = get_compatible_model_ids({"start_frame"})
        assert isinstance(result, list)
        assert all(isinstance(m, str) for m in result)

    def test_optional_does_not_replace_required(self):
        """Required roles still constrain the compatibility check."""
        result = get_compatible_model_ids(
            {"start_frame", "end_frame"},
            optional_keys={"start_frame"},
        )
        # Wan supports both
        assert "wan-2.7" in result

    def test_optional_keys_none_equals_old_behavior(self):
        """Omitting optional_keys preserves the original signature."""
        assert get_compatible_model_ids({"start_frame"}) == get_compatible_model_ids(
            {"start_frame"}, optional_keys=None
        )


class TestGetProvider:
    def test_returns_full_provider_dict(self):
        provider = get_provider("wan-2.7", "fal")
        assert provider is not None
        assert provider["endpoint"] == "fal-ai/wan/v2.7/image-to-video"
        assert "inputs" in provider
        assert "params" in provider
        assert provider_has_input(provider, "start_frame")

    def test_unknown_model_returns_none(self):
        assert get_provider("bogus", "fal") is None

    def test_unknown_provider_returns_none(self):
        assert get_provider("kling-3.0", "replicate") is None


class TestProviderMaps:
    def test_wan27_fal_image_inputs(self):
        """Start/end frame canonical roles map to fal's wire keys."""
        provider = get_provider("wan-2.7", "fal")
        assert provider["inputs"]["start_frame"] == "image_url"
        assert provider["inputs"]["end_frame"] == "end_image_url"

    def test_kling_v3_fal_image_inputs(self):
        provider = get_provider("kling-3.0", "fal")
        assert provider["inputs"]["start_frame"] == "start_image_url"
        assert provider["inputs"]["end_frame"] == "end_image_url"

    def test_pixverse_v6_fal_image_inputs(self):
        """PixVerse v6 on fal's i2v doesn't support end_frame — only
        start_frame appears in the provider's inputs map."""
        provider = get_provider("pixverse-v6", "fal")
        assert provider["inputs"]["start_frame"] == "image_url"
        assert "end_frame" not in provider["inputs"]

    def test_pixverse_audio_wire_rename(self):
        """PixVerse wire key `generate_audio_switch` carries the
        `generate_audio` canonical."""
        provider = get_provider("pixverse-v6", "fal")
        assert provider["params"]["generate_audio"]["wire"] == "generate_audio_switch"


class TestModelImageInputs:
    def test_model_supported_image_keys(self):
        # Wan 2.7 declares start_frame + end_frame
        assert set(model_supported_image_keys(MODELS_BY_ID["wan-2.7"])) == {"start_frame", "end_frame"}
        # Kling 3.0 declares both
        assert set(model_supported_image_keys(MODELS_BY_ID["kling-3.0"])) == {"start_frame", "end_frame"}
        # PixVerse V6 declares both on the canonical; the fal provider's
        # pixverse endpoint wires only start_frame.
        assert set(model_supported_image_keys(MODELS_BY_ID["pixverse-v6"])) == {"start_frame", "end_frame"}

    def test_start_frame_is_required(self):
        for model_id in ("wan-2.7", "kling-3.0", "pixverse-v6"):
            assert model_input_required(MODELS_BY_ID[model_id], "start_frame")

    def test_end_frame_is_not_required(self):
        for model_id in ("wan-2.7", "kling-3.0", "pixverse-v6"):
            assert not model_input_required(MODELS_BY_ID[model_id], "end_frame")


class TestGenerateAudio:
    def test_models_with_audio(self):
        # Kling 3.0 and PixVerse V6 expose generate_audio as a canonical param
        assert model_has_generate_audio(MODELS_BY_ID["kling-3.0"])
        assert model_has_generate_audio(MODELS_BY_ID["pixverse-v6"])

    def test_models_without_audio(self):
        # Wan 2.7 does not expose an AI-audio toggle
        assert not model_has_generate_audio(MODELS_BY_ID["wan-2.7"])


class TestCanonicalToWire:
    def _apply(self, model_id: str, canonical: dict) -> dict:
        provider = get_provider(model_id, "fal")
        assert provider is not None
        return canonical_to_wire(MODELS_BY_ID[model_id], provider, canonical)

    def test_unknown_canonicals_are_dropped(self):
        """Canonicals the model doesn't declare pass through as wire keys
        (transform outputs)."""
        out = self._apply("kling-3.0", {"duration": 5, "unknown_knob": 42})
        assert out == {"duration": 5, "unknown_knob": 42}

    def test_image_role_renames_to_wire_key(self):
        """wan-2.7's canonical `start_frame` renames to fal's `image_url` wire
        key; the native `duration` canonical passes through unchanged."""
        out = self._apply("wan-2.7", {
            "start_frame": "https://x/y.jpg", "duration": 5,
        })
        assert out["image_url"] == "https://x/y.jpg"
        assert out["duration"] == 5

    def test_param_rename_via_provider_map(self):
        """PixVerse's generate_audio canonical renames to generate_audio_switch."""
        out = self._apply("pixverse-v6", {"generate_audio": True, "duration": 5})
        assert out == {"generate_audio_switch": True, "duration": 5}

    def test_self_named_wire_passes_through(self):
        """Kling v3's duration canonical has wire name == canonical."""
        out = self._apply("kling-3.0", {"duration": 5})
        assert out == {"duration": 5}

    def test_missing_provider_transform_ok(self):
        """A provider without a transform just does the rename step."""
        provider = get_provider("kling-3.0", "fal")
        assert "transform" not in provider
        # Canonical `guidance_scale` → wire `cfg_scale` for kling's fal API.
        out = self._apply("kling-3.0", {"guidance_scale": 0.7})
        assert out == {"cfg_scale": 0.7}

    def test_unsupported_canonical_dropped_silently(self):
        """A canonical that IS declared on the model but NOT on this provider
        (e.g. `style` on wan-2.7) gets silently dropped."""
        # style is a pixverse-v6 canonical; not declared on wan-2.7.
        # First verify style is not a wan canonical — so a manifest wouldn't
        # even validate with it. Test the silent-drop logic via a param that
        # IS in pixverse canonicals but not fal-pixverse's params.
        # aspect_ratio is a pixverse canonical, but omitted from fal's
        # pixverse provider params map → silent drop.
        out = self._apply("pixverse-v6", {"aspect_ratio": "16:9", "duration": 5})
        assert "aspect_ratio" not in out
        assert out["duration"] == 5


class TestClientParamsProviderOverrides:
    """Extra keys on `provider.params[name]` overlay the canonical entry
    in the client-facing payload; `wire` never leaks through."""

    def test_provider_override_wins_over_canonical(self):
        from services.model_service import _client_params_for

        model = {
            "id": "demo",
            "params": [
                {"name": "num_frames", "type": "number", "ui": "advanced",
                 "label": "Frames", "default": 49, "min": 16, "max": 128},
            ],
        }
        provider = {
            "params": {
                "num_frames": {"wire": "num_frames", "max": 256, "default": 96},
            },
        }
        out = _client_params_for(model, provider)
        assert len(out) == 1
        entry = out[0]
        assert entry["key"] == "num_frames"
        assert entry["max"] == 256        # provider override
        assert entry["default"] == 96     # provider override
        assert entry["min"] == 16         # canonical retained
        assert entry["label"] == "Frames"  # canonical retained
        assert "wire" not in entry        # wire stays server-side
        assert "name" not in entry        # renamed to `key`

    def test_no_override_keeps_canonical(self):
        from services.model_service import _client_params_for

        model = {
            "id": "demo",
            "params": [
                {"name": "duration", "type": "slider", "ui": "main",
                 "label": "Duration", "default": 5, "min": 3, "max": 10},
            ],
        }
        provider = {"params": {"duration": {"wire": "duration"}}}
        out = _client_params_for(model, provider)
        assert out[0]["default"] == 5
        assert out[0]["max"] == 10
