"""Tests for the model registry helpers."""
from services.model_service import (
    MODELS_BY_ID,
    canonical_key,
    canonical_to_wire,
    get_compatible_model_ids,
    get_provider_variant,
    get_provider_variant_params,
    model_has_generate_audio,
    model_supported_image_keys,
    model_variant_keys,
    pick_variant,
    variant_has_image_key,
    variant_image_key_required,
)


def _provider_variants(model_id: str):
    """All provider-variants of a model as a flat list."""
    out = []
    model = MODELS_BY_ID[model_id]
    for provider in model.get("providers", {}).values():
        for variant in provider.get("variants", {}).values():
            out.append(variant)
    return out


class TestGetCompatibleModelIds:
    # NOTE: with only `image_to_video` variants in the registry, an empty
    # input set matches zero models (every i2v requires `start_frame`). The
    # effect validator now enforces start_frame's presence, so that branch
    # can't fire in practice — no test for it here.

    def test_start_frame_only(self):
        result = get_compatible_model_ids({"start_frame"})
        assert len(result) > 0
        # At least one provider-variant of every returned model must support
        # start_frame and not require end_frame.
        for model_id in result:
            variants = _provider_variants(model_id)
            starts = [variant_has_image_key(v, "start_frame") for v in variants]
            end_requireds = [variant_image_key_required(v, "end_frame") for v in variants]
            assert any(starts)
            assert not all(end_requireds)

    def test_end_frame_only(self):
        result = get_compatible_model_ids({"end_frame"})
        assert len(result) > 0
        for model_id in result:
            variants = _provider_variants(model_id)
            starts = [variant_has_image_key(v, "start_frame") for v in variants]
            end_requireds = [variant_image_key_required(v, "end_frame") for v in variants]
            assert any(starts)
            assert not all(end_requireds)

    def test_start_and_end_frame(self):
        result = get_compatible_model_ids({"start_frame", "end_frame"})
        assert len(result) > 0
        for model_id in result:
            variants = _provider_variants(model_id)
            assert any(variant_has_image_key(v, "end_frame") for v in variants)

    def test_start_only_excludes_required_end_frame(self):
        result = get_compatible_model_ids({"start_frame"})
        for model_id in result:
            variants = _provider_variants(model_id)
            assert any(not variant_image_key_required(v, "end_frame") for v in variants)

    def test_known_models_present(self):
        """Verify our specific models appear in expected scenarios."""
        start_only = get_compatible_model_ids({"start_frame"})
        both = get_compatible_model_ids({"start_frame", "end_frame"})

        # WAN 2.2 image_to_video supports end_frame → in both lists
        assert "wan-2.2" in start_only
        assert "wan-2.2" in both

        # Kling V3 image_to_video supports end_frame → in both
        assert "kling-v3" in start_only
        assert "kling-v3" in both

        # Pixverse V6 image_to_video has no end_frame → only in start_only
        assert "pixverse-v6" in start_only
        assert "pixverse-v6" not in both

    def test_returns_list_of_strings(self):
        result = get_compatible_model_ids({"start_frame"})
        assert isinstance(result, list)
        assert all(isinstance(m, str) for m in result)

    def test_optional_does_not_replace_required(self):
        """Required roles still constrain: an effect that MUST have end_frame
        excludes models that don't support end_frame, even with optional."""
        result = get_compatible_model_ids(
            {"start_frame", "end_frame"},
            optional_keys={"start_frame"},
        )
        # PixVerse has no end_frame → excluded
        assert "pixverse-v6" not in result
        # WAN 2.2 supports both → included
        assert "wan-2.2" in result

    def test_optional_keys_none_equals_old_behavior(self):
        """Omitting optional_keys preserves the original signature."""
        assert get_compatible_model_ids({"start_frame"}) == get_compatible_model_ids(
            {"start_frame"}, optional_keys=None
        )


class TestPickVariant:
    def test_known_model_picks_image_to_video(self):
        assert pick_variant("wan-2.2", {"start_frame"}) == "image_to_video"
        assert pick_variant("kling-v3", {"start_frame"}) == "image_to_video"

    def test_empty_keys_still_picks_image_to_video(self):
        # Registry only has i2v — image_keys is effectively ignored today
        assert pick_variant("wan-2.2", set()) == "image_to_video"
        assert pick_variant("wan-2.2", None) == "image_to_video"

    def test_unknown_model_returns_none(self):
        assert pick_variant("does-not-exist", {"start_frame"}) is None


class TestGetProviderVariant:
    def test_returns_full_provider_variant_dict(self):
        pv = get_provider_variant("wan-2.2", "image_to_video", "fal")
        assert pv is not None
        assert pv["endpoint"] == "fal-ai/wan/v2.2-a14b/image-to-video"
        assert "params" in pv
        assert variant_has_image_key(pv, "start_frame")

    def test_unknown_variant_returns_none(self):
        assert get_provider_variant("wan-2.2", "video_to_video", "fal") is None

    def test_unknown_model_returns_none(self):
        assert get_provider_variant("bogus", "image_to_video", "fal") is None

    def test_unknown_provider_returns_none(self):
        assert get_provider_variant("kling-v3", "image_to_video", "replicate") is None


