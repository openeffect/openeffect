import aiosqlite
from pathlib import Path

_db_path: Path | None = None


async def init_db(db_path: Path) -> None:
    global _db_path
    _db_path = db_path

    async with aiosqlite.connect(str(db_path)) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS runs (
                id                  TEXT PRIMARY KEY,
                effect_id           TEXT NOT NULL,
                effect_name         TEXT NOT NULL,
                model_id            TEXT NOT NULL,
                status              TEXT NOT NULL,
                progress            INTEGER DEFAULT 0,
                progress_msg        TEXT,
                video_url           TEXT,
                inputs              TEXT,
                error               TEXT,
                created_at          TEXT NOT NULL,
                updated_at          TEXT NOT NULL,
                duration_ms         INTEGER,
                provider_request_id TEXT,
                provider_endpoint   TEXT
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS effects (
                id            TEXT PRIMARY KEY,
                namespace     TEXT NOT NULL,
                effect_id     TEXT NOT NULL,
                source        TEXT NOT NULL,
                source_url    TEXT,
                manifest_yaml TEXT NOT NULL,
                assets_dir    TEXT NOT NULL,
                version       TEXT,
                installed_at  TEXT NOT NULL,
                updated_at    TEXT,
                UNIQUE(namespace, effect_id)
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS uploads (
                id         TEXT PRIMARY KEY,
                hash       TEXT NOT NULL UNIQUE,
                filename   TEXT NOT NULL,
                ext        TEXT NOT NULL,
                mime       TEXT NOT NULL,
                size       INTEGER NOT NULL,
                ref_count  INTEGER DEFAULT 0,
                created_at TEXT NOT NULL
            )
        """)
        # Indexes for common query patterns
        await db.execute("CREATE INDEX IF NOT EXISTS idx_runs_effect_id ON runs(effect_id, created_at DESC)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)")
        await db.commit()
