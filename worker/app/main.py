"""Klierly worker: stateless file parsing and numerical validation.

Document contents are never logged or persisted.
"""
from __future__ import annotations

import asyncio
import multiprocessing
import hmac
import os
from typing import Any

from fastapi import Body, Depends, FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .errors import WorkerError
from .numeric import functions as numeric
from .parsers import PARSER_NAMES, parse_bytes, parse_pasted

VERSION = "0.1.0"
MAX_TEXT_CHARS = 2_000_000

app = FastAPI(title="Klierly worker", version=VERSION, docs_url=None, redoc_url=None, openapi_url=None)


def max_upload_bytes() -> int:
    try:
        return int(float(os.environ.get("MAX_UPLOAD_MB", "25")) * 1024 * 1024)
    except ValueError:
        return 25 * 1024 * 1024


def error_response(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"detail": {"code": code, "message": message}})


@app.exception_handler(WorkerError)
async def _worker_error(_: Request, exc: WorkerError) -> JSONResponse:
    return error_response(exc.status, exc.code, exc.message)


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
    return error_response(400, "invalid_request", "The request is missing required fields or is malformed.")


@app.exception_handler(StarletteHTTPException)
async def _http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
    return error_response(exc.status_code, "http_error", str(exc.detail))


@app.exception_handler(Exception)
async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
    return error_response(500, "internal_error", "The worker hit an unexpected error.")


def require_token(request: Request) -> None:
    expected = os.environ.get("WORKER_TOKEN", "")
    if not expected:
        raise WorkerError(500, "misconfigured", "WORKER_TOKEN is not set on the worker.")
    supplied = request.headers.get("x-worker-token", "")
    if not hmac.compare_digest(supplied.encode(), expected.encode()):
        raise WorkerError(401, "unauthorized", "Missing or invalid worker token.")


async def read_json(request: Request, limit: int) -> Any:
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > limit:
            raise WorkerError(413, "too_large", "The request is too large.")
    import json
    try:
        return json.loads(body)
    except (ValueError, UnicodeDecodeError) as exc:
        raise WorkerError(400, "invalid_request", "The request body is not valid JSON.") from exc


@app.get("/health")
async def health() -> dict[str, Any]:
    return {"status": "ok", "version": VERSION, "parsers": PARSER_NAMES}



def _parse_child(sender, fn, args):
    try:
        sender.send((True, fn(*args)))
    except WorkerError as exc:
        sender.send((False, (exc.status, exc.code, exc.message)))
    except Exception:
        sender.send((False, (422, "parse_failed", "The document could not be parsed.")))
    finally:
        sender.close()


def _bounded_parse_sync(fn, args):
    context = multiprocessing.get_context("spawn")
    receiver, sender = context.Pipe(duplex=False)
    process = context.Process(target=_parse_child, args=(sender, fn, args))
    try:
        process.start()
        sender.close()
        if not receiver.poll(45):
            raise WorkerError(422, "parse_timeout", "Parsing exceeded the time limit. Try a smaller document.")
        success, result = receiver.recv()
        if not success:
            raise WorkerError(*result)
        return result
    finally:
        receiver.close()
        sender.close()
        if process.pid is not None:
            if process.is_alive():
                process.terminate()
            process.join(timeout=2)
            if process.is_alive():
                process.kill()
                process.join()


_parse_lock = asyncio.Semaphore(1)

async def bounded_parse(fn, *args):
    async with _parse_lock:
        return await asyncio.to_thread(_bounded_parse_sync, fn, args)

@app.post("/parse", dependencies=[Depends(require_token)])
async def parse(request: Request) -> dict[str, Any]:
    limit = max_upload_bytes()
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > limit + 1024 * 1024:
        raise WorkerError(413, "too_large", f"The file is larger than the {limit // (1024 * 1024)} MB limit.")
    form = await request.form(max_files=1, max_fields=4, max_part_size=limit + 1)
    upload = form.get("file")
    if upload is None or isinstance(upload, str):
        raise WorkerError(400, "invalid_request", "No file was sent.")
    data = await upload.read(limit + 1)
    if len(data) > limit:
        raise WorkerError(413, "too_large", f"The file is larger than the {limit // (1024 * 1024)} MB limit.")
    override = form.get("filename")
    filename = override if isinstance(override, str) and override.strip() else (upload.filename or "")
    return await bounded_parse(parse_bytes, filename, data)


@app.post("/parse-text", dependencies=[Depends(require_token)])
async def parse_text(request: Request) -> dict[str, Any]:
    body = await read_json(request, MAX_TEXT_CHARS * 4)
    if not isinstance(body, dict) or not isinstance(body.get("text"), str):
        raise WorkerError(400, "invalid_request", "'text' is required.")
    fmt = body.get("format", "plain")
    if fmt not in ("plain", "markdown", "html"):
        raise WorkerError(400, "invalid_request", "'format' must be plain, markdown or html.")
    if len(body["text"]) > MAX_TEXT_CHARS:
        raise WorkerError(413, "too_large", "The text is too long.")
    title = body.get("title")
    return await bounded_parse(parse_pasted, body["text"], fmt, title if isinstance(title, str) else None)


@app.get("/numeric/functions", dependencies=[Depends(require_token)])
async def numeric_functions() -> dict[str, Any]:
    return {"functions": numeric.describe()}


@app.post("/numeric/compute", dependencies=[Depends(require_token)])
async def numeric_compute(request: Request) -> dict[str, Any]:
    body = await read_json(request, 2_000_000)
    if not isinstance(body, dict):
        raise WorkerError(400, "invalid_request", "Send an object with 'fn' and 'args'.")
    return numeric.compute(body.get("fn"), body.get("args", {}))


def solver_enabled() -> bool:
    """AI-written solver code runs only where explicitly allowed: a dedicated solver container (WORKER_ROLE=solver),
    or a local test worker (LEARN_TEST_NUMERIC_SOLVERS=true). The ordinary parsing worker never executes it."""
    return os.environ.get("WORKER_ROLE") == "solver" or os.environ.get("LEARN_TEST_NUMERIC_SOLVERS") == "true"


def require_solver() -> None:
    if not solver_enabled():
        raise WorkerError(404, "not_found", "Not Found")


@app.post("/sandbox/run", dependencies=[Depends(require_token), Depends(require_solver)])
def sandbox_run(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Run an AI-written pure solver for many parameter sets. See app/sandbox.py for what is and is not enforced.

    A plain ``def`` on purpose: FastAPI runs it in a thread, so a slow solver never blocks other requests."""
    from . import sandbox

    return {"results": sandbox.run_solver(body.get("code"), body.get("params"), body.get("fn", "solve"))}


@app.middleware("http")
async def solver_role_surface(request: Request, call_next):
    """The solver container exposes nothing but its health check and the sandbox: no parsers, no numeric helpers."""
    if os.environ.get("WORKER_ROLE") == "solver" and request.url.path not in ("/health", "/sandbox/run"):
        return error_response(404, "not_found", "Not Found")
    return await call_next(request)


@app.post("/numeric/ols", dependencies=[Depends(require_token)])
async def numeric_ols(request: Request) -> dict[str, Any]:
    return numeric.ols(await read_json(request, 5_000_000))
