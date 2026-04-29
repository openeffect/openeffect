"""Image-format conversion shim used by providers before they upload
each role's image. The provider declares its accepted mime list (see
`accepted_image_mimes` in `services.model_service`). At dispatch time
the provider checks each input's mime against that list - pass-through
when supported, transcode to PNG when not."""

import os
import tempfile
from pathlib import Path

from PIL import Image


def ensure_mime(
    path: Path,
    mime: str,
    accepted_mimes: tuple[str, ...],
) -> tuple[Path, bool]:
    """Return `(path, False)` when `mime` is in `accepted_mimes` (case-
    insensitive) - the file passes through verbatim. Otherwise decode
    the file with Pillow and re-encode as PNG to a fresh temp file,
    returning `(tmp_path, True)`. Caller unlinks the temp file when
    done with it (typically inside a `try/finally` around the upload
    step that consumes the path).

    PNG is the universal landing format - every provider's whitelist
    includes `image/png`, so we never need a per-provider conversion
    target. Re-encoding to JPEG would be lossy and varies by source
    transparency; re-encoding to WebP is provider-dependent. CMYK
    sources are converted to RGB first because Pillow's PNG encoder
    rejects CMYK.
    """
    accepted_lower = {m.lower() for m in accepted_mimes}
    if mime.lower() in accepted_lower:
        return path, False

    fd, tmp_path = tempfile.mkstemp(suffix=".png")
    os.close(fd)
    with Image.open(path) as img:
        # CMYK isn't a valid PNG mode - convert to RGB first. Most
        # other modes (RGB, RGBA, L, LA, P) are PNG-encodable as-is.
        save_target = img.convert("RGB") if img.mode == "CMYK" else img
        save_target.save(tmp_path, format="PNG")
    return Path(tmp_path), True
