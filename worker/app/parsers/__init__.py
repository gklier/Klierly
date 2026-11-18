"""File parsers. ``parse_bytes`` is the single entry point used by the API."""
from __future__ import annotations

import os
from typing import Any

from ..errors import WorkerError
from .common import decode_text
from .detect import EXTENSIONS, PARSER_NAMES, detect_type
from .html import parse_html
from .office import parse_docx, parse_pptx
from .pdf import parse_pdf
from .subtitles import parse_subtitles
from .tabular import parse_csv, parse_xlsx
from .textual import parse_markdown, parse_txt

__all__ = ["EXTENSIONS", "PARSER_NAMES", "parse_bytes", "parse_pasted"]


def _stem_title(filename: str) -> str | None:
    stem = os.path.splitext(os.path.basename(filename or ""))[0]
    stem = stem.replace("_", " ").strip()
    return stem or None


def parse_bytes(filename: str, data: bytes) -> dict[str, Any]:
    kind = detect_type(filename, data)
    try:
        if kind == "pdf":
            result = parse_pdf(data)
        elif kind == "docx":
            result = parse_docx(data)
        elif kind == "pptx":
            result = parse_pptx(data)
        elif kind == "xlsx":
            result = parse_xlsx(data)
        else:
            warnings: list[str] = []
            text = decode_text(data, warnings)
            if kind == "txt":
                result = parse_txt(text)
            elif kind == "markdown":
                result = parse_markdown(text)
            elif kind == "html":
                result = parse_html(text)
            elif kind == "csv":
                result = parse_csv(text)
            else:
                result = parse_subtitles(text, parser=kind)
            result["warnings"] = warnings + result["warnings"]
    except WorkerError:
        raise
    except (RecursionError, MemoryError) as exc:
        raise WorkerError(422, "parse_failed", "The file is too complex to process.") from exc
    except Exception as exc:  # never leak parser internals or document content
        raise WorkerError(422, "parse_failed", "The file could not be parsed.") from exc
    if not result.get("title"):
        result["title"] = _stem_title(filename)
    return result


def parse_pasted(text: str, fmt: str, title: str | None) -> dict[str, Any]:
    if not text.strip():
        raise WorkerError(422, "empty_document", "The text is empty.")
    try:
        if fmt == "plain":
            return parse_txt(text, parser="paste-plain", title=title)
        if fmt == "markdown":
            return parse_markdown(text, parser="paste-markdown", title=title)
        return parse_html(text, parser="paste-html", title=title)
    except WorkerError:
        raise
    except Exception as exc:
        raise WorkerError(422, "parse_failed", "The text could not be parsed.") from exc
