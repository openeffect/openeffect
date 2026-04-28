from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import FileResponse

from core.limits import (
    IMAGE_CONTENT_TYPES,
    VIDEO_CONTENT_TYPES,
    max_size_for_content_type,
)
from core.media_sniff import SNIFF_SIZE, sniff_matches
from routes._errors import (
    ErrorCode,
    bad_request,
    not_found,
    payload_too_large,
    unsupported_type,
)
from schemas.file_ref import FileRef, file_to_ref
from services.file_service import FileTooLargeError, UnreadableMediaError

router = APIRouter()

ALLOWED_TYPES = IMAGE_CONTENT_TYPES | VIDEO_CONTENT_TYPES


@router.post("/files", response_model=FileRef)
async def upload_file(request: Request, file: UploadFile = File(...)) -> FileRef:
    """Multipart upload → content-addressed file row. Streams to disk
    with hashing as it goes, dedupes against existing rows by hash, and
    returns a canonical `FileRef`. The hash is intentionally not exposed
    — exposing it would let an attacker probe the server for known
    content."""
    # Reject empty / unsupported content-type outright. Empty bypassed the
    # old `if file.content_type and ...` guard and let any bytes through.
    if not file.content_type or file.content_type not in ALLOWED_TYPES:
        raise unsupported_type("Unsupported media type")

    # Peek the magic bytes, then rewind so add_file sees the full stream.
    head = await file.read(SNIFF_SIZE)
    await file.seek(0)
    if not sniff_matches(head, file.content_type):
        raise unsupported_type("File contents don't match the declared media type")

    files = request.app.state.file_service
    kind = "video" if file.content_type in VIDEO_CONTENT_TYPES else "image"

    try:
        result = await files.add_file(
            file,
            kind=kind,
            mime=file.content_type,
            max_size=max_size_for_content_type(file.content_type),
        )
    except FileTooLargeError:
        raise payload_too_large("File too large")
    except UnreadableMediaError as e:
        # Pillow / ffmpeg refused — corrupt bytes, unsupported codec, etc.
        raise bad_request(f"Could not process file: {e}", ErrorCode.INVALID_REQUEST)

    return file_to_ref(result)


@router.get("/files/{file_id}/{filename}")
async def get_file(file_id: str, filename: str, request: Request):
    """Serve a single variant by exact filename. URL == filename — no
    server-side fallback / "best variant" logic. The blob's `variants`
    list (returned at upload time and embedded into payloads via the
    loader cache) tells the client what's available."""
    files = request.app.state.file_service
    file_path = files.get_file_path(file_id, filename)
    if not file_path:
        raise not_found("File not found", ErrorCode.FILE_NOT_FOUND)

    # nosniff, not `Content-Disposition: attachment` — the UI renders
    # thumbnails via inline <img src="...">, which Firefox would block
    # under `attachment`.
    return FileResponse(file_path, headers={"X-Content-Type-Options": "nosniff"})
