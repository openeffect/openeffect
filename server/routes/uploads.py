from fastapi import APIRouter, Request, HTTPException, UploadFile, File
from fastapi.responses import FileResponse

router = APIRouter()

ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif", "video/mp4", "video/webm"}
MAX_SIZE = 100 * 1024 * 1024  # 100MB


@router.post("/upload")
async def upload_file(request: Request, file: UploadFile = File(...)):
    if file.content_type and file.content_type not in ALLOWED_TYPES:
        raise HTTPException(status_code=415, detail={"error": "Unsupported media type", "code": "UNSUPPORTED_TYPE"})

    storage = request.app.state.storage_service
    try:
        hash_filename, original_filename, size_bytes = await storage.save_upload(
            file.filename or "", file, MAX_SIZE
        )
    except ValueError:
        raise HTTPException(status_code=413, detail={"error": "File too large", "code": "FILE_TOO_LARGE"})

    return {
        "ref_id": hash_filename,
        "filename": original_filename,
        "mime_type": file.content_type or "application/octet-stream",
        "size_bytes": size_bytes,
    }


@router.get("/uploads/{filename}")
async def get_upload(filename: str, request: Request):
    """Serve an uploaded file by its hash filename with path traversal protection."""
    # Path traversal protection: reject any path components
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail={"error": "Invalid filename", "code": "BAD_REQUEST"})

    storage = request.app.state.storage_service
    file_path = storage.get_upload_path(filename)

    if not file_path:
        raise HTTPException(status_code=404, detail={"error": "File not found", "code": "FILE_NOT_FOUND"})

    # Double-check the resolved path is within uploads dir
    try:
        file_path.resolve().relative_to(storage._uploads_dir.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail={"error": "Invalid filename", "code": "BAD_REQUEST"})

    return FileResponse(file_path)
