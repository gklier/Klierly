"""Decide the file type from the extension and verify it against the content."""
from __future__ import annotations

import io
import os
import zipfile

from ..errors import WorkerError
from .common import open_zip

EXTENSIONS = {
    ".pdf": "pdf",
    ".docx": "docx",
    ".pptx": "pptx",
    ".txt": "txt",
    ".md": "markdown",
    ".markdown": "markdown",
    ".html": "html",
    ".htm": "html",
    ".csv": "csv",
    ".xlsx": "xlsx",
    ".srt": "srt",
    ".vtt": "vtt",
}
PARSER_NAMES = ["pdf", "docx", "pptx", "txt", "markdown", "html", "csv", "xlsx", "srt", "vtt"]
SUPPORTED_LIST = " ".join(EXTENSIONS)

_ZIP_MARKERS = {
    "docx": "word/document.xml",
    "pptx": "ppt/presentation.xml",
    "xlsx": "xl/workbook.xml",
}
_BINARY_MAGIC = (
    b"%PDF-", b"PK\x03\x04", b"PK\x05\x06", b"MZ", b"\x7fELF", b"\xd0\xcf\x11\xe0",
    b"\x89PNG", b"\xff\xd8\xff", b"GIF8", b"\x1f\x8b", b"Rar!", b"7z\xbc\xaf",
)


def _mismatch(ext: str, what: str) -> WorkerError:
    return WorkerError(415, "type_mismatch", f"The file is named {ext} but its content {what}.")


def looks_like_text(data: bytes) -> bool:
    if data.startswith(_BINARY_MAGIC):
        return False
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):  # UTF-16 BOM
        return True
    sample = data[:65536]
    if b"\x00" in sample:
        return False
    control = sum(1 for b in sample if b < 9 or 13 < b < 32)
    return control <= len(sample) * 0.02


def detect_type(filename: str, data: bytes) -> str:
    """Return the parser name, or raise 415 unsupported_type / type_mismatch."""
    ext = os.path.splitext(filename or "")[1].lower()
    kind = EXTENSIONS.get(ext)
    if kind is None:
        shown = ext or "no extension"
        raise WorkerError(
            415,
            "unsupported_type",
            f"Files of type '{shown}' are not supported. Supported types: {SUPPORTED_LIST}.",
        )
    if not data.strip(b"\x00 \t\r\n"):
        raise WorkerError(422, "empty_document", "The file is empty.")

    if kind == "pdf":
        if b"%PDF-" not in data[:1024]:
            raise _mismatch(ext, "is not a PDF")
        return kind

    if kind in _ZIP_MARKERS:
        if not data.startswith(b"PK"):
            raise _mismatch(ext, "is not an Office document")
        if not zipfile.is_zipfile(io.BytesIO(data)):
            raise WorkerError(422, "parse_failed", "The file is not a readable Office document (damaged zip container).")
        with open_zip(data) as zf:
            names = set(zf.namelist())
        if _ZIP_MARKERS[kind] not in names:
            actual = next((k for k, marker in _ZIP_MARKERS.items() if marker in names), None)
            what = f"looks like a .{actual} file" if actual else f"is not a {ext} document"
            raise _mismatch(ext, what)
        if "EncryptedPackage" in names:
            raise WorkerError(422, "encrypted", "The document is password-protected. Remove the password and upload it again.")
        return kind

    # Text formats.
    if data.startswith(b"\xd0\xcf\x11\xe0"):
        raise _mismatch(ext, "is a legacy or password-protected Office file")
    if not looks_like_text(data):
        raise _mismatch(ext, "is binary, not text")
    return kind
