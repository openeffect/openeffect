"""Tests for StorageService — content-addressable uploads and ref counting."""
import io
import asyncio
import pytest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

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
    """Create a mock UploadFile."""
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


class TestSaveUpload:
    def test_returns_hash_filename(self, storage):
        file = make_upload_file(b"hello world", "photo.jpg")
        hash_fn, orig, size = asyncio.run(storage.save_upload("photo.jpg", file, 10_000_000))
        assert hash_fn.endswith(".jpg")
        assert len(hash_fn.split(".")[0]) == 20
        assert orig == "photo.jpg"
        assert size == 11

    def test_file_stored_on_disk(self, storage):
        file = make_upload_file(b"test data", "img.png")
        hash_fn, _, _ = asyncio.run(storage.save_upload("img.png", file, 10_000_000))
        assert (storage._uploads_dir / hash_fn).exists()

    def test_dedup_same_content(self, storage):
        content = b"identical bytes"
        f1 = make_upload_file(content, "a.jpg")
        f2 = make_upload_file(content, "b.jpg")
        h1, _, _ = asyncio.run(storage.save_upload("a.jpg", f1, 10_000_000))
        h2, _, _ = asyncio.run(storage.save_upload("b.jpg", f2, 10_000_000))
        assert h1 == h2
        # Only one file on disk
        files = list(storage._uploads_dir.glob("*"))
        non_tmp = [f for f in files if not f.name.endswith(".tmp")]
        assert len(non_tmp) == 1

    def test_different_content_different_hash(self, storage):
        f1 = make_upload_file(b"content A", "a.jpg")
        f2 = make_upload_file(b"content B", "b.jpg")
        h1, _, _ = asyncio.run(storage.save_upload("a.jpg", f1, 10_000_000))
        h2, _, _ = asyncio.run(storage.save_upload("b.jpg", f2, 10_000_000))
        assert h1 != h2

    def test_rejects_oversized_file(self, storage):
        file = make_upload_file(b"x" * 100, "big.jpg")
        with pytest.raises(ValueError, match="too large"):
            asyncio.run(storage.save_upload("big.jpg", file, 50))


