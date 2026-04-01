"""Tests for StorageService — UUID-based uploads with resizing and ref counting."""
import io
import asyncio
import pytest
from pathlib import Path
from unittest.mock import MagicMock

import aiosqlite

from db.database import init_db
from services.storage_service import StorageService


@pytest.fixture
def storage(tmp_path):
    uploads_dir = tmp_path / "uploads"
    uploads_dir.mkdir()
    db_path = tmp_path / "test.db"
    asyncio.run(init_db(db_path))
    return StorageService(uploads_dir, db_path)


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


def upload(storage, content, filename="test.jpg", max_size=10_000_000):
    """Helper: upload and return (ref_id, ext, original_filename, size)."""
    file = make_upload_file(content, filename)
    return asyncio.run(storage.save_upload(filename, file, max_size))


class TestSaveUpload:
    def test_returns_uuid_ref_id(self, storage):
        ref_id, ext, orig, size = upload(storage, b"hello world", "photo.jpg")
        assert "-" in ref_id
        assert ext == "jpg"
        assert orig == "photo.jpg"
        assert size == 11

    def test_folder_created_with_variants(self, storage):
        ref_id, ext, _, _ = upload(storage, b"test data", "img.jpg")
        upload_dir = storage._uploads_dir / ref_id
        assert upload_dir.is_dir()
        assert (upload_dir / "original.jpg").exists()
        assert len(list(upload_dir.glob("2048.*"))) == 1
        assert len(list(upload_dir.glob("512.*"))) == 1

    def test_dedup_same_content(self, storage):
        h1, _, _, _ = upload(storage, b"identical bytes", "a.jpg")
        h2, _, _, _ = upload(storage, b"identical bytes", "b.jpg")
        assert h1 == h2

    def test_different_content_different_id(self, storage):
        h1, _, _, _ = upload(storage, b"content A", "a.jpg")
        h2, _, _, _ = upload(storage, b"content B", "b.jpg")
        assert h1 != h2

    def test_rejects_oversized_file(self, storage):
        with pytest.raises(ValueError, match="too large"):
            upload(storage, b"x" * 100, "big.jpg", max_size=50)


class TestRefCounting:
    def _get_ref_count(self, storage, ref_id):
        async def check():
            async with aiosqlite.connect(str(storage._db_path)) as db:
                cursor = await db.execute("SELECT ref_count FROM uploads WHERE id = ?", (ref_id,))
                row = await cursor.fetchone()
                return row[0] if row else None
        return asyncio.run(check())

    def test_increment_increases_count(self, storage):
        ref_id, _, _, _ = upload(storage, b"ref test", "r.jpg")
        asyncio.run(storage.increment_ref(ref_id))
        assert self._get_ref_count(storage, ref_id) == 1

    def test_multiple_increments(self, storage):
        ref_id, _, _, _ = upload(storage, b"multi ref", "m.jpg")
        asyncio.run(storage.increment_ref(ref_id))
        asyncio.run(storage.increment_ref(ref_id))
        asyncio.run(storage.increment_ref(ref_id))
        assert self._get_ref_count(storage, ref_id) == 3

    def test_decrement_decreases_count(self, storage):
        ref_id, _, _, _ = upload(storage, b"dec test", "d.jpg")
        asyncio.run(storage.increment_ref(ref_id))
        asyncio.run(storage.increment_ref(ref_id))
        asyncio.run(storage.decrement_refs_and_cleanup([ref_id]))
        assert self._get_ref_count(storage, ref_id) == 1

    def test_decrement_to_zero_deletes_folder(self, storage):
        ref_id, _, _, _ = upload(storage, b"orphan test", "o.jpg")
        asyncio.run(storage.increment_ref(ref_id))
        asyncio.run(storage.decrement_refs_and_cleanup([ref_id]))
        assert not (storage._uploads_dir / ref_id).exists()
        assert self._get_ref_count(storage, ref_id) is None

    def test_decrement_cannot_go_negative(self, storage):
        ref_id, _, _, _ = upload(storage, b"no negative", "n.jpg")
        asyncio.run(storage.increment_ref(ref_id))
        asyncio.run(storage.decrement_refs_and_cleanup([ref_id]))
        asyncio.run(storage.decrement_refs_and_cleanup([ref_id]))
        assert not (storage._uploads_dir / ref_id).exists()

    def test_shared_image_survives_first_delete(self, storage):
        ref_id, _, _, _ = upload(storage, b"shared image", "s.jpg")
        asyncio.run(storage.increment_ref(ref_id))
        asyncio.run(storage.increment_ref(ref_id))
        asyncio.run(storage.decrement_refs_and_cleanup([ref_id]))
        assert (storage._uploads_dir / ref_id).exists()
        asyncio.run(storage.decrement_refs_and_cleanup([ref_id]))
        assert not (storage._uploads_dir / ref_id).exists()

    def test_decrement_nonexistent_is_safe(self, storage):
        asyncio.run(storage.decrement_refs_and_cleanup(["nonexistent-uuid"]))

    def test_decrement_multiple_at_once(self, storage):
        h1, _, _, _ = upload(storage, b"img one", "1.jpg")
        h2, _, _, _ = upload(storage, b"img two", "2.jpg")
        asyncio.run(storage.increment_ref(h1))
        asyncio.run(storage.increment_ref(h2))
        asyncio.run(storage.decrement_refs_and_cleanup([h1, h2]))
        assert not (storage._uploads_dir / h1).exists()
        assert not (storage._uploads_dir / h2).exists()


class TestGetUploadPath:
    def test_returns_path_for_existing(self, storage):
        ref_id, _, _, _ = upload(storage, b"path test", "p.jpg")
        path = storage.get_upload_path(ref_id, "2048")
        assert path is not None
        assert path.exists()

    def test_returns_none_for_missing(self, storage):
        assert storage.get_upload_path("doesnotexist", "2048") is None

    def test_preview_variant_exists(self, storage):
        ref_id, _, _, _ = upload(storage, b"preview test", "p.jpg")
        path = storage.get_upload_path(ref_id, "512")
        assert path is not None
        assert path.exists()
