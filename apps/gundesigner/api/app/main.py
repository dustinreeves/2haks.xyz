"""Gun Designer API: https://gundesigner.2haks.xyz/api"""

from __future__ import annotations

import os
import re
import threading
from pathlib import Path

from fastapi import Body, FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse

from .catalog import Catalog, CatalogError, DesignError, load_catalog
from .store import DesignStore, StoreError

PARTS_FILE = Path(os.environ.get("PARTS_FILE", "/content/parts.json"))
DB_FILE = Path(os.environ.get("GUNDESIGNER_DB", "/var/lib/gundesigner/designs.db"))
CODE = re.compile(r"^[a-z0-9]{4,12}$")


class CatalogCache:
    """Re-reads parts.json when it changes; keeps the last good copy if an edit breaks it."""

    def __init__(self, path: Path):
        self.path = path
        self.mtime: float | None = None
        self.catalog: Catalog | None = None
        self.error: str | None = None
        self.lock = threading.Lock()

    def get(self) -> Catalog | None:
        with self.lock:
            try:
                mtime = self.path.stat().st_mtime
            except OSError as e:
                self.error = f"can't read {self.path.name}: {e}"
                return self.catalog
            if mtime != self.mtime:
                self.mtime = mtime
                try:
                    self.catalog = Catalog(load_catalog(self.path))
                    self.error = None
                except CatalogError as e:
                    self.error = str(e)
            return self.catalog


def create_app(parts_file: Path = PARTS_FILE, db_file: Path = DB_FILE) -> FastAPI:
    catalogs = CatalogCache(parts_file)
    store = DesignStore(db_file)

    app = FastAPI(
        title="Gun Designer API",
        version="1.0.0",
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
    )

    def catalog() -> Catalog:
        cat = catalogs.get()
        if not cat:
            raise HTTPException(503, catalogs.error or "no parts catalog")
        return cat

    def describe(cat: Catalog, row: dict) -> dict:
        try:
            stats = cat.compute_stats(row["design"])
        except KeyError:  # a part was removed from the catalog after this was saved
            stats = None
        return {**row, "stats": stats}

    @app.exception_handler(StoreError)
    async def store_error(_: Request, exc: StoreError) -> JSONResponse:
        return JSONResponse({"detail": exc.message}, status_code=exc.status)

    @app.exception_handler(DesignError)
    async def design_error(_: Request, exc: DesignError) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=422)

    @app.get("/api/health")
    def health():
        cat = catalogs.get()
        try:
            saved = store.check()
        except Exception as e:  # noqa: BLE001 - report any database problem
            return JSONResponse({"status": "error", "detail": f"database: {e}"}, status_code=503)
        if not cat:
            return JSONResponse({"status": "error", "detail": catalogs.error}, status_code=503)
        out = {"status": "ok", "bases": len(cat.bases), "parts": len(cat.parts), "designs": saved}
        if catalogs.error:
            out.update(status="degraded", detail=catalogs.error)
        return out

    @app.get("/api/parts")
    def parts():
        return catalog().data

    @app.post("/api/check")
    def check(design: dict = Body(...)):
        cat = catalog()
        clean = cat.check_design(design)
        return {"name": cat.design_name(clean), "design": clean, "stats": cat.compute_stats(clean)}

    @app.post("/api/designs", status_code=201)
    def save(request: Request, design: dict = Body(...)):
        cat = catalog()
        clean = cat.check_design(design)
        client = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
        client = client or (request.client.host if request.client else "unknown")
        row, created = store.save(clean, cat.design_name(clean), client)
        body = describe(cat, row)
        return body if created else JSONResponse(body, status_code=200)

    @app.get("/api/designs")
    def recent(limit: int = Query(24, ge=1, le=100), base: str | None = Query(None, max_length=32)):
        cat = catalog()
        return {"designs": [describe(cat, r) for r in store.recent_designs(limit, base)]}

    @app.get("/api/designs/{code}")
    def get_design(code: str):
        row = store.get(code.lower()) if CODE.match(code.lower()) else None
        if not row:
            raise HTTPException(404, "no design with that code")
        return describe(catalog(), row)

    return app


app = create_app()
