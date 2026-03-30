import uuid
from fastapi import APIRouter, Request, HTTPException, UploadFile, File

router = APIRouter()

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm"}
MAX_SIZE = 100 * 1024 * 1024  # 100MB


@router.post("/upload")
async def upload_file(request: Request, file: UploadFile = File(...)):
    if file.content_type and file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail={"error": "Unsupported media type", "code": "UNSUPPORTED_TYPE"})

    content = await file.read()
    if len(content) > MAX_SIZE:
        raise HTTPException(status_code=413, detail={"error": "File too large", "code": "FILE_TOO_LARGE"})

    storage = request.app.state.storage_service
    ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "jpg"
    ref_id = str(uuid.uuid4())
    filename = f"{ref_id}.{ext}"

    await storage.save(filename, content)

    return {
        "ref_id": ref_id,
        "filename": file.filename or filename,
        "mime_type": file.content_type or "application/octet-stream",
        "size_bytes": len(content),
    }
