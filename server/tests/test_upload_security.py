"""Security-focused tests for the file upload endpoint."""
import asyncio
import io
from contextlib import asynccontextmanager
from pathlib import Path
from unittest.mock import MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from PIL import Image

from config.config_service import ConfigService
from core.limits import MAX_IMAGE_SIZE
from db.database import Database, init_db
from routes import register_routes
from services.effect_loader import EffectLoaderService
from services.file_service import FileService
from services.history_service import HistoryService
from services.install_service import InstallService
from services.model_service import ModelService


def _png_bytes(size: tuple[int, int] = (32, 32)) -> bytes:
    """Real PNG so the file store's thumbnail pipeline accepts it."""
    img = Image.new("RGB", size, color=(120, 60, 30))
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _padded_png(target_size: int) -> bytes:
    """Real PNG padded to the requested byte length using a tEXt chunk
    of arbitrary bytes. Pillow ignores unknown chunks but counts them
    in the total file size - useful for exercising the size cap with a
    file that's still a valid image."""
    base = _png_bytes((4, 4))
    if target_size <= len(base):
        return base
    # PNG structure: 8-byte signature, then chunks. A chunk is
    # length(4) + type(4) + data + crc(4). Insert a custom chunk
    # before IEND so Pillow still parses the file.
    iend_idx = base.rfind(b"IEND")
    # iend chunk starts 4 bytes before "IEND" (length field)
    insertion_point = iend_idx - 4

    pad_data_len = target_size - len(base) - 12  # 12 = chunk overhead
    if pad_data_len < 0:
        return base
    pad = b"\x00" * pad_data_len
    chunk = (
        pad_data_len.to_bytes(4, "big")
        + b"prVt"  # private custom type, lowercase first letter = ancillary
        + pad
        + b"\x00\x00\x00\x00"  # CRC; Pillow doesn't verify ancillary chunks
    )
    return base[:insertion_point] + chunk + base[insertion_point:]


@pytest.fixture
def files_dir(tmp_path):
    """Return the files storage directory for inspecting saved files."""
    d = tmp_path / "files"
    d.mkdir()
    return d


@pytest.fixture
def client(tmp_path, files_dir):
    """Build a test app; the Database connection opens inside TestClient's
    loop via lifespan so aiosqlite's loop-bound connection doesn't cross
    loops."""
    db_path = tmp_path / "test.db"
    models_dir = tmp_path / "models"
    models_dir.mkdir()

    asyncio.run(init_db(db_path))
    database = Database(db_path)

    @asynccontextmanager
    async def _lifespan(app: FastAPI):
        await database.connect()

        file_service = FileService(files_dir, database)
        install_service = InstallService(database, file_service)
        effect_loader = EffectLoaderService(install_service, database)
        await effect_loader.load_all()

        app.state.settings = MagicMock(update_version="")
        app.state.config_service = ConfigService(database, tmp_path / "config.json")
        app.state.install_service = install_service
        app.state.effect_loader = effect_loader
        app.state.run_service = MagicMock()
        app.state.history_service = HistoryService(database)
        app.state.model_service = ModelService(models_dir)
        app.state.file_service = file_service

        yield
        await database.close()

    app = FastAPI(title="OpenEffect", version="0.1.0", lifespan=_lifespan)
    register_routes(app)

    with TestClient(app) as c:
        yield c


class TestPathTraversal:
    def test_traversal_filename_stays_in_files_dir(self, client, files_dir):
        """A filename like ../../../etc/passwd must not write outside the storage dir."""
        content = _png_bytes()
        resp = client.post(
            "/api/files",
            files={"file": ("../../../etc/passwd", io.BytesIO(content), "image/png")},
        )
        if resp.status_code == 200:
            assert not Path("/etc/passwd").exists() or Path("/etc/passwd").stat().st_size != len(content)
            saved_files = [f for f in files_dir.iterdir() if not f.name.endswith(".tmp")]
            for f in saved_files:
                assert ".." not in f.name

    def test_serve_path_traversal_rejected(self, client):
        """GET /api/files/ with traversal components should be rejected."""
        resp = client.get("/api/files/../../../etc/passwd/512.webp")
        assert resp.status_code in (400, 404)

    def test_serve_unknown_hash_returns_404(self, client):
        resp = client.get("/api/files/0123456789abcdef/512.webp")
        assert resp.status_code == 404


