"""PDF parser (pypdf, text layer only - no OCR)."""
from __future__ import annotations

import io
import math
import re
import statistics
import unicodedata
from collections import Counter
from typing import Any

from ..errors import WorkerError
from .common import add, clean_inline, clean_text, finish, segment

MAX_PAGES = 3000
_BULLET_RE = re.compile(r"^\s*([•●◦‣⁃▪\-\*]|\(?\d{1,3}[.)])\s+")


class _Line:
    __slots__ = ("text", "size", "bold", "y")

    def __init__(self, text: str, size: float, bold: bool, y: float | None) -> None:
        self.text = text
        self.size = size
        self.bold = bold
        self.y = y


def _scale(m: Any) -> float:
    try:
        return math.sqrt(abs(float(m[0]) * float(m[3]) - float(m[1]) * float(m[2]))) or 1.0
    except Exception:
        return 1.0


def _page_lines(page: Any) -> list[_Line]:
    """Extract the page text as lines annotated with font size / weight / baseline."""
    fragments: list[tuple[str, float, bool, float | None]] = []

    def visitor(text: str, cm: Any, tm: Any, font_dict: Any, font_size: Any) -> None:
        if not text:
            return
        try:
            size = float(font_size or 0) * _scale(tm) * _scale(cm)
        except Exception:
            size = 0.0
        name = ""
        try:
            name = str((font_dict or {}).get("/BaseFont", ""))
        except Exception:
            pass
        bold = bool(re.search(r"bold|black|heavy|semibold|demi", name, re.IGNORECASE))
        try:
            y = float(cm[1]) * float(tm[4]) + float(cm[3]) * float(tm[5]) + float(cm[5])
        except Exception:
            y = None
        fragments.append((text, size, bold, y))

    try:
        page.extract_text(visitor_text=visitor)
    except Exception:
        # Fall back to plain extraction for pages the visitor path cannot handle.
        try:
            plain = page.extract_text() or ""
        except Exception:
            plain = ""
        return [_Line(t, 0.0, False, None) for t in plain.split("\n") if t.strip()]

    lines: list[_Line] = []
    parts: list[tuple[str, float, bool, float | None]] = []

    def end_line() -> None:
        text = "".join(p[0] for p in parts)
        inked = [p for p in parts if p[0].strip()]
        if text.strip() and inked:
            weights = Counter()
            for p in inked:
                weights[round(p[1] * 2) / 2] += len(p[0].strip())
            size = weights.most_common(1)[0][0]
            bold = all(p[2] for p in inked)
            y = next((p[3] for p in inked if p[3] is not None), None)
            lines.append(_Line(text, size, bold, y))
        parts.clear()

    for text, size, bold, y in fragments:
        pieces = text.split("\n")
        for i, piece in enumerate(pieces):
            if i > 0:
                end_line()
            if piece:
                parts.append((piece, size, bold, y))
    end_line()
    return lines


def _garble_factor(text: str) -> float:
    chars = [c for c in text if not c.isspace()]
    if not chars:
        return 1.0
    weird = sum(1 for c in chars if c == "�" or unicodedata.category(c) in ("Co", "Cn", "Cs", "Cc"))
    alnum = sum(1 for c in chars if c.isalnum())
    factor = 1.0 - min(1.0, 4.0 * weird / len(chars))
    if alnum / len(chars) < 0.5:
        factor *= 0.6
    words = text.split()
    if words and statistics.mean(len(w) for w in words) > 25:  # missing spaces / broken encoding
        factor *= 0.7
    return factor


def _is_heading(line: _Line, body_size: float) -> bool:
    text = line.text.strip()
    if not text or len(text) > 120 or sum(c.isalpha() for c in text) < 2:
        return False
    if body_size > 0 and line.size >= body_size * 1.15:
        return True
    if line.bold and line.size >= body_size and len(text) <= 80 and text[-1] not in ".,;:" and not _BULLET_RE.match(text):
        return True
    return False


def _join_block(lines: list[_Line]) -> str:
    """Rebuild paragraphs from wrapped lines using baseline gaps and line lengths."""
    if not lines:
        return ""
    gaps = [
        a.y - b.y
        for a, b in zip(lines, lines[1:])
        if a.y is not None and b.y is not None and a.y - b.y > 0
    ]
    normal_gap = statistics.median(gaps) if gaps else None
    lengths = sorted(len(ln.text.strip()) for ln in lines)
    wide = lengths[min(len(lengths) - 1, int(len(lengths) * 0.9))]
    out = [lines[0].text.strip()]
    for prev, cur in zip(lines, lines[1:]):
        text = cur.text.strip()
        gap = prev.y - cur.y if prev.y is not None and cur.y is not None else None
        if normal_gap is not None and gap is not None and (gap > normal_gap * 1.35 or gap <= 0):
            out.append("\n\n" + text)
        elif _BULLET_RE.match(text) or len(prev.text.strip()) < wide * 0.6 or normal_gap is None:
            out.append("\n" + text)
        else:
            out.append(" " + text)
    return "".join(out)


