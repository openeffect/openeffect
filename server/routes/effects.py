import io
import zipfile
from typing import Literal

from fastapi import APIRouter, File, Form, Request, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from core.limits import (
    IMAGE_CONTENT_TYPES,
    VIDEO_CONTENT_TYPES,
    max_size_for_content_type,
)
from core.media_sniff import SNIFF_SIZE, sniff_matches
from routes._errors import (
    ErrorCode,
    bad_request,
    conflict,
    not_found,
    payload_too_large,
    unsupported_type,
)
from schemas.file_ref import file_to_ref
from services.effect_loader import LoadedEffect
from services.errors import (
    AssetNotFoundError,
    EffectNotFoundError,
    OfficialReadOnlyError,
)
from services.file_service import FileTooLargeError, UnreadableMediaError
from services.install_service import InstallConflictError
from services.model_service import get_compatible_model_ids

router = APIRouter()


class InstallUrlRequest(BaseModel):
    url: str


class SaveEffectRequest(BaseModel):
    yaml_content: str
    effect_id: str | None = None  # null = new effect
    fork_from: str | None = None  # namespace/slug to copy assets from


class RenameAssetRequest(BaseModel):
    new_name: str


def _showcase_asset_ref(loaded: LoadedEffect, logical_name: str) -> dict | None:
    """Resolve a manifest's logical filename to a `FileRef` dict.
    Returns None when the asset hasn't been ingested yet (a freshly
    saved local effect can reference filenames the user has typed
    but not uploaded — the editor renders those as missing rather
    than as broken links)."""
    file = loaded.files.get(logical_name)
    if file is None:
        return None
    return file_to_ref(file).model_dump()


def _serialize_effect(loaded: LoadedEffect) -> dict:
    """Serialize a LoadedEffect with pre-resolved asset references.
    Showcase preview and image-typed showcase inputs come back as
    canonical `FileRef` dicts (or null when the asset isn't ingested
    yet) — the client reads `ref.url` / `ref.thumbnails['1024']`
    directly and never composes a `/api/files/...` URL."""
    data = loaded.manifest.model_dump()

    for sc in data.get("showcases", []):
        if sc.get("preview"):
            sc["preview"] = _showcase_asset_ref(loaded, sc["preview"])
        if sc.get("inputs"):
            resolved: dict[str, dict | str | None] = {}
            for key, value in sc["inputs"].items():
                schema = loaded.manifest.inputs.get(key)
                if schema and schema.type == "image":
                    resolved[key] = _showcase_asset_ref(loaded, value)
                else:
                    resolved[key] = value
            sc["inputs"] = resolved

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
    data["id"] = loaded.id
    data["full_id"] = loaded.full_id
    data["is_favorite"] = loaded.is_favorite
    return data


@router.get("/effects")
async def list_effects(request: Request):
    loader = request.app.state.effect_loader
    effects = loader.get_all_with_meta()
    return {"effects": [_serialize_effect(e) for e in effects]}


@router.get("/effects/{namespace}/{slug}")
async def get_effect(namespace: str, slug: str, request: Request):
    loader = request.app.state.effect_loader
    full_id = f"{namespace}/{slug}"
    loaded = loader.get_loaded(full_id)
    if not loaded:
        raise not_found("Effect not found", ErrorCode.EFFECT_NOT_FOUND)
    return _serialize_effect(loaded)


@router.post("/effects/install")
async def install_effect_from_url(
    request: Request,
    body: InstallUrlRequest,
    overwrite: bool = False,
):
    """JSON body: `{url}`. ZIP uploads use /effects/install/upload —
    mixing a Pydantic body with an UploadFile on one handler breaks
    FastAPI's content-type routing (body silently arrives as None)."""
    install_service = request.app.state.install_service

    try:
        installed = await install_service.install_from_url(body.url, overwrite=overwrite)
        return {"installed": installed}
    except InstallConflictError as e:
        raise conflict("Already installed", ErrorCode.INSTALL_CONFLICT, conflicts=e.conflicts)
    except ValueError as e:
        raise bad_request(str(e), ErrorCode.INSTALL_ERROR)