class TestGetProviderVariantParams:
    def test_image_to_video_params(self):
        params = get_provider_variant_params("wan-2.2", "image_to_video", "fal")
        # Role-carrying params live in canonical space; others are wire names
        # that happen to match canonical — the canonical_key helper abstracts over both.
        keys = {canonical_key(p) for p in params}
        assert "start_frame" in keys
        assert "end_frame" in keys
        assert "duration" in keys
        assert "aspect_ratio" in keys
        assert "guidance_scale" in keys
        assert "guidance_scale_2" in keys  # i2v-only
        assert "acceleration" in keys  # i2v-only

    def test_unknown_variant_returns_empty(self):
        assert get_provider_variant_params("wan-2.2", "bogus", "fal") == []

    def test_unknown_provider_returns_empty(self):
        assert get_provider_variant_params("wan-2.2", "image_to_video", "replicate") == []


class TestModelVariantKeys:
    def test_every_model_has_i2v(self):
        for m in MODELS_BY_ID.values():
            assert "image_to_video" in model_variant_keys(m)


class TestVariantImageHelpers:
    def test_image_keys_on_i2v(self):
        v = get_provider_variant("wan-2.2", "image_to_video", "fal")
        assert variant_has_image_key(v, "start_frame")
        assert variant_has_image_key(v, "end_frame")
        assert variant_image_key_required(v, "start_frame")
        assert not variant_image_key_required(v, "end_frame")

    def test_model_supported_image_keys(self):
        # WAN 2.2 has both start_frame and end_frame (via i2v)
        assert set(model_supported_image_keys(MODELS_BY_ID["wan-2.2"])) == {"start_frame", "end_frame"}
        # Kling V3 has both too
        assert set(model_supported_image_keys(MODELS_BY_ID["kling-v3"])) == {"start_frame", "end_frame"}
        # PixVerse V6 only has start_frame
        assert set(model_supported_image_keys(MODELS_BY_ID["pixverse-v6"])) == {"start_frame"}


class TestGenerateAudio:
    def test_models_with_audio(self):
        # Kling V3 and PixVerse V6 expose generate_audio
        assert model_has_generate_audio(MODELS_BY_ID["kling-v3"])
        assert model_has_generate_audio(MODELS_BY_ID["pixverse-v6"])

    def test_models_without_audio(self):
        # WAN 2.2 does not expose an AI-audio toggle
        assert not model_has_generate_audio(MODELS_BY_ID["wan-2.2"])


class TestRoleMappings:
    def test_wan22_i2v_image_roles(self):
        """WAN 2.2 i2v: wire keys `image_url` / `end_image_url` carry the
        `start_frame` / `end_frame` roles."""
        params = get_provider_variant_params("wan-2.2", "image_to_video", "fal")
        by_role = {p["role"]: p["key"] for p in params if "role" in p}
        assert by_role["start_frame"] == "image_url"
        assert by_role["end_frame"] == "end_image_url"

    def test_kling_v3_i2v_image_roles(self):
        """Kling v3 i2v: wire keys `start_image_url` / `end_image_url` carry
        the `start_frame` / `end_frame` roles; `generate_audio` is its own
        wire key and role."""
        params = get_provider_variant_params("kling-v3", "image_to_video", "fal")
        by_role = {p["role"]: p["key"] for p in params if "role" in p}
        assert by_role["start_frame"] == "start_image_url"
        assert by_role["end_frame"] == "end_image_url"
        assert by_role["generate_audio"] == "generate_audio"

    def test_pixverse_audio_role(self):
        """PixVerse wire key `generate_audio_switch` carries the `generate_audio` role."""
        params = get_provider_variant_params("pixverse-v6", "image_to_video", "fal")
        audio = next(p for p in params if p.get("role") == "generate_audio")
        assert audio["key"] == "generate_audio_switch"


class TestCanonicalToWire:
    def test_empty_params_passes_through(self):
        assert canonical_to_wire([], {"a": 1, "b": 2}) == {"a": 1, "b": 2}

    def test_params_without_role_pass_through(self):
        params = [
            {"key": "duration", "type": "slider"},
            {"key": "cfg_scale", "type": "slider"},
        ]
        out = canonical_to_wire(params, {"duration": 5, "cfg_scale": 0.7})
        assert out == {"duration": 5, "cfg_scale": 0.7}

    def test_role_renames_to_wire_key(self):
        params = [
            {"key": "image_url", "role": "start_frame", "type": "image"},
            {"key": "duration", "type": "slider"},
        ]
        out = canonical_to_wire(params, {"start_frame": "https://x/y.jpg", "duration": 5})
        assert out == {"image_url": "https://x/y.jpg", "duration": 5}

    def test_role_not_in_input_is_silently_skipped(self):
        """A param whose role isn't in the incoming dict doesn't crash."""
        params = [{"key": "tail_image_url", "role": "end_frame", "type": "image"}]
        out = canonical_to_wire(params, {"duration": 5})
        assert out == {"duration": 5}

    def test_mixed_renames(self):
        """Role-carrying params get renamed, plain wire params pass through."""
        params = [
            {"key": "image_url", "role": "start_frame", "type": "image"},
            {"key": "generate_audio_switch", "role": "generate_audio", "type": "boolean"},
            {"key": "resolution", "type": "select"},
        ]
        out = canonical_to_wire(params, {"start_frame": "u", "generate_audio": True, "resolution": "720p"})
        assert out == {"image_url": "u", "generate_audio_switch": True, "resolution": "720p"}

    def test_self_aliased_role_still_renames(self):
        """When `as` equals `key`, the rename is a no-op but stays valid."""
        params = [{"key": "start_frame", "role": "start_frame", "type": "image"}]
        out = canonical_to_wire(params, {"start_frame": "u"})
        assert out == {"start_frame": "u"}
