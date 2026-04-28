import asyncio
import hashlib
import logging
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

import aiosqlite
import imageio_ffmpeg
import uuid_utils
from fastapi import UploadFile
from PIL import Image

from db.database import Database

logger = logging.getLogger(__name__)

CHUNK_SIZE = 64 * 1024
WEBP_QUALITY_512 = 80
WEBP_QUALITY_1024 = 85

FileKind = Literal["image", "video", "other"]


class FileTooLargeError(ValueError):
    """Raised when an upload exceeds its `max_size`. Distinct from
    other ValueErrors (e.g. corrupt media) so the route layer can
    surface the right HTTP status."""


class UnreadableMediaError(ValueError):
    """Raised when Pillow / ffmpeg can't make sense of the bytes. The
    route layer maps this to 400 — the file was too small/garbled to
    thumbnail, not too large."""


@dataclass(frozen=True)
class File:
    """A row in the content-addressed file store. `id` is a UUID7 — the
    addressable identifier exposed in URLs and on disk. `hash` is the
    sha256 of the original bytes, kept server-internal as the dedup key
    (a public hash would let anyone probe the server for known content).
    Variant filenames on disk are deterministic from `kind`: image and
    video both get `original.{ext}` plus `512.webp`/`1024.webp`; `other`
    gets only the original. Callers compose URLs from `kind` directly —
    no per-file variants list to read."""
    id: str
    hash: str
    kind: FileKind
    mime: str
    ext: str
    size: int


