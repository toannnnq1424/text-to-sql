"""Authenticated upload parser; bounded private tempfiles, no DB/network readers."""

import hmac
import os
import tempfile
import threading
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from readers import InvalidFile, encoded, parse
from starlette.background import BackgroundTask

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
SLOTS = threading.BoundedSemaphore(2)
MAX_UPLOAD = 25 * 1024 * 1024


def authenticated(authorization: str = Header(default="")):
    token = os.environ.get("FILE_SERVICE_TOKEN", "")
    if len(token) < 32 or not hmac.compare_digest(authorization, "Bearer " + token):
        raise HTTPException(401, "UNAUTHENTICATED")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/internal/v1/parse", dependencies=[Depends(authenticated)])
def parse_upload(file: UploadFile = File(), sheet: str | None = Form(None), delimiter: str | None = Form(None)):
    if not SLOTS.acquire(blocking=False):
        raise HTTPException(429, "FILE_SERVICE_BUSY")
    directory = tempfile.TemporaryDirectory(prefix="nla-file-")
    try:
        extension = (file.filename or "").rsplit(".", 1)[-1].lower()
        source = Path(directory.name) / ("source." + extension if extension.isalnum() else "source")
        count = 0
        with source.open("wb") as output:
            while chunk := file.file.read(64 * 1024):
                count += len(chunk)
                if count > MAX_UPLOAD:
                    raise HTTPException(413, "PAYLOAD_TOO_LARGE")
                output.write(chunk)
        if not count:
            raise InvalidFile("File is empty.")
        spool = Path(directory.name) / "canonical.ndjson"
        metadata = parse(source, extension, spool, sheet, delimiter)

        def stream():
            yield encoded(metadata) + "\n"
            with spool.open("rb") as rows:
                while chunk := rows.read(64 * 1024):
                    yield chunk

        def cleanup():
            directory.cleanup()
            SLOTS.release()

        return StreamingResponse(stream(), media_type="application/x-ndjson", background=BackgroundTask(cleanup))
    except HTTPException:
        directory.cleanup()
        SLOTS.release()
        raise
    except Exception as exc:
        directory.cleanup()
        SLOTS.release()
        message = str(exc) if isinstance(exc, InvalidFile) else "Malformed or unsupported file."
        raise HTTPException(422, {"code": "FILE_PARSE_ERROR", "message": message}) from None
    finally:
        file.file.close()