class TestRefCounting:
    def test_increment_increases_count(self, storage):
        file = make_upload_file(b"ref test", "r.jpg")
        hash_fn, _, _ = asyncio.run(storage.save_upload("r.jpg", file, 10_000_000))

        asyncio.run(storage.increment_ref(hash_fn))

        # Check DB
        async def check():
            async with aiosqlite.connect(str(storage._db_path)) as db:
                cursor = await db.execute("SELECT ref_count FROM uploads WHERE hash = ?",
                                          (hash_fn.split(".")[0],))
                row = await cursor.fetchone()
                return row[0]

        assert asyncio.run(check()) == 1

    def test_multiple_increments(self, storage):
        file = make_upload_file(b"multi ref", "m.jpg")
        hash_fn, _, _ = asyncio.run(storage.save_upload("m.jpg", file, 10_000_000))

        asyncio.run(storage.increment_ref(hash_fn))
        asyncio.run(storage.increment_ref(hash_fn))
        asyncio.run(storage.increment_ref(hash_fn))

        async def check():
            async with aiosqlite.connect(str(storage._db_path)) as db:
                cursor = await db.execute("SELECT ref_count FROM uploads WHERE hash = ?",
                                          (hash_fn.split(".")[0],))
                return (await cursor.fetchone())[0]

        assert asyncio.run(check()) == 3

    def test_decrement_decreases_count(self, storage):
        file = make_upload_file(b"dec test", "d.jpg")
        hash_fn, _, _ = asyncio.run(storage.save_upload("d.jpg", file, 10_000_000))

        asyncio.run(storage.increment_ref(hash_fn))
        asyncio.run(storage.increment_ref(hash_fn))
        asyncio.run(storage.decrement_refs_and_cleanup([hash_fn]))

        async def check():
            async with aiosqlite.connect(str(storage._db_path)) as db:
                cursor = await db.execute("SELECT ref_count FROM uploads WHERE hash = ?",
                                          (hash_fn.split(".")[0],))
                return (await cursor.fetchone())[0]

        assert asyncio.run(check()) == 1

    def test_decrement_to_zero_deletes_file(self, storage):
        file = make_upload_file(b"orphan test", "o.jpg")
        hash_fn, _, _ = asyncio.run(storage.save_upload("o.jpg", file, 10_000_000))

        asyncio.run(storage.increment_ref(hash_fn))
        asyncio.run(storage.decrement_refs_and_cleanup([hash_fn]))

        # File should be deleted
        assert not (storage._uploads_dir / hash_fn).exists()

        # DB record should be deleted
        async def check():
            async with aiosqlite.connect(str(storage._db_path)) as db:
                cursor = await db.execute("SELECT hash FROM uploads WHERE hash = ?",
                                          (hash_fn.split(".")[0],))
                return await cursor.fetchone()

        assert asyncio.run(check()) is None

    def test_decrement_cannot_go_negative(self, storage):
        file = make_upload_file(b"no negative", "n.jpg")
        hash_fn, _, _ = asyncio.run(storage.save_upload("n.jpg", file, 10_000_000))

        # ref_count starts at 0, increment once
        asyncio.run(storage.increment_ref(hash_fn))
        # Decrement twice — should not go below 0
        asyncio.run(storage.decrement_refs_and_cleanup([hash_fn]))
        asyncio.run(storage.decrement_refs_and_cleanup([hash_fn]))

        # File already deleted after first decrement, second is a no-op
        assert not (storage._uploads_dir / hash_fn).exists()

    def test_shared_image_survives_first_delete(self, storage):
        """Two generations reference the same image. Deleting one keeps the file."""
        file = make_upload_file(b"shared image", "s.jpg")
        hash_fn, _, _ = asyncio.run(storage.save_upload("s.jpg", file, 10_000_000))

        # Two generations reference it
        asyncio.run(storage.increment_ref(hash_fn))
        asyncio.run(storage.increment_ref(hash_fn))

        # Delete first generation
        asyncio.run(storage.decrement_refs_and_cleanup([hash_fn]))

        # File should still exist (ref_count = 1)
        assert (storage._uploads_dir / hash_fn).exists()

        # Delete second generation
        asyncio.run(storage.decrement_refs_and_cleanup([hash_fn]))

        # Now file should be deleted
        assert not (storage._uploads_dir / hash_fn).exists()

    def test_decrement_nonexistent_hash_is_safe(self, storage):
        """Decrementing a hash that doesn't exist should not crash."""
        asyncio.run(storage.decrement_refs_and_cleanup(["nonexistent.jpg"]))

    def test_decrement_multiple_hashes_at_once(self, storage):
        f1 = make_upload_file(b"img one", "1.jpg")
        f2 = make_upload_file(b"img two", "2.jpg")
        h1, _, _ = asyncio.run(storage.save_upload("1.jpg", f1, 10_000_000))
        h2, _, _ = asyncio.run(storage.save_upload("2.jpg", f2, 10_000_000))

        asyncio.run(storage.increment_ref(h1))
        asyncio.run(storage.increment_ref(h2))

        # Decrement both at once
        asyncio.run(storage.decrement_refs_and_cleanup([h1, h2]))

        # Both should be deleted
        assert not (storage._uploads_dir / h1).exists()
        assert not (storage._uploads_dir / h2).exists()


class TestGetUploadPath:
    def test_returns_path_for_existing(self, storage):
        file = make_upload_file(b"path test", "p.jpg")
        hash_fn, _, _ = asyncio.run(storage.save_upload("p.jpg", file, 10_000_000))
        path = storage.get_upload_path(hash_fn)
        assert path is not None
        assert path.exists()

    def test_returns_none_for_missing(self, storage):
        assert storage.get_upload_path("doesnotexist.jpg") is None
