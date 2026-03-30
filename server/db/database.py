import aiosqlite
from pathlib import Path

_db_path: Path | None = None


async def init_db(db_path: Path) -> None:
    global _db_path
    _db_path = db_path

    async with aiosqlite.connect(str(db_path)) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS generations (
                id            TEXT PRIMARY KEY,
                effect_id     TEXT NOT NULL,
                effect_name   TEXT NOT NULL,
                model_id      TEXT NOT NULL,
                status        TEXT NOT NULL,
                progress      INTEGER DEFAULT 0,
                progress_msg  TEXT,
                video_url     TEXT,
                thumbnail_url TEXT,
                inputs_json   TEXT,
                prompt_used   TEXT,
                error         TEXT,
                created_at    TEXT NOT NULL,
                updated_at    TEXT NOT NULL,
                duration_ms   INTEGER
            )
        """)
        await db.commit()
