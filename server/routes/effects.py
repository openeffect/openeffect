import io
import os
import zipfile
from pathlib import Path

from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from routes._errors import ErrorCode, bad_request, conflict, not_found
from services.install_service import InstallConflictError
from services.model_service import get_compatible_model_ids

router = APIRouter()


class InstallUrlRequest(BaseModel):
    url: str


class SaveEffectRequest(BaseModel):
    yaml_content: str
    effect_id: str | None = None  # null = new effect
    fork_from: str | None = None  # namespace/id to copy assets from


class RenameAssetRequest(BaseModel):
    new_name: str


def _serialize_effect(loaded) -> dict:
    """Serialize a LoadedEffect with pre-resolved asset URLs."""
    data = loaded.manifest.model_dump()
    uuid = Path(loaded.assets_dir).name

    # Pre-resolve asset URLs. Only image-typed inputs get URL-prefixed —
    # text inputs carry literal sample content, not a filename.
    if data.get("assets"):
        if data["assets"].get("preview"):
            data["assets"]["preview"] = f"/api/effects/assets/{uuid}/{data['assets']['preview']}"
        if data["assets"].get("inputs"):
            resolved: dict[str, str] = {}
            for key, value in data["assets"]["inputs"].items():
                schema = loaded.manifest.inputs.get(key)
                if schema and schema.type == "image":
                    resolved[key] = f"/api/effects/assets/{uuid}/{value}"
                else:
                    resolved[key] = value
            data["assets"]["inputs"] = resolved

    # Compute compatible models from input roles
    input_roles = set()
    for field in loaded.manifest.inputs.values():
        if field.type == "image" and field.role in ("start_frame", "end_frame"):
            input_roles.add(field.role)
    compatible = get_compatible_model_ids(input_roles)

    # If manifest explicitly lists models, intersect to limit the selection
    manifest_models = loaded.manifest.generation.models
    if manifest_models:
        compatible = [m for m in compatible if m in manifest_models]

    data["compatible_models"] = compatible

    data["source"] = loaded.source
    data["db_id"] = loaded.db_id
    data["is_favorite"] = loaded.is_favorite
    return data


@router.get("/effects")
async def list_effects(request: Request):
    loader = request.app.state.effect_loader
    effects = loader.get_all_with_meta()
    return {"effects": [_serialize_effect(e) for e in effects]}


@router.get("/effects/assets/{uuid}/{filename}")
async def get_effect_asset(uuid: str, filename: str, request: Request):
    loader = request.app.state.effect_loader
    asset_path = loader.get_asset_path(uuid, filename)
    if not asset_path:
        raise not_found("Asset not found", ErrorCode.ASSET_NOT_FOUND)
    return FileResponse(asset_path)


@router.get("/effects/{namespace}/{effect_id}")
async def get_effect(namespace: str, effect_id: str, request: Request):
    loader = request.app.state.effect_loader
    full_id = f"{namespace}/{effect_id}"
    loaded = loader.get_loaded(full_id)
    if not loaded:
        raise not_found("Effect not found", ErrorCode.EFFECT_NOT_FOUND)
    return _serialize_effect(loaded)


@router.post("/effects/install")
async def install_effect(
    request: Request,
    overwrite: bool = False,
    body: InstallUrlRequest | None = None,
    file: UploadFile | None = File(None),
):
    install_service = request.app.state.install_service
    loader = request.app.state.effect_loader

    try:
        if body and body.url:
            installed = await install_service.install_from_url(body.url, overwrite=overwrite)
        elif file and file.filename:
            content = await file.read()
            installed = await install_service.install_from_archive(content, overwrite=overwrite)
        else:
            raise bad_request("Provide url or file", ErrorCode.INVALID_REQUEST)

        await loader.reload()
        return {"installed": installed}
    except InstallConflictError as e:
        raise conflict("Already installed", ErrorCode.INSTALL_CONFLICT, conflicts=e.conflicts)
    except ValueError as e:
        raise bad_request(str(e), ErrorCode.INSTALL_ERROR)


