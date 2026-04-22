"""Shared size caps for user-uploaded media, effect-package assets, and
provider-returned videos. Centralized so the upload route and the
effect-install flow can't drift."""

MAX_IMAGE_SIZE = 10 * 1024 * 1024    # 10 MB
MAX_VIDEO_SIZE = 50 * 1024 * 1024    # 50 MB

# Total payload any inbound request may commit to disk. Mainly relevant for
# the ZIP-installer path (many files extracted together).
MAX_TOTAL_SIZE = 100 * 1024 * 1024   # 100 MB

# Defensive cap on the result video streamed back from a provider; a
# compromised / buggy CDN could otherwise fill the data volume.
MAX_RESULT_VIDEO_SIZE = 200 * 1024 * 1024  # 200 MB

IMAGE_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
VIDEO_CONTENT_TYPES = {"video/mp4", "video/webm"}


def max_size_for_content_type(content_type: str) -> int:
    """Pick the right cap for a user upload based on its declared mime.
    Unknown types fall through to the image cap (conservative)."""
    if content_type in VIDEO_CONTENT_TYPES:
        return MAX_VIDEO_SIZE
    return MAX_IMAGE_SIZE
