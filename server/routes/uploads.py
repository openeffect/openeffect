from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import FileResponse

from core.limits import (
    IMAGE_CONTENT_TYPES,
    VIDEO_CONTENT_TYPES,
    max_size_for_content_type,
)
from routes._errors import ErrorCode, bad_request, not_found, payload_too_large, unsupported_type

router = APIRouter()

ALLOWED_TYPES = IMAGE_CONTENT_TYPES | VIDEO_CONTENT_TYPES
SNIFF_SIZE = 16  # bytes needed to verify the magic signatures below


def _sniff_matches(head: bytes, claimed: str) -> bool:
    """Verify the first few bytes of `head` match what `claimed` promises.

    A client can otherwise upload HTML with `Content-Type: image/png`; the
    server stores it, and FileResponse later serves it with a media-type
    inferred from the extension — the browser happily renders it. Magic
    byte sniffing catches the mismatch before we store anything.
    """
    if claimed == "image/jpeg":
        return head.startswith(b"\xff\xd8\xff")
    if claimed == "image/png":
        return head.startswith(b"\x89PNG\r\n\x1a\n")
    if claimed == "image/gif":
        return head.startswith(b"GIF87a") or head.startswith(b"GIF89a")
    if claimed == "image/webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if claimed == "video/mp4":
        return head[4:8] == b"ftyp"
    if claimed == "video/webm":
        return head.startswith(b"\x1a\x45\xdf\xa3")
    return False


@router.post("/upload")
async def upload_file(request: Request, file: UploadFile = File(...)):
    # Reject empty / unsupported content-type outright. Empty bypassed the
    # old `if file.content_type and ...` guard and let any bytes through.
    if not file.content_type or file.content_type not in ALLOWED_TYPES:
        raise unsupported_type("Unsupported media type")

    # Peek the magic bytes, then rewind so save_upload sees the full stream
    head = await file.read(SNIFF_SIZE)
    await file.seek(0)
    if not _sniff_matches(head, file.content_type):
        raise unsupported_type("File contents don't match the declared media type")

    storage = request.app.state.storage_service
    try:
        ref_id, ext, original_filename, size_bytes = await storage.save_upload(
            file.filename or "", file, max_size_for_content_type(file.content_type),
        )
    except ValueError:
        raise payload_too_large("File too large")

    return {
        "ref_id": ref_id,
        "filename": original_filename,
        "mime_type": file.content_type or "application/octet-stream",
        "size_bytes": size_bytes,
        "thumbnails": {
            "512": f"/api/uploads/{ref_id}/512.{ext}",
            "2048": f"/api/uploads/{ref_id}/2048.{ext}",
        },
    }


@router.get("/uploads/{uuid}/{variant}")
async def get_upload(uuid: str, variant: str, request: Request):
    """Serve an uploaded file variant by UUID. variant = '512.jpg', '2048.png', 'original.webp', etc."""
    # Path traversal protection
    if ".." in uuid or "/" in uuid or "\\" in uuid:
        raise bad_request("Invalid path")

    # Strip extension — it's cosmetic, we resolve by variant name
    variant_name = variant.rsplit(".", 1)[0] if "." in variant else variant
    if variant_name not in ("512", "2048", "original"):
        raise bad_request("Invalid variant")

    storage = request.app.state.storage_service
    file_path = storage.get_upload_path(uuid, variant_name)
    if not file_path:
        raise not_found("File not found", ErrorCode.FILE_NOT_FOUND)

    # nosniff, not `Content-Disposition: attachment` — the UI renders
    # thumbnails via inline <img src="...">, which Firefox would block
    # under `attachment`.
    return FileResponse(file_path, headers={"X-Content-Type-Options": "nosniff"})