@router.post("/effects/install/upload")
async def install_effect_from_upload(
    request: Request,
    file: UploadFile = File(...),
    overwrite: bool = False,
):
    """Multipart upload: `file=<zip>`."""
    install_service = request.app.state.install_service

    if not file.filename:
        raise bad_request("Empty upload", ErrorCode.INVALID_REQUEST)

    try:
        content = await file.read()
        installed = await install_service.install_from_archive(content, overwrite=overwrite)
        return {"installed": installed}
    except InstallConflictError as e:
        raise conflict("Already installed", ErrorCode.INSTALL_CONFLICT, conflicts=e.conflicts)
    except ValueError as e:
        raise bad_request(str(e), ErrorCode.INSTALL_ERROR)


class FavoriteRequest(BaseModel):
    favorite: bool


class SourceRequest(BaseModel):
    source: Literal["installed", "local"]


@router.patch("/effects/{namespace}/{slug}/source")
async def set_effect_source(namespace: str, slug: str, body: SourceRequest, request: Request):
    install_service = request.app.state.install_service

    try:
        await install_service.set_source(namespace, slug, body.source)
    except EffectNotFoundError as e:
        raise not_found(str(e), ErrorCode.EFFECT_NOT_FOUND)
    except OfficialReadOnlyError as e:
        raise bad_request(str(e), ErrorCode.OFFICIAL_READONLY)
    except ValueError as e:
        raise bad_request(str(e), ErrorCode.INVALID_REQUEST)

    return {"ok": True, "source": body.source}


@router.patch("/effects/{namespace}/{slug}/favorite")
async def toggle_favorite(namespace: str, slug: str, body: FavoriteRequest, request: Request):
    install_service = request.app.state.install_service

    try:
        await install_service.set_favorite(namespace, slug, body.favorite)
    except EffectNotFoundError as e:
        raise not_found(str(e), ErrorCode.EFFECT_NOT_FOUND)

    return {"ok": True, "is_favorite": body.favorite}


@router.delete("/effects/{namespace}/{slug}")
async def uninstall_effect(namespace: str, slug: str, request: Request):
    install_service = request.app.state.install_service

    try:
        await install_service.uninstall(namespace, slug)
        return {"ok": True}
    except EffectNotFoundError as e:
        raise not_found(str(e), ErrorCode.EFFECT_NOT_FOUND)
    except OfficialReadOnlyError as e:
        raise bad_request(str(e), ErrorCode.OFFICIAL_READONLY)
    except ValueError as e:
        raise bad_request(str(e), ErrorCode.UNINSTALL_ERROR)


@router.post("/effects/{namespace}/{slug}/update")
async def update_effect(namespace: str, slug: str, request: Request):
    install_service = request.app.state.install_service
    try:
        result = await install_service.check_for_update(namespace, slug)
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
            body.yaml_content,
            body.effect_id,
            fork_from=body.fork_from,
        )
    except EffectNotFoundError as e:
        raise not_found(str(e), ErrorCode.EFFECT_NOT_FOUND)
    except OfficialReadOnlyError as e:
        raise bad_request(str(e), ErrorCode.OFFICIAL_READONLY)
    except ValueError as e:
        raise bad_request(str(e), ErrorCode.SAVE_ERROR)

    loaded = loader.get_loaded(full_id)
    manifest_data = _serialize_effect(loaded) if loaded else {}
    return {"full_id": full_id, "manifest": manifest_data}


@router.get("/effects/{namespace}/{slug}/editor")
async def get_effect_editor_data(namespace: str, slug: str, request: Request):
    """Get YAML + asset list for the editor in one request. Each asset
    entry carries the underlying file hash so the editor can echo the
    full `(filename → hash)` map back on save."""
    install_service = request.app.state.install_service
    loader = request.app.state.effect_loader

    existing = await install_service.get_effect(namespace, slug)
    if not existing:
        raise not_found("Effect not found")

    loaded = loader.get_loaded(f"{namespace}/{slug}")
    yaml_content = existing["manifest_yaml"]

    files: list[dict] = []
    if loaded:
        for logical_name, file in loaded.files.items():
            files.append({
                "filename": logical_name,
                "file": file_to_ref(file).model_dump(),
            })
        files.sort(key=lambda f: f["filename"])

    return {"yaml": yaml_content, "files": files}


