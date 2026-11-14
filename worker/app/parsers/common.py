"""Shared helpers for parsers: text cleaning, segments, table normalization."""
from __future__ import annotations

import io
import re
import unicodedata
import zipfile
from typing import Any, Iterable

from ..errors import WorkerError

# Zip-container sanity limits (docx / pptx / xlsx).
MAX_ZIP_UNCOMPRESSED = 300 * 1024 * 1024
MAX_ZIP_MEMBERS = 10_000
MAX_ZIP_RATIO = 200  # only enforced once the archive is non-trivially large
TABLE_ROWS_PER_SEGMENT = 200
MAX_TABLE_ROWS = 100_000

_CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f​‎‏  ﻿]")
_SPACES_RE = re.compile(r"[ \t ]+")
_BLANKS_RE = re.compile(r"\n{3,}")


def clean_text(text: str | None) -> str:
    """NFC-normalize, drop control characters, collapse blank-line runs."""
    if not text:
        return ""
    text = unicodedata.normalize("NFC", text)
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = _CONTROL_RE.sub("", text)
    lines = [_SPACES_RE.sub(" ", line).rstrip() for line in text.split("\n")]
    text = "\n".join(lines)
    text = _BLANKS_RE.sub("\n\n", text)
    return text.strip()


def clean_inline(text: str | None) -> str:
    """Clean a single-line value (heading, title, table cell)."""
    return re.sub(r"\s+", " ", clean_text(text)).strip()


def segment(
    text: str,
    *,
    kind: str = "text",
    heading: str | None = None,
    page: int | None = None,
    slide: int | None = None,
    t_start_ms: int | None = None,
    t_end_ms: int | None = None,
) -> dict[str, Any] | None:
    """Build a contract-shaped segment, or None when it would be empty."""
    text = clean_text(text)
    if not text:
        return None
    heading = clean_inline(heading) or None
    return {
        "kind": kind,
        "text": text,
        "heading": heading,
        "page": page,
        "slide": slide,
        "t_start_ms": t_start_ms,
        "t_end_ms": t_end_ms,
    }


def add(segments: list[dict[str, Any]], seg: dict[str, Any] | None) -> None:
    if seg is not None:
        segments.append(seg)


def cell_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer() and abs(value) < 1e15:
        value = int(value)
    return clean_inline(str(value)).replace("|", "/")


def table_rows_to_text(rows: Iterable[Iterable[Any]]) -> str:
    """Normalize rows to pipe-delimited lines (``a | b | c``)."""
    lines = []
    for row in rows:
        cells = [cell_text(c) for c in row]
        if any(cells):
            lines.append(" | ".join(cells))
    return "\n".join(lines)


def normalize_grid(rows: list[list[Any]]) -> list[list[str]]:
    """Clean cells, drop fully empty rows / trailing empty columns, pad to a rectangle."""
    cleaned = [[cell_text(c) for c in row] for row in rows]
    cleaned = [r for r in cleaned if any(r)]
    if not cleaned:
        return []
    width = max((max((i + 1 for i, c in enumerate(r) if c), default=0) for r in cleaned), default=0)
    return [(r + [""] * width)[:width] for r in cleaned]


def tabular_segments(
    rows: list[list[Any]],
    *,
    heading: str | None,
    label: str,
    warnings: list[str],
) -> list[dict[str, Any]]:
    """Summary text segment followed by table segments of <= 200 data rows each."""
    grid = normalize_grid(rows)
    if not grid:
        return []
    if len(grid) > MAX_TABLE_ROWS + 1:
        warnings.append(f"{label} has more than {MAX_TABLE_ROWS} rows; only the first {MAX_TABLE_ROWS} were kept.")
        grid = grid[: MAX_TABLE_ROWS + 1]
    header, data = grid[0], grid[1:]
    names = [h or f"column {i + 1}" for i, h in enumerate(header)]
    out: list[dict[str, Any]] = []
    summary = (
        f"{label} has {len(data)} data row{'s' if len(data) != 1 else ''} and "
        f"{len(names)} column{'s' if len(names) != 1 else ''}: {', '.join(names)}."
    )
    add(out, segment(summary, heading=heading))
    header_line = " | ".join(names)
    if not data:
        add(out, segment(header_line, kind="table", heading=heading))
    for start in range(0, len(data), TABLE_ROWS_PER_SEGMENT):
        chunk = data[start : start + TABLE_ROWS_PER_SEGMENT]
        body = "\n".join(" | ".join(r) for r in chunk)
        add(out, segment(header_line + "\n" + body, kind="table", heading=heading))
    return out


def decode_text(data: bytes, warnings: list[str]) -> str:
    """Decode an uploaded text file without guessing wildly."""
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8", errors="replace")
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        try:
            return data.decode("utf-16")
        except UnicodeDecodeError as exc:
            raise WorkerError(422, "parse_failed", "The file claims to be UTF-16 text but could not be decoded.") from exc
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        warnings.append("The file is not valid UTF-8; it was read as Windows-1252, so some characters may be wrong.")
        return data.decode("cp1252", errors="replace")


def open_zip(data: bytes) -> zipfile.ZipFile:
    """Open an OOXML container after zip-bomb sanity checks."""
    try:
        zf = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise WorkerError(422, "parse_failed", "The file is not a readable Office document (damaged zip container).") from exc
    infos = zf.infolist()
    total = sum(i.file_size for i in infos)
    compressed = sum(i.compress_size for i in infos) or 1
    if len(infos) > MAX_ZIP_MEMBERS or total > MAX_ZIP_UNCOMPRESSED or (
        total > 20 * 1024 * 1024 and total / compressed > MAX_ZIP_RATIO
    ):
        zf.close()
        raise WorkerError(
            422,
            "parse_failed",
            "The file expands to an unreasonable size when unpacked and was not processed.",
        )
    return zf


def finish(
    parser: str,
    segments: list[dict[str, Any]],
    *,
    title: str | None,
    warnings: list[str],
    confidence: float = 1.0,
    empty_message: str = "No readable text was found in this document.",
) -> dict[str, Any]:
    if not segments:
        raise WorkerError(422, "empty_document", empty_message)
    title = clean_inline(title) or None
    return {
        "parser": parser,
        "confidence": round(max(0.0, min(1.0, confidence)), 2),
        "warnings": warnings,
        "title": title[:300] if title else None,
        "segments": segments,
    }