class TestMaliciousFilenames:
    def test_null_byte_in_filename(self, client, files_dir):
        """Null bytes in filenames should not cause crashes."""
        content = _png_bytes()
        resp = client.post(
            "/api/files",
            files={"file": ("image\x00.png", io.BytesIO(content), "image/png")},
        )
        # Should either succeed safely or reject
        assert resp.status_code in (200, 400, 415, 422)

    def test_empty_filename(self, client):
        """An empty filename should still produce a valid id."""
        content = _png_bytes()
        resp = client.post(
            "/api/files",
            files={"file": ("", io.BytesIO(content), "image/png")},
        )
        if resp.status_code == 200:
            data = resp.json()
            assert "id" in data

    def test_very_long_filename(self, client, files_dir):
        """A 1000-char filename should not crash the server."""
        long_name = "a" * 995 + ".png"
        content = _png_bytes()
        resp = client.post(
            "/api/files",
            files={"file": (long_name, io.BytesIO(content), "image/png")},
        )
        assert resp.status_code in (200, 400, 413, 422)
        if resp.status_code == 200:
            data = resp.json()
            assert "id" in data
            saved_files = [f for f in files_dir.iterdir() if not f.name.endswith(".tmp")]
            for f in saved_files:
                # Stored folder name is a uuid7 (~36 chars), not the
                # long upload name.
                assert len(f.name) < 200

    def test_filename_with_special_chars(self, client):
        """Filenames with special characters should be handled safely."""
        content = _png_bytes()
        resp = client.post(
            "/api/files",
            files={"file": ("img;rm -rf /.png", io.BytesIO(content), "image/png")},
        )
        if resp.status_code == 200:
            data = resp.json()
            assert "id" in data


class TestContentTypeValidation:
    def test_wrong_content_type_header_rejected(self, client):
        """File claims image/jpeg but ships plain text - rejected by the
        magic-byte sniff."""
        text_content = b"This is definitely not a JPEG image at all."
        resp = client.post(
            "/api/files",
            files={"file": ("fake.jpg", io.BytesIO(text_content), "image/jpeg")},
        )
        assert resp.status_code == 415
        assert resp.json()["detail"]["code"] == "UNSUPPORTED_TYPE"


class TestFileSizeLimits:
    def test_image_at_exact_cap_accepted(self, client):
        """An image exactly at MAX_IMAGE_SIZE is accepted."""
        content = _padded_png(MAX_IMAGE_SIZE)
        assert len(content) == MAX_IMAGE_SIZE
        resp = client.post(
            "/api/files",
            files={"file": ("big.png", io.BytesIO(content), "image/png")},
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["size"] == MAX_IMAGE_SIZE

    def test_image_one_byte_over_cap_rejected(self, client):
        """An image one byte over MAX_IMAGE_SIZE is rejected with 413
        before we ever try to thumbnail it."""
        content = _padded_png(MAX_IMAGE_SIZE + 1)
        resp = client.post(
            "/api/files",
            files={"file": ("toobig.png", io.BytesIO(content), "image/png")},
        )
        assert resp.status_code == 413
        assert resp.json()["detail"]["code"] == "FILE_TOO_LARGE"

    def test_video_larger_than_image_cap_uses_video_cap(self, client):
        """Videos get their own (higher) cap. The size check fires
        before thumbnail generation, so a fake-bytes payload at
        (MAX_IMAGE_SIZE + 1) is rejected only if the route used the
        image cap. We can verify the right cap kicked in by sending
        bytes that exceed the image cap as a video - they'll fail
        thumbnailing (not real video bytes) but the size check
        should have passed first, surfacing as 400, not 413."""
        content = b"\x00\x00\x00\x20ftypisom" + b"\x00" * (MAX_IMAGE_SIZE + 1024)
        resp = client.post(
            "/api/files",
            files={"file": ("clip.mp4", io.BytesIO(content), "video/mp4")},
        )
        # 400 = thumbnail generation failed (size check passed → video cap).
        # 413 would mean the size check used the image cap - that's the bug.
        assert resp.status_code != 413, (
            "video cap should be higher than image cap; "
            f"got 413 with body {resp.json()}"
        )

    def test_empty_file_rejected(self, client):
        """A zero-byte file can't carry a magic signature - rejected by the
        sniffer rather than accepted-at-zero-size."""
        resp = client.post(
            "/api/files",
            files={"file": ("empty.png", io.BytesIO(b""), "image/png")},
        )
        assert resp.status_code == 415
        assert resp.json()["detail"]["code"] == "UNSUPPORTED_TYPE"
