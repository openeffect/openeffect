"""Tests for StorageService — UUID-based uploads with resizing and ref counting."""
import asyncio
import io
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

from db.database import Database, init_db
from services.storage_service import StorageService


@pytest.fixture
async def storage(tmp_path):
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir()
    db_path = tmp_path / "test.db"
    await init_db(db_path)
    db = Database(db_path)
    await db.connect()
    yield StorageService(uploads_dir, db)
    await db.close()


def make_upload_file(content: bytes, filename: str = "test.jpg", content_type: str = "image/jpeg"):
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


async def upload(storage, content, filename="test.jpg", max_size=10_000_000):
    """Helper: upload and return (ref_id, ext, original_filename, size)."""
    file = make_upload_file(content, filename)
    return await storage.save_upload(filename, file, max_size)


async def _get_ref_count(storage, ref_id):
    row = await storage._db.fetchone(
        "SELECT ref_count FROM uploads WHERE id = ?", (ref_id,)
    )
    return row[0] if row else None


async def _set_created_at(storage, ref_id, timestamp: str):
    async with storage._db.transaction() as conn:
        await conn.execute(
            "UPDATE uploads SET created_at = ? WHERE id = ?", (timestamp, ref_id)
        )


class TestSaveUpload:
    async def test_returns_uuid_ref_id(self, storage):
        ref_id, ext, orig, size = await upload(storage, b"hello world", "photo.jpg")
        assert "-" in ref_id
        assert ext == "jpg"
        assert orig == "photo.jpg"
        assert size == 11

    async def test_folder_created_with_variants(self, storage):
        ref_id, ext, _, _ = await upload(storage, b"test data", "img.jpg")
        upload_dir = storage._uploads_dir / ref_id
        assert upload_dir.is_dir()
        assert (upload_dir / "original.jpg").exists()
        assert len(list(upload_dir.glob("2048.*"))) == 1
        assert len(list(upload_dir.glob("512.*"))) == 1

    async def test_dedup_same_content(self, storage):
        h1, _, _, _ = await upload(storage, b"identical bytes", "a.jpg")
        h2, _, _, _ = await upload(storage, b"identical bytes", "b.jpg")
        assert h1 == h2

    async def test_different_content_different_id(self, storage):
        h1, _, _, _ = await upload(storage, b"content A", "a.jpg")
        h2, _, _, _ = await upload(storage, b"content B", "b.jpg")
        assert h1 != h2

    async def test_rejects_oversized_file(self, storage):
        with pytest.raises(ValueError, match="too large"):
            await upload(storage, b"x" * 100, "big.jpg", max_size=50)


class TestRefCounting:
    async def test_increment_increases_count(self, storage):
        ref_id, _, _, _ = await upload(storage, b"ref test", "r.jpg")
        await storage.increment_ref(ref_id)
        assert await _get_ref_count(storage, ref_id) == 1

    async def test_multiple_increments(self, storage):
        ref_id, _, _, _ = await upload(storage, b"multi ref", "m.jpg")
        await storage.increment_ref(ref_id)
        await storage.increment_ref(ref_id)
        await storage.increment_ref(ref_id)
        assert await _get_ref_count(storage, ref_id) == 3

    async def test_decrement_decreases_count(self, storage):
        ref_id, _, _, _ = await upload(storage, b"dec test", "d.jpg")
        await storage.increment_ref(ref_id)
        await storage.increment_ref(ref_id)
        await storage.decrement_refs_and_cleanup([ref_id])
        assert await _get_ref_count(storage, ref_id) == 1

    async def test_decrement_to_zero_deletes_folder(self, storage):
        ref_id, _, _, _ = await upload(storage, b"orphan test", "o.jpg")
        await storage.increment_ref(ref_id)
        await storage.decrement_refs_and_cleanup([ref_id])
        assert not (storage._uploads_dir / ref_id).exists()
        assert await _get_ref_count(storage, ref_id) is None

    async def test_decrement_cannot_go_negative(self, storage):
        ref_id, _, _, _ = await upload(storage, b"no negative", "n.jpg")
        await storage.increment_ref(ref_id)
        await storage.decrement_refs_and_cleanup([ref_id])
        await storage.decrement_refs_and_cleanup([ref_id])
        assert not (storage._uploads_dir / ref_id).exists()

    async def test_shared_image_survives_first_delete(self, storage):
        ref_id, _, _, _ = await upload(storage, b"shared image", "s.jpg")
        await storage.increment_ref(ref_id)
        await storage.increment_ref(ref_id)
        await storage.decrement_refs_and_cleanup([ref_id])
        assert (storage._uploads_dir / ref_id).exists()
        await storage.decrement_refs_and_cleanup([ref_id])
        assert not (storage._uploads_dir / ref_id).exists()

    async def test_decrement_nonexistent_is_safe(self, storage):
        await storage.decrement_refs_and_cleanup(["nonexistent-uuid"])

    async def test_decrement_multiple_at_once(self, storage):
        h1, _, _, _ = await upload(storage, b"img one", "1.jpg")
        h2, _, _, _ = await upload(storage, b"img two", "2.jpg")
        await storage.increment_ref(h1)
        await storage.increment_ref(h2)
        await storage.decrement_refs_and_cleanup([h1, h2])
        assert not (storage._uploads_dir / h1).exists()
        assert not (storage._uploads_dir / h2).exists()


