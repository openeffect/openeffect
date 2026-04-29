"""Tests for the canonical FileRef API schema and its builder."""
from schemas.file_ref import build_file_ref


class TestBuildFileRef:
    def test_image_returns_both_thumbnail_tiers(self):
        ref = build_file_ref(
            id="abc-123", kind="image", mime="image/png",
            ext="png", size=12345,
        )
        assert ref.id == "abc-123"
        assert ref.kind == "image"
        assert ref.mime == "image/png"
        assert ref.size == 12345
        assert ref.url == "/api/files/abc-123/original.png"
        assert ref.thumbnails == {
            "512":  "/api/files/abc-123/512.webp",
            "1024": "/api/files/abc-123/1024.webp",
        }

    def test_video_returns_poster_thumbnail_tiers(self):
        """Videos store the actual mp4 as `original.{ext}` plus poster
        frames at `512.webp` and `1024.webp`. The thumbnail map is
        keyed by size, not by what's behind the URL."""
        ref = build_file_ref(
            id="vid-001", kind="video", mime="video/mp4",
            ext="mp4", size=987654,
        )
        assert ref.url == "/api/files/vid-001/original.mp4"
        assert ref.thumbnails == {
            "512":  "/api/files/vid-001/512.webp",
            "1024": "/api/files/vid-001/1024.webp",
        }

    def test_other_kind_has_no_thumbnails(self):
        """`other`-kind files (we don't have any today, but the
        `kind` column is open) get only the original."""
        ref = build_file_ref(
            id="raw-1", kind="other", mime="application/octet-stream",
            ext="bin", size=42,
        )
        assert ref.url == "/api/files/raw-1/original.bin"
        assert ref.thumbnails == {}

    def test_url_uses_literal_extension(self):
        """Extension flows through unchanged - no canonicalization to
        a generic `.bin`. The downstream `GET /api/files/{id}/{name}`
        looks up the literal filename on disk."""
        for ext in ("jpg", "jpeg", "png", "webp", "gif", "mp4", "webm"):
            ref = build_file_ref(
                id="x", kind="image" if ext in ("jpg", "jpeg", "png", "webp", "gif") else "video",
                mime=f"image/{ext}" if ext != "mp4" else "video/mp4",
                ext=ext, size=1,
            )
            assert ref.url == f"/api/files/x/original.{ext}"
