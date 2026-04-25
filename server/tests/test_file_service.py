"""Tests for FileService — content-addressed file store with thumbnails and ref counting."""
import asyncio
import io
import json
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from PIL import Image

from db.database import Database, init_db
from services.file_service import FileService


def _png_bytes(size: tuple[int, int] = (32, 32), color: tuple[int, int, int] = (200, 100, 50)) -> bytes:
    """A real PNG so Pillow's thumbnail pipeline actually exercises."""
    img = Image.new("RGB", size, color=color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


@pytest.fixture
async def files(tmp_path):
    files_dir = tmp_path / "files"
    files_dir.mkdir()
    db_path = tmp_path / "test.db"
    await init_db(db_path)
    db = Database(db_path)
    await db.connect()
    yield FileService(files_dir, db)
    await db.close()


def _upload(content: bytes, filename: str = "test.png", content_type: str = "image/png"):
    mock = MagicMock()
    mock.filename = filename
    mock.content_type = content_type
    data = io.BytesIO(content)

    async def read(size=-1):
        if size == -1:
            return data.read()
        return data.read(size)

    mock.read = read
    return mock


async def _add_image(files: FileService, content: bytes, filename: str = "test.png"):
    return await files.add_file(_upload(content, filename), kind="image", mime="image/png")


async def _ref_count(files: FileService, file_id: str) -> int | None:
    row = await files._db.fetchone(
        "SELECT ref_count FROM files WHERE id = ?", (file_id,),
    )
    return row[0] if row else None


async def _set_created_at(files: FileService, file_id: str, ts: str) -> None:
    async with files._db.transaction() as conn:
        await conn.execute(
            "UPDATE files SET created_at = ? WHERE id = ?", (ts, file_id),
        )


class TestAddFile:
    async def test_returns_uuid_id_and_internal_hash(self, files):
        png = _png_bytes()
        f = await _add_image(files, png, "photo.png")
        # id is uuid7 — same shape as run job ids
        assert "-" in f.id
        # hash is the sha256 dedup key, not exposed via the API
        assert len(f.hash) == 64
        assert f.kind == "image"
        assert f.mime == "image/png"
        assert f.ext == "png"
        assert f.size == len(png)

    async def test_writes_original_and_thumbnails(self, files):
        png = _png_bytes((1500, 800))
        f = await _add_image(files, png, "big.png")
        folder = files.files_dir / f.id
        assert (folder / "original.png").exists()
        assert (folder / "512.webp").exists()
        # 1500 has headroom past 512 → 1024.webp gets emitted
        assert (folder / "1024.webp").exists()
        assert sorted(f.variants) == ["1024.webp", "512.webp", "original.png"]

    async def test_both_thumbnail_tiers_always_emitted(self, files):
        """Even when the source is smaller than the tier dimensions,
        both `512.webp` and `1024.webp` are written. Pillow's
        `thumbnail()` doesn't upscale, so the smaller webp file just
        carries the source-sized content — the predictable contract
        is worth the bounded disk overhead."""
        png = _png_bytes((256, 256))
        f = await _add_image(files, png, "tiny.png")
        folder = files.files_dir / f.id
        assert (folder / "512.webp").exists()
        assert (folder / "1024.webp").exists()
        assert sorted(f.variants) == ["1024.webp", "512.webp", "original.png"]

    async def test_dedup_returns_existing_row(self, files):
        png = _png_bytes()
        f1 = await _add_image(files, png, "a.png")
        f2 = await _add_image(files, png, "b.png")
        # Same bytes → same id (the second add returns the existing row).
        assert f1.id == f2.id
        assert f1.hash == f2.hash
        # Only one folder on disk
        subdirs = [d for d in files.files_dir.iterdir() if d.is_dir()]
        assert len(subdirs) == 1

    async def test_different_content_different_id(self, files):
        f1 = await _add_image(files, _png_bytes(color=(10, 10, 10)), "a.png")
        f2 = await _add_image(files, _png_bytes(color=(200, 200, 200)), "b.png")
        assert f1.id != f2.id
        assert f1.hash != f2.hash

    async def test_rejects_oversized_file(self, files):
        big = b"x" * 1024
        with pytest.raises(ValueError, match="too large"):
            await files.add_file(
                _upload(big, "big.png"),
                kind="image", mime="image/png", max_size=100,
            )

    async def test_accepts_bytes_source(self, files):
        png = _png_bytes()
        f = await files.add_file(png, kind="image", mime="image/png", ext="png")
        assert f.size == len(png)
        assert (files.files_dir / f.id / "original.png").exists()

    async def test_accepts_path_source(self, files, tmp_path):
        png = _png_bytes()
        src = tmp_path / "src.png"
        src.write_bytes(png)
        f = await files.add_file(src, kind="image")
        assert f.ext == "png"
        assert (files.files_dir / f.id / "original.png").exists()

    async def test_other_kind_skips_thumbnails(self, files):
        f = await files.add_file(
            b"some opaque payload",
            kind="other", mime="application/octet-stream", ext="bin",
        )
        folder = files.files_dir / f.id
        assert (folder / "original.bin").exists()
        assert not (folder / "512.webp").exists()
        assert not (folder / "1024.webp").exists()
        assert f.variants == ["original.bin"]

    async def test_variants_recorded_in_db(self, files):
        png = _png_bytes((900, 600))
        f = await _add_image(files, png, "v.png")
        row = await files._db.fetchone(
            "SELECT variants FROM files WHERE id = ?", (f.id,),
        )
        assert sorted(json.loads(row["variants"])) == ["1024.webp", "512.webp", "original.png"]


class TestRefCounting:
    async def test_increment_increases_count(self, files):
        f = await _add_image(files, _png_bytes(), "r.png")
        await files.increment_ref(f.id)
        assert await _ref_count(files, f.id) == 1

    async def test_multiple_increments(self, files):
        f = await _add_image(files, _png_bytes(), "r.png")
        await files.increment_ref(f.id)
        await files.increment_ref(f.id)
        await files.increment_ref(f.id)
        assert await _ref_count(files, f.id) == 3

    async def test_decrement_decreases_count(self, files):
        f = await _add_image(files, _png_bytes(), "r.png")
        await files.increment_ref(f.id)
        await files.increment_ref(f.id)
        await files.decrement_refs([f.id])
        assert await _ref_count(files, f.id) == 1

    async def test_decrement_does_not_remove_row_or_folder(self, files):
        """`decrement_refs` is pure ref-count work — cleanup is the
        reaper's job, not the consumer's."""
        f = await _add_image(files, _png_bytes(), "r.png")
        await files.increment_ref(f.id)
        await files.decrement_refs([f.id])
        assert await _ref_count(files, f.id) == 0
        assert (files.files_dir / f.id).exists()

    async def test_decrement_cannot_go_negative(self, files):
        f = await _add_image(files, _png_bytes(), "r.png")
        await files.decrement_refs([f.id])
        await files.decrement_refs([f.id])
        assert await _ref_count(files, f.id) == 0

    async def test_decrement_nonexistent_is_safe(self, files):
        # Should not raise
        await files.decrement_refs(["nonexistent-id"])
        await files.decrement_refs([])


class TestPruneOrphanFiles:
    async def test_stale_orphan_pruned(self, files):
        f = await _add_image(files, _png_bytes(), "stale.png")
        old = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
        await _set_created_at(files, f.id, old)

        pruned = await files.prune_orphan_files(max_age_hours=24)
        assert pruned == 1
        assert not (files.files_dir / f.id).exists()
        assert await _ref_count(files, f.id) is None

    async def test_fresh_orphan_survives(self, files):
        f = await _add_image(files, _png_bytes(), "fresh.png")
        pruned = await files.prune_orphan_files(max_age_hours=24)
        assert pruned == 0
        assert (files.files_dir / f.id).exists()

    async def test_referenced_file_never_pruned(self, files):
        """A file with ref_count > 0 must never be swept regardless of age."""
        f = await _add_image(files, _png_bytes(), "ref.png")
        await files.increment_ref(f.id)
        ancient = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
        await _set_created_at(files, f.id, ancient)

        pruned = await files.prune_orphan_files(max_age_hours=24)
        assert pruned == 0
        assert (files.files_dir / f.id).exists()

    async def test_prune_scoped_to_ttl(self, files):
        stale = await _add_image(files, _png_bytes(color=(1, 1, 1)), "s.png")
        fresh = await _add_image(files, _png_bytes(color=(2, 2, 2)), "f.png")
        old = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
        await _set_created_at(files, stale.id, old)

        pruned = await files.prune_orphan_files(max_age_hours=24)
        assert pruned == 1
        assert not (files.files_dir / stale.id).exists()
        assert (files.files_dir / fresh.id).exists()


class TestConcurrentAdds:
    async def test_same_content_settles_on_one_id(self, files):
        png = _png_bytes()

        async def _go(name: str):
            return await files.add_file(
                _upload(png, name), kind="image", mime="image/png",
            )

        f_a, f_b = await asyncio.gather(_go("a.png"), _go("b.png"))
        # Both callers see the same surviving id (the loser of the race
        # is folded onto the winner's row).
        assert f_a.id == f_b.id

        subdirs = [d for d in files.files_dir.iterdir() if d.is_dir()]
        assert len(subdirs) == 1, "no orphan folder from the loser of the race"


class TestGetFilePath:
    async def test_returns_path_for_existing_variant(self, files):
        f = await _add_image(files, _png_bytes(), "p.png")
        path = files.get_file_path(f.id, "512.webp")
        assert path is not None
        assert path.exists()

    async def test_returns_path_for_original(self, files):
        f = await _add_image(files, _png_bytes(), "p.png")
        path = files.get_file_path(f.id, "original.png")
        assert path is not None
        assert path.exists()

    async def test_returns_none_for_missing_id(self, files):
        assert files.get_file_path("doesnotexist", "original.png") is None

    async def test_returns_none_for_missing_variant(self, files):
        f = await _add_image(files, _png_bytes(), "p.png")
        assert files.get_file_path(f.id, "9999.webp") is None

    async def test_rejects_traversal_in_id(self, files):
        assert files.get_file_path("..", "original.png") is None
        assert files.get_file_path("a/b", "original.png") is None

    async def test_rejects_traversal_in_filename(self, files):
        f = await _add_image(files, _png_bytes(), "p.png")
        assert files.get_file_path(f.id, "../etc/passwd") is None
        assert files.get_file_path(f.id, "../../") is None