class FavoriteRequest(BaseModel):
    favorite: bool


class EditableRequest(BaseModel):
    editable: bool


@router.patch("/effects/{namespace}/{effect_id}/editable")
async def toggle_editable(namespace: str, effect_id: str, body: EditableRequest, request: Request):
    install_service = request.app.state.install_service
    loader = request.app.state.effect_loader

    try:
        await install_service.set_editable(namespace, effect_id, body.editable)
    except ValueError as e:
        msg = str(e)
        if "not found" in msg:
            raise not_found(msg)
        raise bad_request(msg, ErrorCode.OFFICIAL_READONLY)

    await loader.reload()
    return {"ok": True, "editable": body.editable}


@router.patch("/effects/{namespace}/{effect_id}/favorite")
async def toggle_favorite(namespace: str, effect_id: str, body: FavoriteRequest, request: Request):
    install_service = request.app.state.install_service
    loader = request.app.state.effect_loader

    try:
        await install_service.set_favorite(namespace, effect_id, body.favorite)
    except ValueError as e:
        raise not_found(str(e))

    await loader.reload()
    return {"ok": True, "is_favorite": body.favorite}


@router.delete("/effects/{namespace}/{effect_id}")
async def uninstall_effect(namespace: str, effect_id: str, request: Request):
    install_service = request.app.state.install_service
    loader = request.app.state.effect_loader

    try:
        await install_service.uninstall(namespace, effect_id)
        await loader.reload()
        return {"ok": True}
    except ValueError as e:
        raise bad_request(str(e), ErrorCode.UNINSTALL_ERROR)


@router.post("/effects/{namespace}/{effect_id}/update")
async def update_effect(namespace: str, effect_id: str, request: Request):
    install_service = request.app.state.install_service
    try:
        result = await install_service.check_for_update(namespace, effect_id)
        return result
    except ValueError as e:
        raise bad_request(str(e), ErrorCode.UPDATE_ERROR)


@router.post("/effects/save")
async def save_effect(body: SaveEffectRequest, request: Request):
    """Save or create a local effect from YAML content."""
    install_service = request.app.state.install_service
    loader = request.app.state.effect_loader

    try:
        full_id = await install_service.save_yaml(
            body.yaml_content, body.effect_id, fork_from=body.fork_from
        )
    except ValueError as e:
        raise bad_request(str(e), ErrorCode.SAVE_ERROR)

    await loader.reload()
    loaded = loader.get_loaded(full_id)
    manifest_data = _serialize_effect(loaded) if loaded else {}
    return {"effect_id": full_id, "manifest": manifest_data}


@router.get("/effects/{namespace}/{effect_id}/editor")
async def get_effect_editor_data(namespace: str, effect_id: str, request: Request):
    """Get YAML + asset list for the editor in one request."""
    install_service = request.app.state.install_service
    existing = await install_service.get_effect(namespace, effect_id)
    if not existing:
        raise not_found("Effect not found")

    effect_dir = Path(existing["assets_dir"])
    uuid = effect_dir.name

    manifest_path = effect_dir / "manifest.yaml"
    yaml_content = manifest_path.read_text() if manifest_path.exists() else existing["manifest_yaml"]

    assets_dir = effect_dir / "assets"
    files = []
    if assets_dir.exists():
        for f in sorted(assets_dir.iterdir()):
            if f.is_file():
                files.append({
                    "filename": f.name,
                    "size": f.stat().st_size,
                    "url": f"/api/effects/assets/{uuid}/{f.name}",
                })

    return {"yaml": yaml_content, "files": files}


