import uuid
from fastapi import APIRouter, Request, HTTPException, UploadFile, File

router = APIRouter()

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm"}
MAX_SIZE = 100 * 1024 * 1024  # 100MB


@router.post("/upload")
async def upload_file(request: Request, file: UploadFile = File(...)):
    if file.content_type and file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail={"error": "Unsupported media type", "code": "UNSUPPORTED_TYPE"})

    # Extract extension safely — only alphanumeric, no path components
    ext = "jpg"
    if file.filename and "." in file.filename:
        raw_ext = file.filename.rsplit(".", 1)[-1]
        sanitized = "".join(c for c in raw_ext if c.isalnum())
        if sanitized:
            ext = sanitized[:10]

    ref_id = str(uuid.uuid4())
    filename = f"{ref_id}.{ext}"

    storage = request.app.state.storage_service
    try:
        _, size_bytes = await storage.save_upload(filename, file, MAX_SIZE)
    except ValueError:
        raise HTTPException(status_code=413, detail={"error": "File too large", "code": "FILE_TOO_LARGE"})

    return {
        "ref_id": ref_id,
        "filename": file.filename or filename,
        "mime_type": file.content_type or "application/octet-stream",
        "size_bytes": size_bytes,
    }
