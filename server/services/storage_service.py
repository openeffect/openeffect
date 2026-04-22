import hashlib
import os
import shutil
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import uuid_utils
from fastapi import UploadFile
from PIL import Image

from db.database import Database

CHUNK_SIZE = 64 * 1024  # 64KB

# Resize variants: (name_prefix, max_longest_side)
VARIANTS = [
    (2048, 85),   # for models
    (512, 80),    # for UI preview
]

# Pillow save options per format
SAVE_OPTIONS: dict[str, dict[str, Any]] = {
    "JPEG": {"optimize": True, "exif": b""},
    "PNG": {"optimize": True},
    "WEBP": {"method": 6},
}


def _resize_and_strip(img: Image.Image, max_size: int, quality: int, ext: str, dest: Path) -> None:
    """Resize image to fit within max_size, strip metadata, save optimized."""
    w, h = img.size
    if max(w, h) > max_size:
        ratio = max_size / max(w, h)
        img = img.resize((int(w * ratio), int(h * ratio)), Image.Resampling.LANCZOS)

    # Convert to RGB if saving as JPEG (no alpha support)
    fmt = img.format or _ext_to_format(ext)
    if fmt == "JPEG" and img.mode in ("RGBA", "P", "LA"):
        img = img.convert("RGB")

    opts: dict[str, Any] = {**SAVE_OPTIONS.get(fmt, {}), "quality": quality}
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
    def __init__(self, uploads_dir: Path, db: Database):
        self._uploads_dir = uploads_dir
        self._db = db
        self._uploads_dir.mkdir(parents=True, exist_ok=True)

    async def save_upload(self, filename: str, file: UploadFile, max_size: int) -> tuple[str, str, str, int]:
        """Stream upload, hash, dedup, resize. Returns (ref_id, ext, original_filename, size_bytes).

        Concurrency contract: two coroutines uploading identical bytes
        settle on the same ref_id and only one upload folder exists on
        disk. The INSERT happens before any folder creation, so the loser
        of the race never materializes an orphan directory.
        """

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
            with os.fdopen(tmp_fd, "wb") as f:
                while chunk := await file.read(CHUNK_SIZE):
                    total += len(chunk)
                    if total > max_size:
                        raise ValueError("File too large")
                    hasher.update(chunk)
                    f.write(chunk)

            file_hash = hasher.hexdigest()

            # 2. Fast-path dedup: hash already known
            existing = await self._db.fetchone(
                "SELECT id FROM uploads WHERE hash = ?", (file_hash,)
            )
            if existing:
                tmp_path.unlink(missing_ok=True)
                return existing[0], ext, original_filename, total

            # 3. Claim the hash with a fresh ref_id. RETURNING tells us who
            #    actually won if a concurrent caller raced us through step 2 —
            #    the loser gets nothing back and falls through to step 3b.
            ref_id = str(uuid_utils.uuid7())
            now = datetime.now(timezone.utc).isoformat()
            async with self._db.transaction() as conn:
                cursor = await conn.execute(
                    """INSERT INTO uploads (id, hash, filename, ext, mime, size, ref_count, created_at)
                       VALUES (?, ?, ?, ?, ?, ?, 0, ?)
                       ON CONFLICT(hash) DO NOTHING
                       RETURNING id""",
                    (ref_id, file_hash, original_filename, ext, mime, total, now),
                )
                claim = await cursor.fetchone()

            if claim is None:
                # 3b. Lost the race. Use the winner's id; never create a folder
                winner = await self._db.fetchone(
                    "SELECT id FROM uploads WHERE hash = ?", (file_hash,)
                )
                tmp_path.unlink(missing_ok=True)
                if winner is None:
                    # Pathological: the row was rolled back between our
                    # INSERT and this SELECT. Surface a failure rather than
                    # return a stale ref_id the client can't use.
                    raise RuntimeError("upload-dedup: winner row disappeared")
                return winner[0], ext, original_filename, total

            # 4. We own this hash. Materialize the files
            upload_dir = self._uploads_dir / ref_id
            try:
                upload_dir.mkdir(parents=True)
                original_path = upload_dir / f"original.{ext}"
                tmp_path.rename(original_path)

                try:
                    # No `img.copy()` per variant: Pillow's resize/convert
                    # return new images and don't mutate the source, so
                    # reusing `img` across the loop halves peak RSS on a
                    # large RGBA source.
                    img = Image.open(original_path)
                    img.load()
                    for size, quality in VARIANTS:
                        variant_path = upload_dir / f"{size}.{ext}"
                        _resize_and_strip(img, size, quality, ext, variant_path)
                except Exception:
                    # Non-image bytes (e.g. video): copy original as the "variants"
                    # so get_upload_path(ref_id, "512") has something to return.
                    for size, _ in VARIANTS:
                        variant_path = upload_dir / f"{size}.{ext}"
                        if not variant_path.exists():
                            shutil.copy2(str(original_path), str(variant_path))

                return ref_id, ext, original_filename, total

            except Exception:
                # Materialization failed: roll back the DB claim so the next
                # retry isn't stuck returning a broken ref_id for this hash.
                async with self._db.transaction() as conn:
                    await conn.execute("DELETE FROM uploads WHERE id = ?", (ref_id,))
                shutil.rmtree(str(upload_dir), ignore_errors=True)
                raise

        except Exception:
            tmp_path.unlink(missing_ok=True)
            raise

    async def increment_ref(self, ref_id: str) -> None:
        """Increment ref_count for an upload."""
        async with self._db.transaction() as conn:
            await conn.execute(
                "UPDATE uploads SET ref_count = ref_count + 1 WHERE id = ?",
                (ref_id,),
            )

    async def decrement_refs_and_cleanup(self, ref_ids: list[str]) -> None:
        """Decrement ref_count for each upload. Delete orphans from DB and disk."""
        if not ref_ids:
            return

        orphan_dirs: list[Path] = []

        async with self._db.transaction() as conn:
            for ref_id in ref_ids:
                await conn.execute(
                    "UPDATE uploads SET ref_count = ref_count - 1 WHERE id = ? AND ref_count > 0",
                    (ref_id,),
                )

            cursor = await conn.execute("SELECT id FROM uploads WHERE ref_count <= 0")
            orphans = await cursor.fetchall()

            for row in orphans:
                await conn.execute("DELETE FROM uploads WHERE id = ?", (row[0],))
                orphan_dirs.append(self._uploads_dir / row[0])

        # Clean up folders on disk (outside transaction)
        for orphan_dir in orphan_dirs:
            if orphan_dir.exists():
                shutil.rmtree(str(orphan_dir), ignore_errors=True)

    async def prune_orphans(self, max_age_hours: int) -> int:
        """Background reaper: remove `ref_count = 0` uploads that have been
        sitting for more than `max_age_hours`. Safety ordering — select all
        candidates up front, then for each orphan delete the files from disk
        FIRST, and only delete the DB row after rmtree succeeds. If rmtree
        fails the row stays behind and the next reaper cycle retries; that's
        better than deleting the row and leaking the files.

        `max_age_hours` covers the tiny window between save_upload (inserts
        ref_count=0) and increment_ref (run consumes the upload), so we
        never race an in-progress request.
        """
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=max_age_hours)).isoformat()

        # 1. Collect every candidate first — short read
        rows = await self._db.fetchall(
            "SELECT id FROM uploads WHERE ref_count = 0 AND created_at < ?",
            (cutoff,),
        )
        orphan_ids = [row[0] for row in rows]

        if not orphan_ids:
            return 0

        pruned = 0
        # 2. For each orphan: rmtree first, then drop the row. If the rmtree
        # throws, leave the row behind — next cycle tries again. If the process
        # dies between rmtree and DELETE the row is re-selected next cycle, the
        # rmtree of a missing dir is a no-op, and the DELETE succeeds.
        for ref_id in orphan_ids:
            orphan_dir = self._uploads_dir / ref_id
            try:
                if orphan_dir.exists():
                    shutil.rmtree(str(orphan_dir))
            except Exception:
                continue

            async with self._db.transaction() as conn:
                await conn.execute(
                    "DELETE FROM uploads WHERE id = ? AND ref_count = 0",
                    (ref_id,),
                )
            pruned += 1

        return pruned

    def get_upload_path(self, ref_id: str, variant: str = "2048") -> Path | None:
        """Return path to an upload variant. variant is '2048', '512', or 'original'."""
        upload_dir = self._uploads_dir / ref_id
        if not upload_dir.is_dir():
            return None

        matches = list(upload_dir.glob(f"{variant}.*"))
        return matches[0] if matches else None

    def get_upload_dir(self, ref_id: str) -> Path | None:
        """Return the upload UUID directory, or None if not found."""
        upload_dir = self._uploads_dir / ref_id
        return upload_dir if upload_dir.is_dir() else None
