from fastapi import FastAPI
from routes.health import router as health_router
from routes.effects import router as effects_router
from routes.uploads import router as uploads_router
from routes.run import router as run_router
from routes.runs import router as runs_router
from routes.config import router as config_router
from routes.models import router as models_router


def register_routes(app: FastAPI) -> None:
    app.include_router(health_router, prefix="/api")
    app.include_router(effects_router, prefix="/api")
    app.include_router(uploads_router, prefix="/api")
    app.include_router(run_router, prefix="/api")
    app.include_router(runs_router, prefix="/api")
    app.include_router(config_router, prefix="/api")
    app.include_router(models_router, prefix="/api")
