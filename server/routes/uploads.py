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
        ref_id, ext, original_filename, size_bytes = await storage.save_upload(
            file.filename or "", file, MAX_SIZE
        )
    except ValueError:
        raise HTTPException(status_code=413, detail={"error": "File too large", "code": "FILE_TOO_LARGE"})

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
        raise HTTPException(status_code=400, detail={"error": "Invalid path", "code": "BAD_REQUEST"})

    # Strip extension — it's cosmetic, we resolve by variant name
    variant_name = variant.rsplit(".", 1)[0] if "." in variant else variant
    if variant_name not in ("512", "2048", "original"):
        raise HTTPException(status_code=400, detail={"error": "Invalid variant", "code": "BAD_REQUEST"})

    storage = request.app.state.storage_service
    file_path = storage.get_upload_path(uuid, variant_name)
    if not file_path:
        raise HTTPException(status_code=404, detail={"error": "File not found", "code": "FILE_NOT_FOUND"})

    return FileResponse(file_path)
