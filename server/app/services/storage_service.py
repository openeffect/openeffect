import aiofiles
from pathlib import Path


class StorageService:
    def __init__(self, tmp_dir: Path):
        self._tmp_dir = tmp_dir
        self._tmp_dir.mkdir(parents=True, exist_ok=True)

    async def save(self, filename: str, content: bytes) -> Path:
        path = self._tmp_dir / filename
        async with aiofiles.open(path, "wb") as f:
            await f.write(content)
        return path

    def get_path(self, ref_id: str) -> Path | None:
        matches = list(self._tmp_dir.glob(f"{ref_id}.*"))
        if matches:
            return matches[0]
        return None

    async def cleanup(self, ref_id: str) -> None:
        matches = list(self._tmp_dir.glob(f"{ref_id}.*"))
        for path in matches:
            path.unlink(missing_ok=True)
