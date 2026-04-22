import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config.config_service import ConfigService
from config.settings import get_settings
from db.database import Database, init_db
from routes import register_routes
from services.effect_loader import EffectLoaderService
from services.history_service import HistoryService
from services.install_service import InstallService
from services.model_service import ModelService
from services.run_service import RunService
from services.storage_service import StorageService

logger = logging.getLogger(__name__)


async def _upload_reaper_loop(storage_service, ttl_hours: int, interval_seconds: int) -> None:
    """Periodically prune orphan uploads (ref_count=0 older than ttl_hours).
    Runs once immediately at startup, then on a sleep-loop."""
    while True:
        try:
            pruned = await storage_service.prune_orphans(ttl_hours)
            if pruned:
                logger.info("upload-reaper: pruned %d orphan upload(s)", pruned)
        except Exception as e:
            logger.warning("upload-reaper: failed: %s", e)
        try:
            await asyncio.sleep(interval_seconds)
        except asyncio.CancelledError:
            return


def _warn_if_exposed() -> None:
    """Warn when bound to a non-loopback address. There's no built-in auth,
    so external reach requires a reverse proxy / firewall in front.

    Reads OPENEFFECT_HOST directly: `run.py` decides the uvicorn bind, and
    the pydantic-settings field uses a different env name."""
    host = os.environ.get("OPENEFFECT_HOST", "127.0.0.1")
    if host in ("127.0.0.1", "localhost", "::1"):
        return
    logger.warning(
        "OPENEFFECT_HOST=%s: server is reachable over the network and has no "
        "built-in auth. Put it behind a reverse proxy with authentication or "
        "restrict access at the firewall. Anyone who can reach this port "
        "can drain your fal.ai credits.",
        host,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()

    _warn_if_exposed()

    settings.user_data_dir.mkdir(parents=True, exist_ok=True)
    (settings.user_data_dir / "uploads").mkdir(exist_ok=True)
    (settings.user_data_dir / "runs").mkdir(exist_ok=True)
    (settings.user_data_dir / "effects").mkdir(exist_ok=True)

    db_path = settings.user_data_dir / "openeffect.db"
    await init_db(db_path)
    database = Database(db_path)
    await database.connect()

    config_service = ConfigService(database)

    install_service = InstallService(
        db=database,
        effects_dir=settings.user_data_dir / "effects",
    )

    effect_loader = EffectLoaderService(
        install_service=install_service,
        bundled_dir=settings.effects_dir,
    )
    await effect_loader.load_all()

    storage_service = StorageService(
        uploads_dir=settings.user_data_dir / "uploads",
        db=database,
    )
    history_service = HistoryService(database)
    model_service = ModelService(settings.user_data_dir / "models")
    run_service = RunService(
        effect_loader=effect_loader,
        config_service=config_service,
        history_service=history_service,
        storage_service=storage_service,
        model_service=model_service,
    )

    # Resume any runs that were in flight when the process last exited
    await run_service.recover_stuck_jobs()

    app.state.settings = settings
    app.state.database = database
    app.state.config_service = config_service
    app.state.install_service = install_service
    app.state.effect_loader = effect_loader
    app.state.run_service = run_service
    app.state.history_service = history_service
    app.state.model_service = model_service
    app.state.storage_service = storage_service

    # Spawn the orphan-upload reaper. With eager client-side uploads, any
    # picked-but-never-run image sits at ref_count=0; this keeps disk usage
    # bounded without deleting anything a user might still care about.
    reaper_task = asyncio.create_task(
        _upload_reaper_loop(
            storage_service,
            settings.upload_ttl_hours,
            settings.upload_reaper_interval_seconds,
        )
    )
    app.state.upload_reaper_task = reaper_task

    yield

    reaper_task.cancel()
    try:
        await reaper_task
    except asyncio.CancelledError:
        pass
    await database.close()


def create_app() -> FastAPI:
    app = FastAPI(title="OpenEffect", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_routes(app)

    # Serve the built frontend in prod (Docker image / installed wheel), but
    # not in a source checkout — there Vite on :5173 handles it, and any
    # stale `client/dist/` from an old `pnpm build` would otherwise be
    # served silently. Mirrors the is-dev check in run.py: `client/src/` is
    # present in source trees, absent in installed/containerized deployments.
    client_dir = Path(__file__).parent.parent / "client"
    is_dev = (client_dir / "src").exists()
    static_dir = client_dir / "dist"
    if not is_dev and static_dir.exists():
        app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")

    return app


app = create_app()
