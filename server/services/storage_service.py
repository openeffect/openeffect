import hashlib
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import aiosqlite
from fastapi import UploadFile


CHUNK_SIZE = 64 * 1024  # 64KB


class StorageService:
    def __init__(self, uploads_dir: Path, db_path: Path):
        self._uploads_dir = uploads_dir
        self._db_path = db_path
        self._uploads_dir.mkdir(parents=True, exist_ok=True)

    async def save_upload(self, filename: str, file: UploadFile, max_size: int) -> tuple[str, str, int]:
        """Stream upload, hash content (SHA-256 truncated to 12 hex), store deduped.
        Returns (hash_with_ext, original_filename, size_bytes).
        hash_with_ext is like 'a1b2c3d4e5f6.jpeg'"""

        # Extract extension safely
        ext = "jpg"
        if filename and "." in filename:
            raw_ext = filename.rsplit(".", 1)[-1]
            sanitized = "".join(c for c in raw_ext if c.isalnum())
            if sanitized:
                ext = sanitized[:10]

        mime = file.content_type or "application/octet-stream"
        original_filename = filename or f"upload.{ext}"

        # 1. Stream to temp file, compute hash
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

            # Truncate SHA-256 to first 12 hex chars
            hash20 = hasher.hexdigest()[:20]
            hash_filename = f"{hash20}.{ext}"

            # 2. Check if hash already exists in uploads table
            async with aiosqlite.connect(str(self._db_path)) as db:
                cursor = await db.execute("SELECT hash FROM uploads WHERE hash = ?", (hash20,))
                existing = await cursor.fetchone()

                if existing:
                    # Already exists -- delete temp, return existing
                    tmp_path.unlink(missing_ok=True)
                    return hash_filename, original_filename, total

                # 3. New upload -- rename temp to {hash}.{ext}, insert DB row
                final_path = self._uploads_dir / hash_filename
                tmp_path.rename(final_path)

                now = datetime.now(timezone.utc).isoformat()
                await db.execute(
                    """INSERT INTO uploads (hash, filename, ext, mime, size, ref_count, created_at)
                       VALUES (?, ?, ?, ?, ?, 0, ?)""",
                    (hash20, original_filename, ext, mime, total, now),
                )
                await db.commit()

            return hash_filename, original_filename, total

        except Exception:
            # Clean up temp file on any error
            tmp_path.unlink(missing_ok=True)
            raise

    async def increment_ref(self, hash_filename: str) -> None:
        """Increment ref_count for an upload. Called when generation starts."""
        hash20 = hash_filename.rsplit(".", 1)[0] if "." in hash_filename else hash_filename
        async with aiosqlite.connect(str(self._db_path)) as db:
            await db.execute(
                "UPDATE uploads SET ref_count = ref_count + 1 WHERE hash = ?",
                (hash20,),
            )
            await db.commit()

    async def decrement_refs_and_cleanup(self, hash_filenames: list[str]) -> None:
        """Decrement ref_count for each hash. Delete orphans (ref_count <= 0) from DB and disk."""
        if not hash_filenames:
            return

        async with aiosqlite.connect(str(self._db_path)) as db:
            # Single transaction for atomicity
            await db.execute("BEGIN IMMEDIATE")
            try:
                for hash_filename in hash_filenames:
                    hash20 = hash_filename.rsplit(".", 1)[0] if "." in hash_filename else hash_filename
                    await db.execute(
                        "UPDATE uploads SET ref_count = ref_count - 1 WHERE hash = ? AND ref_count > 0",
                        (hash20,),
                    )

                # Find and delete orphans
                cursor = await db.execute("SELECT hash, ext FROM uploads WHERE ref_count <= 0")
                orphans = await cursor.fetchall()

                for row in orphans:
                    await db.execute("DELETE FROM uploads WHERE hash = ?", (row[0],))

                await db.commit()
            except Exception:
                await db.rollback()
                raise

            # Clean up files on disk (outside transaction)
            for row in orphans:
                orphan_path = self._uploads_dir / f"{row[0]}.{row[1]}"
                orphan_path.unlink(missing_ok=True)

    def get_upload_path(self, hash_filename: str) -> Path | None:
        """Return path to uploaded file, or None if not found."""
        path = self._uploads_dir / hash_filename
        return path if path.exists() else None