class FileService:
    """Hash-deduped, ref-counted blob store. UUID7-named folder per
    unique blob. Every ingest path — user upload, effect-asset install,
    run-result download — funnels through `add_file`, so dedup,
    thumbnails, and ref-count safety are uniform.

    Concurrency contract: two callers ingesting identical bytes settle
    on the same row (and folder) by hash. The INSERT happens after
    thumbnail generation but before the staging-dir rename, so the
    loser of the race never materializes an orphan folder."""

    def __init__(self, files_dir: Path, db: Database):
        self._files_dir = files_dir
        self._db = db
        self._files_dir.mkdir(parents=True, exist_ok=True)

    @property
    def files_dir(self) -> Path:
        return self._files_dir

    async def add_file(
        self,
        source: Path | bytes | UploadFile,
        *,
        kind: FileKind,
        mime: str | None = None,
        ext: str | None = None,
        max_size: int | None = None,
    ) -> File:
        """Ingest bytes into the store. Returns a deduped `File`.

        `source` may be a Path, raw bytes, or an UploadFile (streamed in
        chunks; honors `max_size`). `ext` is the canonical original
        extension without a leading dot — caller-supplied takes precedence
        over what we'd derive from the source itself. `mime` defaults to
        a guess from the extension and kind."""
        tmp_fd, tmp_path_str = tempfile.mkstemp(dir=str(self._files_dir), suffix=".tmp")
        tmp_path = Path(tmp_path_str)
        os.close(tmp_fd)

        try:
            file_hash, size, derived_ext = await self._stage_to_temp(
                source, tmp_path, max_size=max_size,
            )

            chosen_ext = (ext or derived_ext or "bin").lstrip(".").lower()
            chosen_mime = mime or _mime_for_ext(chosen_ext)

            # Fast-path dedup. Race-safe: if a concurrent caller commits
            # the same hash between this SELECT and our INSERT below,
            # the INSERT's ON CONFLICT DO NOTHING catches it.
            existing = await self._fetch_by_hash(file_hash)
            if existing is not None:
                tmp_path.unlink(missing_ok=True)
                return existing

            # Stage thumbnails alongside the original in a temp dir.
            # Atomic rename to the final location only after the row is claimed.
            stage_dir = Path(tempfile.mkdtemp(dir=str(self._files_dir), prefix=".stage-"))
            file_id: str | None = None
            try:
                original_path = stage_dir / f"original.{chosen_ext}"
                tmp_path.rename(original_path)

                # Thumbnails are written for image/video kinds. The exact
                # filenames are a closed function of `kind` (see
                # `_generate_thumbnails`), so we don't persist the list.
                await asyncio.to_thread(
                    _generate_thumbnails, original_path, stage_dir, kind,
                )

                file_id = str(uuid_utils.uuid7())
                now = datetime.now(timezone.utc).isoformat()
                async with self._db.transaction() as conn:
                    # The conflict target uses the partial unique index
                    # `idx_files_hash_live` (hash, WHERE ref_count IS NOT NULL).
                    # A tombstoned row with the same hash doesn't trigger
                    # the conflict — exactly what we want so a fresh upload
                    # bypasses a row mid-cleanup.
                    cursor = await conn.execute(
                        """INSERT INTO files (
                               id, hash, kind, mime, ext, size,
                               ref_count, created_at
                           ) VALUES (?, ?, ?, ?, ?, ?, 0, ?)
                           ON CONFLICT(hash) WHERE ref_count IS NOT NULL DO NOTHING
                           RETURNING id""",
                        (file_id, file_hash, kind, chosen_mime, chosen_ext, size, now),
                    )
                    claim = await cursor.fetchone()

                if claim is None:
                    # Lost the race — discard our staging, return the winner.
                    shutil.rmtree(str(stage_dir), ignore_errors=True)
                    file_id = None  # nothing to roll back
                    winner = await self._fetch_by_hash(file_hash)
                    if winner is None:
                        # Pathological: row was rolled back between our
                        # INSERT attempt and this SELECT. Surface a failure
                        # rather than return a stale id the caller can't use.
                        raise RuntimeError("file-dedup: winner row disappeared")
                    return winner

                # Won the claim. Rename staging to the final location.
                final_dir = self._files_dir / file_id
                if final_dir.exists():
                    # Stale orphan from a previous crash sitting where our
                    # blob belongs (uuid7 collision is astronomically rare,
                    # but rmtree first keeps the rename safe).
                    shutil.rmtree(str(final_dir), ignore_errors=True)
                stage_dir.rename(final_dir)

                return File(
                    id=file_id, hash=file_hash, kind=kind, mime=chosen_mime,
                    ext=chosen_ext, size=size,
                )
            except Exception:
                # Roll back the DB claim if we made one — next retry shouldn't
                # be stuck pointing at an id with no folder behind it. The
                # `ref_count = 0` guard skips rows that another writer has
                # already adopted.
                if file_id is not None:
                    async with self._db.transaction() as conn:
                        await conn.execute(
                            "DELETE FROM files WHERE id = ? AND ref_count = 0",
                            (file_id,),
                        )
                if stage_dir.exists():
                    shutil.rmtree(str(stage_dir), ignore_errors=True)
                raise
        finally:
            tmp_path.unlink(missing_ok=True)

    async def _stage_to_temp(
        self,
        source: Path | bytes | UploadFile,
        tmp_path: Path,
        *,
        max_size: int | None,
    ) -> tuple[str, int, str | None]:
        """Stream source bytes to tmp_path, returning (sha256, size, derived_ext).

        Dispatch is duck-typed (rather than an `isinstance(UploadFile)`
        check) so tests can pass mock objects with the same shape — and
        FastAPI sometimes wraps the upload differently anyway."""
        hasher = hashlib.sha256()
        total = 0
        derived_ext: str | None = None

        if isinstance(source, (bytes, bytearray)):
            buf = bytes(source)
            total = len(buf)
            if max_size is not None and total > max_size:
                raise FileTooLargeError("File too large")
            hasher.update(buf)
            tmp_path.write_bytes(buf)
        elif isinstance(source, Path):
            derived_ext = source.suffix.lstrip(".").lower() or None
            total = source.stat().st_size
            if max_size is not None and total > max_size:
                raise FileTooLargeError("File too large")
            with open(source, "rb") as src, open(tmp_path, "wb") as dst:
                while chunk := src.read(CHUNK_SIZE):
                    hasher.update(chunk)
                    dst.write(chunk)
        elif hasattr(source, "read"):
            filename = getattr(source, "filename", None)
            if filename and "." in filename:
                raw = filename.rsplit(".", 1)[-1]
                clean = "".join(c for c in raw if c.isalnum())
                if clean:
                    derived_ext = clean[:10].lower()
            with open(tmp_path, "wb") as f:
                while chunk := await source.read(CHUNK_SIZE):
                    total += len(chunk)
                    if max_size is not None and total > max_size:
                        raise FileTooLargeError("File too large")
                    hasher.update(chunk)
                    f.write(chunk)
        else:
            raise TypeError(f"Unsupported source type: {type(source)!r}")

        return hasher.hexdigest(), total, derived_ext

    def _row_to_file(self, row) -> File:
        return File(
            id=row["id"], hash=row["hash"], kind=row["kind"], mime=row["mime"],
            ext=row["ext"], size=row["size"],
        )

    async def _fetch_by_hash(self, file_hash: str) -> File | None:
        # `ref_count IS NOT NULL` filters out tombstoned rows so dedup
        # never resurrects a file that's mid-cleanup. Combined with the
        # partial unique index, a tombstoned row + a fresh row with the
        # same hash can briefly coexist; this filter ensures callers only
        # ever see the live one.
        row = await self._db.fetchone(
            "SELECT id, hash, kind, mime, ext, size FROM files "
            "WHERE hash = ? AND ref_count IS NOT NULL",
            (file_hash,),
        )
        return self._row_to_file(row) if row else None

    async def get_file(self, file_id: str) -> File | None:
        row = await self._db.fetchone(
            "SELECT id, hash, kind, mime, ext, size FROM files WHERE id = ?",
            (file_id,),
        )
        return self._row_to_file(row) if row else None

    def get_file_path(self, file_id: str, filename: str) -> Path | None:
        """Resolve a single variant on disk. Returns None if either the
        id or filename contains path-traversal tokens, or the file
        doesn't exist."""
        if not file_id or "/" in file_id or ".." in file_id or "\\" in file_id:
            return None
        if not filename or "/" in filename or ".." in filename or "\\" in filename:
            return None
        path = self._files_dir / file_id / filename
        return path if path.is_file() else None

    async def increment_ref(self, file_id: str) -> None:
        """Bump a file's ref count. Raises `ValueError` if the file has
        been tombstoned (`ref_count IS NULL`) or doesn't exist — silent
        no-ops here would leak refs (`NULL + 1 = NULL`) and leave the
        caller thinking they hold a reference."""
        async with self._db.transaction() as conn:
            await self.bump_ref_in_tx(conn, file_id)

    async def decrement_refs(self, ids: list[str]) -> None:
        """Drop one ref off each given id. Cleanup of `ref_count = 0`
        rows happens in `prune_orphan_files` — keeping decrement and
        rmtree apart is what makes the multi-instance TTL safety work."""
        if not ids:
            return
        async with self._db.transaction() as conn:
            for fid in ids:
                await self.drop_ref_in_tx(conn, fid)

    @staticmethod
    async def bump_ref_in_tx(conn: aiosqlite.Connection, file_id: str) -> None:
        """Increment ref_count atomically inside the caller's transaction,
        with the `ref_count IS NOT NULL` guard so a tombstoned (mid-GC)
        row can't be resurrected. Raises `ValueError` on rowcount=0 —
        callers wrap that into a domain-specific message (input file
        unavailable, output file unavailable, etc.) so the error surfaces
        the user-facing context. Pair the bump with the entity write in
        the same `async with self._db.transaction()` block to keep the
        ref count and the binding row atomic — see `_link_effect_file`
        and `history.create_processing` for the canonical patterns."""
        cursor = await conn.execute(
            "UPDATE files SET ref_count = ref_count + 1 "
            "WHERE id = ? AND ref_count IS NOT NULL",
            (file_id,),
        )
        if cursor.rowcount == 0:
            raise ValueError(f"File {file_id} is no longer available")

    @staticmethod
    async def drop_ref_in_tx(conn: aiosqlite.Connection, file_id: str) -> None:
        """Decrement ref_count atomically inside the caller's transaction.
        The `> 0` guard makes already-zero rows a no-op (instead of
        underflowing to -1) and skips tombstoned rows (`NULL > 0` is
        false). Idempotent for unknown/missing ids. Use whenever the
        bound entity is being deleted in the same transaction."""
        await conn.execute(
            "UPDATE files SET ref_count = ref_count - 1 "
            "WHERE id = ? AND ref_count > 0",
            (file_id,),
        )

    async def prune_orphan_files(self, max_age_hours: int) -> int:
        """Two-phase orphan sweep.

        **Phase 1 — tombstone.** Atomically move every fresh
        `ref_count = 0` row past the TTL into the tombstoned state
        (`ref_count = NULL`). The partial unique index on `hash` no
        longer covers tombstoned rows, so a concurrent upload of the
        same content can claim a fresh `id` even before Phase 2 has
        rmtree'd the doomed folder.

        **Phase 2 — drain.** For each tombstoned row, rmtree the
        folder then DELETE the row. The selection here is `ref_count
        IS NULL` (no age filter): a tombstoned row from a previous
        cycle whose rmtree failed gets retried until it succeeds.

        `max_age_hours` is the multi-instance safety knob: anything
        younger could still belong to a live request that's about to
        bump the ref."""
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=max_age_hours)).isoformat()

        # Phase 1 — atomically tombstone aged orphans.
        async with self._db.transaction() as conn:
            await conn.execute(
                "UPDATE files SET ref_count = NULL "
                "WHERE ref_count = 0 AND created_at < ?",
                (cutoff,),
            )

        # Phase 2 — drain every tombstoned row (this cycle's plus any
        # leftovers from a crashed previous cycle).
        rows = await self._db.fetchall(
            "SELECT id FROM files WHERE ref_count IS NULL"
        )
        if not rows:
            return 0

        pruned = 0
        for row in rows:
            orphan_dir = self._files_dir / row["id"]
            try:
                if orphan_dir.exists():
                    shutil.rmtree(str(orphan_dir))
            except Exception:
                # Disk wedged; leave the row tombstoned, retry next cycle.
                continue

            async with self._db.transaction() as conn:
                await conn.execute(
                    "DELETE FROM files WHERE id = ? AND ref_count IS NULL",
                    (row["id"],),
                )
            pruned += 1

        return pruned


