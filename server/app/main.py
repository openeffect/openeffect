from contextlib import asynccontextmanager
from pathlib import Path
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config.settings import get_settings
from app.config.config_service import ConfigService
from app.services.effect_loader import EffectLoaderService
from app.services.generation_service import GenerationService
from app.services.history_service import HistoryService
from app.services.model_service import ModelService
from app.services.storage_service import StorageService
from app.db.database import init_db
from app.routes import register_routes


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()

    # Init user data dir
    settings.user_data_dir.mkdir(parents=True, exist_ok=True)
    (settings.user_data_dir / "tmp").mkdir(exist_ok=True)

    # Init DB
    await init_db(settings.user_data_dir / "openeffect.db")

    # Init services
    config_service = ConfigService(settings.user_data_dir / "config.json")
    effect_loader = EffectLoaderService(settings.effects_dir)
    await effect_loader.load_all()

    storage_service = StorageService(settings.user_data_dir / "tmp")
    history_service = HistoryService(settings.user_data_dir / "openeffect.db")
    model_service = ModelService(settings.user_data_dir / "models")
    generation_service = GenerationService(
        effect_loader=effect_loader,
        config_service=config_service,
        history_service=history_service,
        storage_service=storage_service,
        model_service=model_service,
    )

    # Store services on app state
    app.state.settings = settings
    app.state.config_service = config_service
    app.state.effect_loader = effect_loader
    app.state.generation_service = generation_service
    app.state.history_service = history_service
    app.state.model_service = model_service
    app.state.storage_service = storage_service

    yield


def create_app() -> FastAPI:
    app = FastAPI(title="OpenEffect", version="0.1.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    register_routes(app)

    # Serve static frontend in production
    client_dist = Path(__file__).parent.parent.parent / "client" / "dist"
    if client_dist.exists():
        app.mount("/", StaticFiles(directory=str(client_dist), html=True), name="static")

    return app


app = create_app()
