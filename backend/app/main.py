"""The web service."""

from __future__ import annotations

import logging
import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text

from . import __version__
from .api import applications as applications_api
from .api import benchmarks as benchmarks_api
from .api import overview as overview_api
from .api import races as races_api
from .api import studies as studies_api
from .config import get_settings
from .db import SessionLocal, init_db

log = logging.getLogger("vdc")


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    logging.basicConfig(level=get_settings().log_level, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    init_db()
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="Verify, Don't Chase",
        version=__version__,
        summary="Decide which simulation runs to buy next, and when to stop.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def request_log(request: Request, call_next):
        rid = request.headers.get("x-request-id") or uuid.uuid4().hex[:12]
        t0 = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception:
            log.exception("unhandled error rid=%s %s %s", rid, request.method, request.url.path)
            return JSONResponse({"detail": "internal error", "request_id": rid}, status_code=500)
        response.headers["X-Request-ID"] = rid
        if request.url.path.startswith("/api"):
            ms = (time.perf_counter() - t0) * 1000
            log.info("rid=%s %s %s -> %s in %.0f ms", rid, request.method, request.url.path, response.status_code, ms)
        return response

    @app.get("/api/health", tags=["service"])
    def health() -> dict:
        with SessionLocal() as session:
            session.execute(text("select 1"))
        return {"status": "ok", "version": __version__, "auth_required": bool(settings.api_key)}

    app.include_router(studies_api.router)
    app.include_router(races_api.router)
    app.include_router(overview_api.router)
    app.include_router(benchmarks_api.router)
    app.include_router(applications_api.router)

    # Optional: serve the built frontend from the same container.
    if settings.static_dir and Path(settings.static_dir, "index.html").is_file():
        root = Path(settings.static_dir).resolve()
        app.mount("/assets", StaticFiles(directory=root / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        def spa(path: str) -> FileResponse:
            file = root / path
            if path and file.is_file() and root in file.resolve().parents:
                return FileResponse(file)
            return FileResponse(root / "index.html")

    return app


app = create_app()