def _mime_for_ext(ext: str) -> str:
    table = {
        "jpg": "image/jpeg", "jpeg": "image/jpeg",
        "png": "image/png",
        "webp": "image/webp",
        "gif": "image/gif",
        "mp4": "video/mp4",
        "webm": "video/webm",
        "mov": "video/quicktime",
    }
    return table.get(ext, "application/octet-stream")


def _generate_thumbnails(
    original_path: Path,
    dest_dir: Path,
    kind: FileKind,
) -> list[str]:
    """Synchronous thumbnail generation — call via `asyncio.to_thread`.

    For `kind` in `('image', 'video')` always returns
    `["512.webp", "1024.webp"]` — both tiers are always written so the
    client never has to check whether a variant exists. For sources
    smaller than the tier dimensions the resulting webp file is just
    the source size (Pillow's `thumbnail()` never upscales), so two of
    the three on-disk files may be byte-similar — the disk waste is
    bounded by the original size and pays for a much simpler API.

    Raises on any failure: a corrupt source that we can't open is
    surfaced as a `ValueError` so the route layer rejects the upload
    cleanly. Half-thumbnailed files would otherwise leave the contract
    in tatters."""
    if kind == "image":
        return _image_thumbnails(original_path, dest_dir)
    if kind == "video":
        return _video_poster(original_path, dest_dir)
    return []


