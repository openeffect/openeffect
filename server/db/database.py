import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import aiosqlite


class Database:
    """One aiosqlite connection per process, shared across services.

    aiosqlite runs SQLite on a dedicated background thread, so sharing a single
    connection across concurrent async callers is safe — the thread serializes
    reads and writes. WAL mode lets the single-writer constraint stop blocking
    readers. A single shared connection can only hold one open transaction,
    though, so `transaction()` serializes callers with `_tx_lock`.
    """

    def __init__(self, path: Path):
        self._path = path
        self._conn: aiosqlite.Connection | None = None
        self._tx_lock = asyncio.Lock()

    async def connect(self) -> None:
        if self._conn is not None:
            return
        conn = await aiosqlite.connect(str(self._path))
        conn.row_factory = aiosqlite.Row
        await conn.execute("PRAGMA journal_mode=WAL")
        await conn.execute("PRAGMA synchronous=NORMAL")
        self._conn = conn

    async def close(self) -> None:
        if self._conn is None:
            return
        await self._conn.close()
        self._conn = None

    @property
    def conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("Database.connect() must be called first")
        return self._conn

    async def execute(self, sql: str, params: tuple[Any, ...] = ()) -> aiosqlite.Cursor:
        return await self.conn.execute(sql, params)

    async def fetchone(self, sql: str, params: tuple[Any, ...] = ()) -> aiosqlite.Row | None:
        cursor = await self.conn.execute(sql, params)
        return await cursor.fetchone()

    async def fetchall(self, sql: str, params: tuple[Any, ...] = ()) -> list[aiosqlite.Row]:
        cursor = await self.conn.execute(sql, params)
        rows = await cursor.fetchall()
        return list(rows)

    async def commit(self) -> None:
        await self.conn.commit()

    @asynccontextmanager
    async def transaction(self) -> AsyncIterator[aiosqlite.Connection]:
        """BEGIN IMMEDIATE → yield connection → commit or rollback. Callers
        serialize on `_tx_lock` so that concurrent coroutines don't both try
        to open a transaction on the shared connection (SQLite would reject
        the second BEGIN with "transaction within a transaction")."""
        async with self._tx_lock:
            await self.conn.execute("BEGIN IMMEDIATE")
            try:
                yield self.conn
                await self.conn.commit()
            except Exception:
                await self.conn.rollback()
                raise


async def init_db(db_path: Path) -> None:
    async with aiosqlite.connect(str(db_path)) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS runs (
                id                  TEXT PRIMARY KEY,
                kind                TEXT NOT NULL DEFAULT 'effect',
                effect_id           TEXT,
                effect_name         TEXT,
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
                slug          TEXT NOT NULL,
                source        TEXT NOT NULL,
                source_url    TEXT,
                manifest_yaml TEXT NOT NULL,
                assets_dir    TEXT NOT NULL,
                version       TEXT,
                installed_at  TEXT NOT NULL,
                updated_at    TEXT,
                is_favorite   INTEGER DEFAULT 0,
                UNIQUE(namespace, slug)
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
        await db.execute("""
            CREATE TABLE IF NOT EXISTS config (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        await db.execute("CREATE INDEX IF NOT EXISTS idx_runs_effect_id ON runs(effect_id, created_at DESC)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_uploads_orphan ON uploads(ref_count, created_at)")
        await db.commit()
