from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from config.settings import get_settings
from config.config_service import ConfigService
from services.install_service import InstallService
from services.effect_loader import EffectLoaderService
from services.generation_service import GenerationService
from services.history_service import HistoryService
from services.model_service import ModelService
from services.storage_service import StorageService
from db.database import init_db
from routes import register_routes


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()

    # Init user data dir
    settings.user_data_dir.mkdir(parents=True, exist_ok=True)
    (settings.user_data_dir / "uploads").mkdir(exist_ok=True)
    (settings.user_data_dir / "generations").mkdir(exist_ok=True)
    (settings.user_data_dir / "effects").mkdir(exist_ok=True)

    # Init DB
    db_path = settings.user_data_dir / "openeffect.db"
    await init_db(db_path)

    # Init services
    config_service = ConfigService(settings.user_data_dir / "config.json")

    install_service = InstallService(
        db_path=db_path,
        effects_dir=settings.user_data_dir / "effects",
    )

    bundled_zip = settings.effects_dir / "openeffect-effects.zip"
    effect_loader = EffectLoaderService(
        install_service=install_service,
        bundled_zip_path=bundled_zip if bundled_zip.exists() else None,
    )
    await effect_loader.load_all()

    storage_service = StorageService(
        uploads_dir=settings.user_data_dir / "uploads",
        db_path=db_path,
    )
    history_service = HistoryService(db_path)
    model_service = ModelService(settings.user_data_dir / "models")
    generation_service = GenerationService(
        effect_loader=effect_loader,
        config_service=config_service,
        history_service=history_service,
        storage_service=storage_service,
        model_service=model_service,
    )

    # Recover any stuck processing jobs from a previous crash
    await generation_service.recover_stuck_jobs()

    # Store services on app state
    app.state.settings = settings
    app.state.config_service = config_service
    app.state.install_service = install_service
    app.state.effect_loader = effect_loader
    app.state.generation_service = generation_service
    app.state.history_service = history_service
    app.state.model_service = model_service
    app.state.storage_service = storage_service

    yield

    # Cleanup
    await history_service.close()


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

    # Serve static frontend in production
    static_dir = Path(__file__).parent.parent / "client" / "dist"
    if static_dir.exists():
        app.mount("/", StaticFiles(directory=str(static_dir), html=True), name="static")

    return app


app = create_app()
