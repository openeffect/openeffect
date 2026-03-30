import aiofiles
from pathlib import Path
from fastapi import UploadFile


CHUNK_SIZE = 64 * 1024  # 64KB


class StorageService:
    def __init__(self, tmp_dir: Path):
        self._tmp_dir = tmp_dir
        self._tmp_dir.mkdir(parents=True, exist_ok=True)

    async def save(self, filename: str, content: bytes) -> Path:
        path = self._tmp_dir / filename
        async with aiofiles.open(path, "wb") as f:
            await f.write(content)
        return path

    async def save_upload(self, filename: str, file: UploadFile, max_size: int) -> tuple[Path, int]:
        """Stream an upload to disk in chunks. Returns (path, total_bytes).
        Raises ValueError if file exceeds max_size."""
        path = self._tmp_dir / filename
        total = 0
        async with aiofiles.open(path, "wb") as f:
            while chunk := await file.read(CHUNK_SIZE):
                total += len(chunk)
                if total > max_size:
                    await f.close()
                    path.unlink(missing_ok=True)
                    raise ValueError("File too large")
                await f.write(chunk)
        return path, total

    def get_path(self, ref_id: str) -> Path | None:
        matches = list(self._tmp_dir.glob(f"{ref_id}.*"))
        if matches:
            return matches[0]
        return None

    async def cleanup(self, ref_id: str) -> None:
        matches = list(self._tmp_dir.glob(f"{ref_id}.*"))
        for path in matches:
            path.unlink(missing_ok=True)
