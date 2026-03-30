from fastapi import FastAPI
from routes.health import router as health_router
from routes.effects import router as effects_router
from routes.uploads import router as uploads_router
from routes.generation import router as generation_router
from routes.history import router as history_router
from routes.config import router as config_router
from routes.models import router as models_router


def register_routes(app: FastAPI) -> None:
    app.include_router(health_router, prefix="/api")
    app.include_router(effects_router, prefix="/api")
    app.include_router(uploads_router, prefix="/api")
    app.include_router(generation_router, prefix="/api")
    app.include_router(history_router, prefix="/api")
    app.include_router(config_router, prefix="/api")
    app.include_router(models_router, prefix="/api")
