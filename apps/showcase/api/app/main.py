"""Showcase API: read-only JSON over projects.json."""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse

from .cards import CardError, load_projects

PROJECTS_FILE = Path(os.environ.get("PROJECTS_FILE", "/data/projects.json"))

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("showcase")


class ProjectStore:
    """Re-reads projects.json whenever it changes.

    If an edit breaks the file, keep serving the last good copy and report
    the problem through /api/health.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()
        self._signature: tuple[int, int, int] | None = None
        self._projects: list[dict] | None = None
        self.error: str | None = None

    def get(self) -> list[dict] | None:
        with self._lock:
            try:
                st = self.path.stat()
                signature = (st.st_ino, st.st_mtime_ns, st.st_size)
            except OSError:
                signature = None

            if signature is None or signature != self._signature:
                try:
                    projects = load_projects(self.path)
                except CardError as e:
                    if self.error != str(e):
                        log.error("projects.json problem: %s", e)
                    self.error = str(e)
                else:
                    if self.error:
                        log.info("projects.json is valid again")
                    self._projects = projects
                    self.error = None
                self._signature = signature
            return self._projects


store = ProjectStore(PROJECTS_FILE)

app = FastAPI(
    title="2haks Showcase API",
    description="Read-only list of the apps hosted on 2haks.xyz.",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url=None,
    openapi_url="/api/openapi.json",
)


def _projects_or_503() -> list[dict]:
    projects = store.get()
    if projects is None:
        raise HTTPException(status_code=503, detail="Project list is unavailable right now.")
    return projects


@app.get("/api/health")
def health() -> JSONResponse:
    projects = store.get()
    if projects is None:
        return JSONResponse({"status": "error", "detail": store.error}, status_code=503)
    body = {"status": "degraded" if store.error else "ok", "projects": len(projects)}
    if store.error:
        body["detail"] = store.error
    return JSONResponse(body)


@app.get("/api/projects")
def list_projects() -> dict:
    projects = _projects_or_503()
    newest_first = sorted(projects, key=lambda p: (p["launch_date"], p["name"]), reverse=True)
    return {"projects": newest_first}


@app.get("/api/projects/{slug}")
def get_project(slug: str) -> dict:
    for project in _projects_or_503():
        if project["slug"] == slug:
            return project
    raise HTTPException(status_code=404, detail=f"No project called '{slug}'.")
