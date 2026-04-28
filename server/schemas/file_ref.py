"""Canonical API representation of a file in the content-addressed store.

Every endpoint that exposes a file reference returns this shape. Clients
read `url` for the original bytes or `thumbnails["512"]` /
`thumbnails["1024"]` for image/video thumbnails — no client ever
composes a `/api/files/...` URL by string concat.

Thumbnails are derived from `kind`, not stored: image and video both
get the two webp tiers (videos store a poster frame at each tier),
`other` gets none. See `services.file_service._generate_thumbnails`.
"""
from typing import Literal

from pydantic import BaseModel

from services.file_service import File, FileKind


class FileRef(BaseModel):
    id: str
    kind: Literal["image", "video", "other"]
    mime: str
    size: int
    url: str
    thumbnails: dict[str, str] = {}


def build_file_ref(
    *, id: str, kind: FileKind, mime: str, ext: str, size: int,
) -> FileRef:
    """Compose a `FileRef` from the fields stored on a `files` row."""
    url = f"/api/files/{id}/original.{ext}"
    if kind in ("image", "video"):
        thumbnails = {
            "512":  f"/api/files/{id}/512.webp",
            "1024": f"/api/files/{id}/1024.webp",
        }
    else:
        thumbnails = {}
    return FileRef(
        id=id, kind=kind, mime=mime, size=size,
        url=url, thumbnails=thumbnails,
    )


def file_to_ref(file: File) -> FileRef:
    """Convenience adapter for the common case where the caller already
    has the `File` dataclass returned by `FileService` / loader cache."""
    return build_file_ref(
        id=file.id, kind=file.kind, mime=file.mime,
        ext=file.ext, size=file.size,
    )
