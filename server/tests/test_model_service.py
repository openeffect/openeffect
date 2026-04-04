"""Tests for model compatibility filtering."""
import pytest
from services.model_service import get_compatible_model_ids, MODELS_BY_ID


class TestGetCompatibleModelIds:
    def test_text_only_returns_all_models(self):
        result = get_compatible_model_ids(set())
        # All models should be available for text-only effects
        assert len(result) == len(MODELS_BY_ID)

    def test_start_frame_only(self):
        result = get_compatible_model_ids({"start_frame"})
        # All current models support start_frame and none require end_frame
        assert len(result) > 0
        for model_id in result:
            model = MODELS_BY_ID[model_id]
            assert model["supports_start_frame"]
            assert model["supports_end_frame"] != "required"

    def test_end_frame_only(self):
        result = get_compatible_model_ids({"end_frame"})
        # Same as start_frame (we swap end→start + reverse)
        assert len(result) > 0
        for model_id in result:
            model = MODELS_BY_ID[model_id]
            assert model["supports_start_frame"]
            assert model["supports_end_frame"] != "required"

    def test_start_and_end_frame(self):
        result = get_compatible_model_ids({"start_frame", "end_frame"})
        # Only models supporting end_frame
        assert len(result) > 0
        for model_id in result:
            model = MODELS_BY_ID[model_id]
            assert model["supports_end_frame"] in ("optional", "required")

    def test_both_frames_excludes_no_end_frame_models(self):
        result = get_compatible_model_ids({"start_frame", "end_frame"})
        for model_id in result:
            model = MODELS_BY_ID[model_id]
            assert model["supports_end_frame"] != "none"

    def test_start_only_excludes_required_end_frame(self):
        # If any model requires both frames, it shouldn't appear for start-only
        result = get_compatible_model_ids({"start_frame"})
        for model_id in result:
            model = MODELS_BY_ID[model_id]
            assert model["supports_end_frame"] != "required"

    def test_known_models_present(self):
        """Verify our specific models appear in expected scenarios."""
        start_only = get_compatible_model_ids({"start_frame"})
        both = get_compatible_model_ids({"start_frame", "end_frame"})

        # WAN 2.2 supports end_frame optional → in both lists
        assert "wan-2.2" in start_only
        assert "wan-2.2" in both

        # WAN 2.6 has no end_frame → only in start_only
        assert "wan-2.6" in start_only
        assert "wan-2.6" not in both

        # Kling V3 has no end_frame → only in start_only
        assert "kling-v3" in start_only
        assert "kling-v3" not in both

        # Kling O3 supports end_frame optional → in both
        assert "kling-o3" in start_only
        assert "kling-o3" in both

    def test_returns_list_of_strings(self):
        result = get_compatible_model_ids({"start_frame"})
        assert isinstance(result, list)
        assert all(isinstance(m, str) for m in result)