class TestPruneOrphans:
    async def test_stale_orphan_pruned(self, storage):
        ref_id, _, _, _ = await upload(storage, b"stale orphan", "s.jpg")
        old = (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat()
        await _set_created_at(storage, ref_id, old)

        pruned = await storage.prune_orphans(max_age_hours=24)
        assert pruned == 1
        assert not (storage._uploads_dir / ref_id).exists()

    async def test_fresh_orphan_survives(self, storage):
        ref_id, _, _, _ = await upload(storage, b"fresh orphan", "f.jpg")
        pruned = await storage.prune_orphans(max_age_hours=24)
        assert pruned == 0
        assert (storage._uploads_dir / ref_id).exists()

    async def test_referenced_upload_never_pruned(self, storage):
        """An upload used by a run (ref_count > 0) must never be swept up,
        no matter how old it is."""
        ref_id, _, _, _ = await upload(storage, b"referenced", "r.jpg")
        await storage.increment_ref(ref_id)
        ancient = (datetime.now(timezone.utc) - timedelta(days=365)).isoformat()
        await _set_created_at(storage, ref_id, ancient)

        pruned = await storage.prune_orphans(max_age_hours=24)
        assert pruned == 0
        assert (storage._uploads_dir / ref_id).exists()

    async def test_prune_scoped_to_ttl(self, storage):
        """Two orphans: one stale, one fresh. Only the stale one goes."""
        stale, _, _, _ = await upload(storage, b"stale two", "s2.jpg")
        fresh, _, _, _ = await upload(storage, b"fresh two", "f2.jpg")
        old = (datetime.now(timezone.utc) - timedelta(hours=48)).isoformat()
        await _set_created_at(storage, stale, old)

        pruned = await storage.prune_orphans(max_age_hours=24)
        assert pruned == 1
        assert not (storage._uploads_dir / stale).exists()
        assert (storage._uploads_dir / fresh).exists()


class TestConcurrentUploads:
    async def test_same_content_returns_same_ref_id(self, storage):
        """Two concurrent save_upload calls on identical bytes settle on a
        single ref_id — and only one upload folder exists on disk."""
        content = b"racing content that both callers see"

        async def _upload(name):
            return await storage.save_upload(
                name, make_upload_file(content, name), 10_000_000
            )

        (ref_a, _, _, _), (ref_b, _, _, _) = await asyncio.gather(
            _upload("a.jpg"), _upload("b.jpg"),
        )

        assert ref_a == ref_b, "concurrent identical uploads must dedupe to one ref"

        subdirs = [d for d in storage._uploads_dir.iterdir() if d.is_dir()]
        assert len(subdirs) == 1, "no orphan folder from the loser of the race"

        # Winner's folder has the original + both variants
        files = {f.name for f in subdirs[0].iterdir()}
        assert any(n.startswith("original.") for n in files)
        assert any(n.startswith("2048.") for n in files)
        assert any(n.startswith("512.") for n in files)


class TestGetUploadPath:
    async def test_returns_path_for_existing(self, storage):
        ref_id, _, _, _ = await upload(storage, b"path test", "p.jpg")
        path = storage.get_upload_path(ref_id, "2048")
        assert path is not None
        assert path.exists()

    async def test_returns_none_for_missing(self, storage):
        assert storage.get_upload_path("doesnotexist", "2048") is None

    async def test_preview_variant_exists(self, storage):
        ref_id, _, _, _ = await upload(storage, b"preview test", "p.jpg")
        path = storage.get_upload_path(ref_id, "512")
        assert path is not None
        assert path.exists()
