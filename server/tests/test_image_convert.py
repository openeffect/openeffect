"""Tests for `core.image_convert.ensure_mime` — the per-provider format
conversion shim used by providers before they upload each role's
image."""
from io import BytesIO
from pathlib import Path

import pytest
from PIL import Image

from core.image_convert import ensure_mime


def _png_path(tmp_path: Path, size: tuple[int, int] = (32, 32)) -> Path:
    p = tmp_path / "in.png"
    Image.new("RGB", size, color=(10, 20, 30)).save(p, format="PNG")
    return p


def _bmp_path(tmp_path: Path, size: tuple[int, int] = (40, 24)) -> Path:
    p = tmp_path / "in.bmp"
    Image.new("RGB", size, color=(50, 60, 70)).save(p, format="BMP")
    return p


def _cmyk_path(tmp_path: Path, size: tuple[int, int] = (16, 16)) -> Path:
    p = tmp_path / "in.tif"
    Image.new("CMYK", size, color=(0, 0, 0, 255)).save(p, format="TIFF")
    return p


class TestEnsureMime:
    def test_passes_through_when_mime_is_accepted(self, tmp_path):
        src = _png_path(tmp_path)
        out_path, is_temp = ensure_mime(src, "image/png", ("image/png", "image/jpeg"))
        assert out_path == src
        assert is_temp is False
        # Source file is untouched.
        assert src.exists()

    def test_match_is_case_insensitive(self, tmp_path):
        src = _png_path(tmp_path)
        out_path, is_temp = ensure_mime(src, "IMAGE/PNG", ("image/png",))
        assert out_path == src
        assert is_temp is False

    def test_unsupported_mime_converts_to_png(self, tmp_path):
        src = _bmp_path(tmp_path, size=(40, 24))
        out_path, is_temp = ensure_mime(src, "image/bmp", ("image/png", "image/jpeg"))
        try:
            assert out_path != src
            assert is_temp is True
            assert out_path.exists()
            assert out_path.suffix == ".png"
            with Image.open(out_path) as decoded:
                assert decoded.format == "PNG"
                assert decoded.size == (40, 24)
        finally:
            out_path.unlink(missing_ok=True)

    def test_cmyk_source_lands_as_rgb_png(self, tmp_path):
        """Pillow's PNG encoder rejects CMYK directly — the helper has
        to convert to RGB first. Without that, this would raise."""
        src = _cmyk_path(tmp_path)
        out_path, is_temp = ensure_mime(src, "image/tiff", ("image/png",))
        try:
            assert is_temp is True
            with Image.open(out_path) as decoded:
                # PNG mode is RGB or RGBA after the convert; never CMYK.
                assert decoded.mode in {"RGB", "RGBA"}
        finally:
            out_path.unlink(missing_ok=True)

    def test_empty_accepted_list_always_converts(self, tmp_path):
        src = _png_path(tmp_path)
        out_path, is_temp = ensure_mime(src, "image/png", ())
        try:
            assert is_temp is True
            assert out_path != src
            assert out_path.suffix == ".png"
        finally:
            out_path.unlink(missing_ok=True)

    def test_caller_owns_temp_cleanup(self, tmp_path):
        """The helper doesn't keep the temp file alive — once the
        caller unlinks it, it's gone. Sanity-check that the contract
        is "give caller a path, caller cleans up." """
        src = _bmp_path(tmp_path)
        out_path, is_temp = ensure_mime(src, "image/bmp", ("image/png",))
        assert is_temp is True
        assert out_path.exists()
        out_path.unlink()
        assert not out_path.exists()


class TestEnsureMimeIntegration:
    def test_real_jpeg_passes_through_fal_whitelist(self, tmp_path):
        """Smoke test against the actual FAL_IMAGE_MIMES tuple — the
        ergonomic case the FalProvider exercises on every run."""
        from services.model_service import FAL_IMAGE_MIMES

        # Write a real JPEG.
        src = tmp_path / "in.jpg"
        buf = BytesIO()
        Image.new("RGB", (8, 8), color=(255, 0, 0)).save(buf, format="JPEG")
        src.write_bytes(buf.getvalue())

        out_path, is_temp = ensure_mime(src, "image/jpeg", FAL_IMAGE_MIMES)
        assert out_path == src
        assert is_temp is False

    def test_real_bmp_converts_against_fal_whitelist(self, tmp_path):
        from services.model_service import FAL_IMAGE_MIMES

        src = _bmp_path(tmp_path)
        out_path, is_temp = ensure_mime(src, "image/bmp", FAL_IMAGE_MIMES)
        try:
            assert is_temp is True
            assert out_path.suffix == ".png"
        finally:
            out_path.unlink(missing_ok=True)


@pytest.mark.parametrize("mime,expected_pass_through", [
    ("image/jpeg", True),
    ("image/png", True),
    ("image/webp", True),
    ("image/gif", True),
    ("image/avif", True),
    ("image/bmp", False),
    ("image/tiff", False),
    ("image/heic", False),
])
def test_fal_whitelist_membership(mime, expected_pass_through, tmp_path):
    """Every fal-accepted mime passes through; everything else gets
    converted. This pins the FAL_IMAGE_MIMES contract from the model
    registry."""
    from services.model_service import FAL_IMAGE_MIMES

    # Use a PNG fixture — the helper only opens it on the convert path,
    # so a pass-through case never hits Pillow regardless of mime.
    src = _png_path(tmp_path)
    out_path, is_temp = ensure_mime(src, mime, FAL_IMAGE_MIMES)
    try:
        assert is_temp is (not expected_pass_through)
    finally:
        if is_temp:
            out_path.unlink(missing_ok=True)