def _image_thumbnails(source_path: Path, dest_dir: Path) -> list[str]:
    try:
        with Image.open(source_path) as img:
            img.load()
            return _emit_thumbnails(img, dest_dir)
    except Exception as e:
        logger.warning("Image thumbnail generation failed for %s: %s", source_path, e)
        raise UnreadableMediaError(f"Could not generate thumbnails for image: {e}") from e


def _video_poster(source_path: Path, dest_dir: Path) -> list[str]:
    """Extract a frame at ~0.5s and downscale into 512.webp / 1024.webp.
    Falls back to the first frame for clips shorter than 0.5s; raises
    if no frame can be extracted at all."""
    poster_path = dest_dir / ".poster.png"
    try:
        ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
        # ffmpeg has no business seeing FAL_KEY etc.
        env = {k: v for k, v in os.environ.items() if k != "FAL_KEY"}
        common = [
            "-frames:v", "1",
            "-vf", "scale='min(2048,iw)':-2",
            str(poster_path),
        ]
        result = subprocess.run(
            [ffmpeg, "-y", "-ss", "0.5", "-i", str(source_path), *common],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            env=env,
            timeout=30,
        )
        if result.returncode != 0 or not poster_path.exists():
            subprocess.run(
                [ffmpeg, "-y", "-i", str(source_path), *common],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                env=env,
                timeout=30,
            )
        if not poster_path.exists():
            raise UnreadableMediaError("ffmpeg did not produce a poster frame")
        with Image.open(poster_path) as img:
            img.load()
            return _emit_thumbnails(img, dest_dir)
    except UnreadableMediaError:
        raise
    except Exception as e:
        logger.warning("Video poster extraction failed for %s: %s", source_path, e)
        raise UnreadableMediaError(f"Could not generate thumbnails for video: {e}") from e
    finally:
        poster_path.unlink(missing_ok=True)


def _emit_thumbnails(img: Image.Image, dest_dir: Path) -> list[str]:
    """Write 512.webp and 1024.webp, both always. Pillow's `thumbnail()`
    never upscales, so a 256px source still produces 256px webp files
    under both filenames — small disk overhead in exchange for a
    predictable client contract."""
    if img.mode in ("P", "LA"):
        img = img.convert("RGBA")
    elif img.mode == "CMYK":
        img = img.convert("RGB")

    img_512 = img.copy()
    img_512.thumbnail((512, 512), Image.Resampling.LANCZOS)
    img_512.save(dest_dir / "512.webp", format="WEBP", quality=WEBP_QUALITY_512, method=6)

    img_1024 = img.copy()
    img_1024.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    img_1024.save(dest_dir / "1024.webp", format="WEBP", quality=WEBP_QUALITY_1024, method=6)

    return ["512.webp", "1024.webp"]
