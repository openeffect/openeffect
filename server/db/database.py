import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import aiosqlite


class Database:
    """One aiosqlite connection per process, shared across services.

    aiosqlite runs SQLite on a dedicated background thread, so sharing a single
    connection across concurrent async callers is safe - the thread serializes
    reads and writes. WAL mode lets the single-writer constraint stop blocking
    readers. A single shared connection can only hold one open transaction,
    though, so `transaction()` serializes callers with `_tx_lock`.

    **Single-process invariant.** This whole design assumes exactly one
    process holds the SQLite file. The application is a desktop tool: one
    `uvicorn` worker, one event loop, one connection. The lock and the
    `_tx_lock` make that one process safe for concurrent coroutines, but
    they don't extend to a second process. Several pieces would have to
    change before scaling out:

    - The reaper TTL guards (`prune_orphan_files`, `prune_stale_lifecycle_rows`)
      assume any in-flight install/upload either belongs to *this* process
      or has been dead long enough that its refs and rows are abandoned.
      A second process inside the TTL window could legitimately be mid-write.
    - `_tx_lock` is per-process, so two writers across processes race at
      the SQLite layer - WAL would let a second BEGIN IMMEDIATE block
      until the first commits, which is correct but pessimal.
    - `RunService._broadcast_queues` and `_jobs` are in-process state, so
      SSE streams only see events from runs initiated through their own
      worker.

    To run multi-process: switch to a connection pool with per-connection
    locks (or drop `_tx_lock` entirely and let SQLite serialize), move
    in-memory job/queue state to Redis, and shorten the reaper TTL or
    add per-process tagging to in-flight rows.
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
        await conn.execute("PRAGMA foreign_keys=ON")
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
    """Schema conventions:
      - Lifecycle timestamps are ISO-8601 UTC strings (Python `datetime.isoformat()`).
        Effects use `installed_at` for row birth (domain language); runs use the
        generic `created_at`. Both tables track `updated_at` for the latest mutation.
      - Booleans are stored as INTEGER 0/1 (SQLite has no native BOOLEAN).
      - Enum-like TEXT columns document their value set inline; CHECK constraints
        are deferred until after the schema settles.
    """
    async with aiosqlite.connect(str(db_path)) as db:
        await db.execute("PRAGMA foreign_keys=ON")
        await db.execute("""
            CREATE TABLE IF NOT EXISTS runs (
                id                  TEXT PRIMARY KEY,
                kind                TEXT NOT NULL DEFAULT 'effect',  -- 'effect' | 'playground'
                -- effect_id is intentionally NOT a foreign key: runs survive effect
                -- deletion so history stays intact. effect_name snapshots the name at
                -- creation so the UI can render "Effect Foo (uninstalled)" without
                -- needing the effects row anymore.
                effect_id           TEXT,
                effect_name         TEXT,
                model_id            TEXT NOT NULL,
                status              TEXT NOT NULL,                   -- 'processing' | 'completed' | 'failed'
                progress            INTEGER DEFAULT 0,               -- 0..100
                progress_msg        TEXT,
                input_ids           TEXT,                            -- JSON array of files.id (for refcount tracking)
                output_id           TEXT,                            -- files.id of the result blob
                payload             TEXT,                            -- JSON: {record_version, inputs, params, ...}
                error               TEXT,                            -- plain message from provider/exception on failure
                created_at          TEXT NOT NULL,
                updated_at          TEXT NOT NULL,
                duration_ms         INTEGER,
                provider_request_id TEXT,                            -- provider-side id (e.g. fal request id)
                provider_endpoint   TEXT                             -- URL the provider request was POSTed to
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS effects (
                id            TEXT PRIMARY KEY,
                namespace     TEXT NOT NULL,
                slug          TEXT NOT NULL,
                source        TEXT NOT NULL,                                 -- 'official' | 'installed' | 'local'
                state         TEXT NOT NULL DEFAULT 'installing',            -- 'installing' | 'ready' | 'uninstalling'
                source_url    TEXT,                                          -- install URL when source='installed'
                manifest_yaml TEXT NOT NULL,
                version       TEXT,
                installed_at  TEXT NOT NULL,
                updated_at    TEXT NOT NULL,                                 -- set equal to installed_at on insert
                is_favorite   INTEGER DEFAULT 0,                             -- 0 | 1
                UNIQUE(namespace, slug)
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS files (
                id         TEXT PRIMARY KEY,        -- uuid7; the folder name and URL identifier
                hash       TEXT NOT NULL,           -- sha256; uniqueness enforced via partial index below
                kind       TEXT NOT NULL,           -- 'image' | 'video' | 'other'
                mime       TEXT NOT NULL,
                ext        TEXT NOT NULL,           -- canonical original extension (no dot)
                size       INTEGER NOT NULL,
                ref_count  INTEGER DEFAULT 0,       -- NULL marks a row tombstoned for GC
                created_at TEXT NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS effect_files (
                effect_id    TEXT NOT NULL,
                logical_name TEXT NOT NULL,         -- exactly what the manifest writes
                file_id      TEXT NOT NULL,
                PRIMARY KEY (effect_id, logical_name),
                FOREIGN KEY (effect_id) REFERENCES effects(id) ON DELETE CASCADE,
                FOREIGN KEY (file_id) REFERENCES files(id)
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS config (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
        """)
        await db.execute("CREATE INDEX IF NOT EXISTS idx_runs_effect_id_created_at ON runs(effect_id, created_at DESC)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status)")
        # Default `/api/runs` (no effect_id filter) does ORDER BY created_at DESC;
        # without this the composite index above can't help (leading column
        # `effect_id` isn't in the WHERE), so the query degrades to a full sort.
        await db.execute("CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at DESC)")
        await db.execute("CREATE INDEX IF NOT EXISTS idx_files_orphan ON files(ref_count, created_at)")
        # Partial unique index: hash uniqueness only constrains live rows.
        # Tombstoned rows (ref_count IS NULL) are mid-cleanup and don't
        # block a fresh upload of identical content from claiming a new id.
        # Required by the ON CONFLICT(hash) WHERE ref_count IS NOT NULL
        # clause in FileService.add_file.
        await db.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_files_hash_live "
            "ON files(hash) WHERE ref_count IS NOT NULL"
        )
        await db.execute("CREATE INDEX IF NOT EXISTS idx_effect_files_file_id ON effect_files(file_id)")
        # Speeds up the GC reaper's "abandoned installing/uninstalling rows"
        # scan as the effects table grows.
        await db.execute("CREATE INDEX IF NOT EXISTS idx_effects_pending ON effects(state, updated_at)")
        await db.commit()