@router.get("/effects/{namespace}/{effect_id}/export")
async def export_effect(namespace: str, effect_id: str, request: Request):
    """Export an effect as a .zip archive."""
    install_service = request.app.state.install_service
    existing = await install_service.get_effect(namespace, effect_id)
    if not existing:
        raise not_found("Effect not found")

    assets_dir = Path(existing["assets_dir"])
    effect_name = f"{namespace}-{effect_id}"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        manifest_path = assets_dir / "manifest.yaml"
        if manifest_path.exists():
            zf.write(manifest_path, f"{effect_name}/manifest.yaml")
        else:
            zf.writestr(f"{effect_name}/manifest.yaml", existing["manifest_yaml"])

        assets_subdir = assets_dir / "assets"
        if assets_subdir.exists():
            for asset_file in assets_subdir.rglob("*"):
                if asset_file.is_file():
                    arcname = f"{effect_name}/assets/{asset_file.relative_to(assets_subdir)}"
                    zf.write(asset_file, arcname)

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{effect_name}.zip"'},
    )


# ─── Asset CRUD ───

async def _get_assets_dir_async(install_service, namespace: str, effect_id: str) -> tuple[Path, str]:
    """Returns (assets_dir_path, effect_uuid)."""
    existing = await install_service.get_effect(namespace, effect_id)
    if not existing:
        raise not_found("Effect not found")
    effect_dir = Path(existing["assets_dir"])
    assets_dir = effect_dir / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)
    uuid = Path(existing["assets_dir"]).name
    return assets_dir, uuid


def _auto_suffix(assets_dir: Path, filename: str) -> str:
    """If filename exists, add suffix like macOS: file.mp4 → file 2.mp4 → file 3.mp4."""
    stem, ext = os.path.splitext(filename)
    if not (assets_dir / filename).exists():
        return filename
    n = 2
    while (assets_dir / f"{stem} {n}{ext}").exists():
        n += 1
    return f"{stem} {n}{ext}"


def _safe_filename(filename: str) -> str:
    """Sanitize filename — no path traversal, no slashes."""
    name = Path(filename).name  # strip any directory components
    if not name or name.startswith('.') or '..' in name:
        raise bad_request("Invalid filename")
    return name



@router.post("/effects/{namespace}/{effect_id}/assets/upload")
async def upload_asset(namespace: str, effect_id: str, request: Request, file: UploadFile = File(...)):
    """Upload a file to the effect's assets folder."""
    install_service = request.app.state.install_service
    assets_dir, uuid = await _get_assets_dir_async(install_service, namespace, effect_id)

    original_name = _safe_filename(file.filename or "upload")
    final_name = _auto_suffix(assets_dir, original_name)
    dest = assets_dir / final_name

    content = await file.read()
    dest.write_bytes(content)

    return {
        "filename": final_name,
        "size": len(content),
        "url": f"/api/effects/assets/{uuid}/{final_name}",
    }


@router.delete("/effects/{namespace}/{effect_id}/assets/file/{filename:path}")
async def delete_asset(namespace: str, effect_id: str, filename: str, request: Request):
    """Delete an asset file."""
    install_service = request.app.state.install_service
    assets_dir, _ = await _get_assets_dir_async(install_service, namespace, effect_id)

    safe_name = _safe_filename(filename)
    file_path = assets_dir / safe_name
    if not file_path.exists():
        raise not_found("File not found")

    file_path.unlink()
    return {"ok": True}


@router.patch("/effects/{namespace}/{effect_id}/assets/file/{filename:path}")
async def rename_asset(namespace: str, effect_id: str, filename: str, body: RenameAssetRequest, request: Request):
    """Rename an asset file."""
    install_service = request.app.state.install_service
    assets_dir, uuid = await _get_assets_dir_async(install_service, namespace, effect_id)

    old_name = _safe_filename(filename)
    new_name = _safe_filename(body.new_name)
    old_path = assets_dir / old_name

    if not old_path.exists():
        raise not_found("File not found")

    if new_name != old_name:
        new_name = _auto_suffix(assets_dir, new_name)

    new_path = assets_dir / new_name
    old_path.rename(new_path)

    return {
        "filename": new_name,
        "size": new_path.stat().st_size,
        "url": f"/api/effects/assets/{uuid}/{new_name}",
    }
