import hashlib
import shutil
import tempfile
import uuid_utils
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite
from fastapi import UploadFile
from PIL import Image

CHUNK_SIZE = 64 * 1024  # 64KB

# Resize variants: (name_prefix, max_longest_side)
VARIANTS = [
    (2048, 85),   # for models
    (512, 80),    # for UI preview
]

# Pillow save options per format
SAVE_OPTIONS = {
    "JPEG": {"optimize": True, "exif": b""},
    "PNG": {"optimize": True},
    "WEBP": {"method": 6},
}


def _resize_and_strip(img: Image.Image, max_size: int, quality: int, ext: str, dest: Path) -> None:
    """Resize image to fit within max_size, strip metadata, save optimized."""
    w, h = img.size
    if max(w, h) > max_size:
        ratio = max_size / max(w, h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.LANCZOS)

    # Convert to RGB if saving as JPEG (no alpha support)
    fmt = img.format or _ext_to_format(ext)
    if fmt == "JPEG" and img.mode in ("RGBA", "P", "LA"):
        img = img.convert("RGB")

    opts = {**SAVE_OPTIONS.get(fmt, {}), "quality": quality}
    img.save(dest, format=fmt, **opts)


def _ext_to_format(ext: str) -> str:
    """Map file extension to Pillow format name."""
    mapping = {
        "jpg": "JPEG", "jpeg": "JPEG",
        "png": "PNG",
        "webp": "WEBP",
    }
    return mapping.get(ext.lower(), "JPEG")


class StorageService:
    def __init__(self, uploads_dir: Path, db_path: Path):
        self._uploads_dir = uploads_dir
        self._db_path = db_path
        self._uploads_dir.mkdir(parents=True, exist_ok=True)

    async def save_upload(self, filename: str, file: UploadFile, max_size: int) -> tuple[str, str, str, int]:
        """Stream upload, hash, dedup, resize. Returns (ref_id, ext, original_filename, size_bytes)."""

        # Extract extension safely
        ext = "jpg"
        if filename and "." in filename:
            raw_ext = filename.rsplit(".", 1)[-1]
            sanitized = "".join(c for c in raw_ext if c.isalnum())
            if sanitized:
                ext = sanitized[:10]

        mime = file.content_type or "application/octet-stream"
        original_filename = filename or f"upload.{ext}"

        # 1. Stream to temp file, compute full SHA-256
        hasher = hashlib.sha256()
        total = 0
        tmp_fd, tmp_path_str = tempfile.mkstemp(dir=str(self._uploads_dir), suffix=f".{ext}.tmp")
        tmp_path = Path(tmp_path_str)

        try:
            import os
            with os.fdopen(tmp_fd, "wb") as f:
                while chunk := await file.read(CHUNK_SIZE):
                    total += len(chunk)
                    if total > max_size:
                        raise ValueError("File too large")
                    hasher.update(chunk)
                    f.write(chunk)

            file_hash = hasher.hexdigest()  # full 64 hex chars

            # 2. Check dedup
            async with aiosqlite.connect(str(self._db_path)) as db:
                cursor = await db.execute("SELECT id FROM uploads WHERE hash = ?", (file_hash,))
                existing = await cursor.fetchone()

                if existing:
                    tmp_path.unlink(missing_ok=True)
                    return existing[0], ext, original_filename, total

                # 3. New upload — create UUID folder, store original + variants
                ref_id = str(uuid_utils.uuid7())
                upload_dir = self._uploads_dir / ref_id
                upload_dir.mkdir(parents=True)

                # Save original untouched
                original_path = upload_dir / f"original.{ext}"
                tmp_path.rename(original_path)

                # Generate resized variants
                try:
                    img = Image.open(original_path)
                    img.load()  # force load before we close
                    for size, quality in VARIANTS:
                        variant_path = upload_dir / f"{size}.{ext}"
                        _resize_and_strip(img.copy(), size, quality, ext, variant_path)
                except Exception:
                    # If Pillow can't process (e.g. video file), just copy original as variants
                    for size, _ in VARIANTS:
                        variant_path = upload_dir / f"{size}.{ext}"
                        if not variant_path.exists():
                            shutil.copy2(str(original_path), str(variant_path))

                # 4. Insert DB row
                now = datetime.now(timezone.utc).isoformat()
                await db.execute(
                    """INSERT INTO uploads (id, hash, filename, ext, mime, size, ref_count, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, 0, ?)""",
                    (ref_id, file_hash, original_filename, ext, mime, total, now),
                )
                await db.commit()

            return ref_id, ext, original_filename, total

        except Exception:
            tmp_path.unlink(missing_ok=True)
            raise

    async def increment_ref(self, ref_id: str) -> None:
        """Increment ref_count for an upload."""
        async with aiosqlite.connect(str(self._db_path)) as db:
            await db.execute(
                "UPDATE uploads SET ref_count = ref_count + 1 WHERE id = ?",
                (ref_id,),
            )
            await db.commit()

    async def decrement_refs_and_cleanup(self, ref_ids: list[str]) -> None:
        """Decrement ref_count for each upload. Delete orphans from DB and disk."""
        if not ref_ids:
            return

        orphan_dirs: list[Path] = []

        async with aiosqlite.connect(str(self._db_path)) as db:
            await db.execute("BEGIN IMMEDIATE")
            try:
                for ref_id in ref_ids:
                    await db.execute(
                        "UPDATE uploads SET ref_count = ref_count - 1 WHERE id = ? AND ref_count > 0",
                        (ref_id,),
                    )

                # Find and delete orphans
                cursor = await db.execute("SELECT id FROM uploads WHERE ref_count <= 0")
                orphans = await cursor.fetchall()

                for row in orphans:
                    await db.execute("DELETE FROM uploads WHERE id = ?", (row[0],))
                    orphan_dirs.append(self._uploads_dir / row[0])

                await db.commit()
            except Exception:
                await db.rollback()
                raise

        # Clean up folders on disk (outside transaction)
        for orphan_dir in orphan_dirs:
            if orphan_dir.exists():
                shutil.rmtree(str(orphan_dir), ignore_errors=True)

    def get_upload_path(self, ref_id: str, variant: str = "2048") -> Path | None:
        """Return path to an upload variant. variant is '2048', '512', or 'original'."""
        upload_dir = self._uploads_dir / ref_id
        if not upload_dir.is_dir():
            return None

        # Find the variant file (we don't know ext, so glob)
        matches = list(upload_dir.glob(f"{variant}.*"))
        return matches[0] if matches else None

    def get_upload_dir(self, ref_id: str) -> Path | None:
        """Return the upload UUID directory, or None if not found."""
        upload_dir = self._uploads_dir / ref_id
        return upload_dir if upload_dir.is_dir() else None