def parse_pdf(data: bytes, *, title: str | None = None) -> dict[str, Any]:
    from pypdf import PdfReader
    from pypdf.errors import PyPdfError

    warnings: list[str] = []
    try:
        reader = PdfReader(io.BytesIO(data), strict=False)
        if reader.is_encrypted:
            unlocked = False
            try:
                unlocked = bool(reader.decrypt(""))
            except Exception:
                unlocked = False
            if not unlocked:
                raise WorkerError(
                    422, "encrypted", "The PDF is password-protected. Remove the password and upload it again."
                )
        page_count = len(reader.pages)
    except WorkerError:
        raise
    except (PyPdfError, ValueError, KeyError, TypeError, RecursionError, OSError, AttributeError) as exc:
        raise WorkerError(422, "parse_failed", "The PDF could not be read; it may be damaged.") from exc

    if page_count == 0:
        raise WorkerError(422, "empty_document", "The PDF has no pages.")
    if page_count > MAX_PAGES:
        warnings.append(f"The PDF has {page_count} pages; only the first {MAX_PAGES} were read.")
        page_count = MAX_PAGES

    pages: list[list[_Line]] = []
    for index in range(page_count):
        try:
            pages.append(_page_lines(reader.pages[index]))
        except Exception:
            pages.append([])
            warnings.append(f"Page {index + 1} could not be read.")

    size_weights: Counter[float] = Counter()
    for lines in pages:
        for ln in lines:
            if ln.size > 0:
                size_weights[ln.size] += len(ln.text.strip())
    body_size = size_weights.most_common(1)[0][0] if size_weights else 0.0

    segments: list[dict[str, Any]] = []
    heading: str | None = None
    first_heading: str | None = None
    largest: tuple[float, str] | None = None
    meaningful = 0
    all_text: list[str] = []
    for number, lines in enumerate(pages, start=1):
        page_text = clean_text("\n".join(ln.text for ln in lines))
        if sum(c.isalnum() for c in page_text) < 3:
            warnings.append(f"Page {number} has no extractable text (possibly a scanned image).")
            continue
        meaningful += 1
        all_text.append(page_text)
        block: list[_Line] = []
        pending_heading: list[str] = []
        for ln in lines:
            if _is_heading(ln, body_size):
                if block:
                    add(segments, segment(_join_block(block), heading=heading, page=number))
                    block = []
                text = clean_inline(ln.text)
                # Consecutive heading lines are one wrapped heading.
                if pending_heading:
                    pending_heading.append(text)
                else:
                    pending_heading = [text]
                heading = " ".join(pending_heading)
                first_heading = first_heading or heading
                if number <= 2 and (largest is None or ln.size > largest[0]):
                    largest = (ln.size, heading)
                elif largest and largest[1] in heading:
                    largest = (largest[0], heading)
            else:
                if pending_heading and first_heading in pending_heading:
                    first_heading = heading
                pending_heading = []
                block.append(ln)
        if block:
            add(segments, segment(_join_block(block), heading=heading, page=number))
        elif pending_heading:
            # A page holding only a heading still carries information.
            add(segments, segment(heading or "", heading=heading, page=number))

    meta_title = None
    try:
        meta_title = clean_inline(str(reader.metadata.title)) if reader.metadata and reader.metadata.title else None
    except Exception:
        meta_title = None
    if meta_title and (meta_title.lower() in {"untitled", "anonymous"} or re.search(r"\.(docx?|pptx?|pdf|tex|indd)$", meta_title, re.I)):
        meta_title = None

    confidence = (meaningful / len(pages)) * _garble_factor("\n".join(all_text)) if pages else 0.0
    if meaningful and confidence < 0.6 and meaningful == len(pages):
        warnings.append("The extracted text looks garbled; the PDF may use an unusual font encoding.")
    return finish(
        "pdf",
        segments,
        title=title or meta_title or (largest[1] if largest else None) or first_heading,
        warnings=warnings,
        confidence=confidence,
        empty_message="No text could be extracted from this PDF. It may be a scanned image; text recognition (OCR) is not available.",
    )
