import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from config.config_service import ConfigService
from config.settings import get_settings
from db.database import Database, init_db
from routes import register_routes
from services.effect_loader import EffectLoaderService
from services.file_service import FileService
from services.history_service import HistoryService
from services.install_service import InstallService
from services.model_service import ModelService
from services.run_service import RunService

logger = logging.getLogger(__name__)


async def _gc_loop(
    file_service,
    install_service,
    ttl_hours: int,
    interval_seconds: int,
) -> None:
    """Unified background reaper: prunes orphan files (`ref_count = 0`)
    AND stale effect lifecycle rows (`state` in `installing`/`uninstalling`)
    older than ttl_hours. Runs once immediately at startup (so a
    previous-process crash gets cleaned before the user notices) and
    then on a sleep-loop.

    The TTL is the multi-instance safety knob — anything younger than
    `ttl_hours` could still belong to a live process, so we leave it
    alone."""
    while True:
        try:
            files = await file_service.prune_orphan_files(ttl_hours)
            lifecycle = await install_service.prune_stale_lifecycle_rows(ttl_hours)
            if files or lifecycle:
                logger.info(
                    "gc: pruned %d file(s), %d lifecycle row(s)",
                    files, lifecycle,
                )
        except Exception as e:
            logger.warning("gc: failed: %s", e)
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
    files_dir = settings.user_data_dir / "files"
    files_dir.mkdir(exist_ok=True)

    db_path = settings.user_data_dir / "openeffect.db"
    await init_db(db_path)
    database = Database(db_path)
    await database.connect()

    config_service = ConfigService(database, settings.user_data_dir / "config.json")

    file_service = FileService(files_dir=files_dir, db=database)
    install_service = InstallService(db=database, file_service=file_service)

    effect_loader = EffectLoaderService(
        install_service=install_service,
        db=database,
        bundled_dir=settings.effects_dir,
    )
    await effect_loader.load_all()

    async def _on_install_change(effect_id: str | None) -> None:
        # Per-effect reload when the mutation affects exactly one row
        # (favorite/source/asset CRUD, uninstall) — much cheaper than
        # re-parsing every manifest. None means "set membership might
        # have changed, do a full reload" (install/save).
        if effect_id is None:
            await effect_loader.reload()
        else:
            await effect_loader.reload_one(effect_id)

    # Wire AFTER load_all so the boot-time bundled sync doesn't redundantly
    # trigger a reload from inside install_from_folder (load_all does its
    # own reload at the end already).
    install_service.set_on_change(_on_install_change)

    history_service = HistoryService(database)
    model_service = ModelService(settings.user_data_dir / "models")
    run_service = RunService(
        effect_loader=effect_loader,
        config_service=config_service,
        history_service=history_service,
        file_service=file_service,
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
    app.state.file_service = file_service

    # Spawn the unified GC reaper. Cleans both orphan files (eager
    # client-side uploads sitting at ref_count=0) and abandoned installs
    # (in-flight when the previous process died). Same TTL covers both —
    # under that age, a live process might still own them.
    reaper_task = asyncio.create_task(
        _gc_loop(
            file_service,
            install_service,
            settings.file_ttl_hours,
            settings.file_reaper_interval_seconds,
        )
    )
    app.state.gc_reaper_task = reaper_task

    yield

    reaper_task.cancel()
    try:
        await reaper_task
    except asyncio.CancelledError:
        pass
    await database.close()


def create_app() -> FastAPI:
    # No CORS middleware: every legitimate request is same-origin. In prod the
    # built `client/dist` is served from this same FastAPI instance; in dev
    # Vite proxies `/api/*` to here so the browser only sees :5173. Allowing
    # cross-origin requests would just open the door to drive-by CSRF (a tab
    # on any site could POST to http://127.0.0.1:3131/api/run and drain the
    # user's fal credits).
    app = FastAPI(title="OpenEffect", version="0.1.0", lifespan=lifespan)

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