@router.get("/effects/{namespace}/{slug}/export")
async def export_effect(namespace: str, slug: str, request: Request):
    """Export an effect as a .zip archive: manifest.yaml plus the
    original (un-thumbnailed) bytes of each asset the manifest
    actually references. Bound files that aren't mentioned in any
    showcase (stale uploads from earlier drafts) are skipped — the
    export should match what a fresh install_from_archive would
    consume, nothing more."""
    install_service = request.app.state.install_service
    loader = request.app.state.effect_loader
    files = request.app.state.file_service

    existing = await install_service.get_effect(namespace, slug)
    if not existing:
        raise not_found("Effect not found")

    loaded = loader.get_loaded(f"{namespace}/{slug}")
    effect_name = f"{namespace}-{slug}"

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as zf:
        zf.writestr(f"{effect_name}/manifest.yaml", existing["manifest_yaml"])

        if loaded:
            # Build the set of logical names the YAML actually references,
            # then filter the effect's bound files down to that set.
            referenced: set[str] = set()
            for sc in loaded.manifest.showcases:
                if sc.preview:
                    referenced.add(sc.preview)
                referenced.update(sc.inputs.values())

            for logical_name, ref in loaded.files.items():
                if logical_name not in referenced:
                    continue
                src_path = files.get_file_path(ref.id, f"original.{ref.ext}")
                if src_path is None:
                    continue
                zf.write(src_path, f"{effect_name}/assets/{logical_name}")

    buf.seek(0)
    return StreamingResponse(
        buf,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{effect_name}.zip"'},
    )


# ─── Per-asset CRUD ─────────────────────────────────────────────────────────
# Each call lands the change immediately on the effect's `effect_files`
# bindings; the YAML save endpoint above no longer touches assets at all.

_ALLOWED_ASSET_TYPES = IMAGE_CONTENT_TYPES | VIDEO_CONTENT_TYPES


@router.post("/effects/{namespace}/{slug}/assets")
async def upload_effect_asset(
    namespace: str,
    slug: str,
    request: Request,
    file: UploadFile = File(...),
    logical_name: str | None = Form(None),
):
    """Upload bytes through `FileService` and immediately bind the
    resulting file row to the effect under `logical_name` (defaults to
    the upload's filename). Returns an `AssetFile`-shaped row the
    client can append to its in-memory list."""
    install_service = request.app.state.install_service

    if not file.content_type or file.content_type not in _ALLOWED_ASSET_TYPES:
        raise unsupported_type("Unsupported media type")

    # Same magic-byte check as `/api/files`: catches a client that
    # forges the Content-Type header before any bytes hit disk.
    head = await file.read(SNIFF_SIZE)
    await file.seek(0)
    if not sniff_matches(head, file.content_type):
        raise unsupported_type("File contents don't match the declared media type")

    kind = "video" if file.content_type in VIDEO_CONTENT_TYPES else "image"
    try:
        result = await install_service.add_effect_asset(
            namespace, slug, file,
            logical_name=logical_name,
            kind=kind,
            mime=file.content_type,
            max_size=max_size_for_content_type(file.content_type),
        )
    except FileTooLargeError:
        raise payload_too_large("File too large")
    except UnreadableMediaError as e:
        raise bad_request(f"Could not process file: {e}", ErrorCode.INVALID_REQUEST)
    except EffectNotFoundError as e:
        raise not_found(str(e), ErrorCode.EFFECT_NOT_FOUND)
    except ValueError as e:
        raise bad_request(str(e), ErrorCode.SAVE_ERROR)

    return result


@router.patch("/effects/{namespace}/{slug}/assets/{logical_name:path}")
async def rename_effect_asset(
    namespace: str,
    slug: str,
    logical_name: str,
    body: RenameAssetRequest,
    request: Request,
):
    install_service = request.app.state.install_service
    try:
        result = await install_service.rename_effect_asset(
            namespace, slug, logical_name, body.new_name,
        )
    except EffectNotFoundError as e:
        raise not_found(str(e), ErrorCode.EFFECT_NOT_FOUND)
    except AssetNotFoundError as e:
        raise not_found(str(e), ErrorCode.ASSET_NOT_FOUND)
    except ValueError as e:
        raise bad_request(str(e), ErrorCode.SAVE_ERROR)
    return result


@router.delete("/effects/{namespace}/{slug}/assets/{logical_name:path}")
async def delete_effect_asset(
    namespace: str,
    slug: str,
    logical_name: str,
    request: Request,
):
    install_service = request.app.state.install_service
    try:
        await install_service.remove_effect_asset(namespace, slug, logical_name)
    except EffectNotFoundError as e:
        raise not_found(str(e), ErrorCode.EFFECT_NOT_FOUND)
    except AssetNotFoundError as e:
        raise not_found(str(e), ErrorCode.ASSET_NOT_FOUND)
    except ValueError as e:
        raise bad_request(str(e), ErrorCode.SAVE_ERROR)
    return {"ok": True}
