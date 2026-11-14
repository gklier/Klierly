"""DOCX and PPTX parsers."""
from __future__ import annotations

import io
import re
from typing import Any

from ..errors import WorkerError
from .common import add, clean_inline, finish, open_zip, segment, table_rows_to_text

_HEADING_STYLE_RE = re.compile(r"^(heading|titre|überschrift|ueberschrift|título|titulo|titolo)\s*\d", re.IGNORECASE)


def _docx_heading_kind(paragraph: Any, text: str) -> str | None:
    style = ""
    try:
        style = (paragraph.style.name or "") if paragraph.style is not None else ""
    except Exception:
        style = ""
    low = style.lower()
    if low == "title":
        return "title"
    if _HEADING_STYLE_RE.match(style) or low == "subtitle":
        return "heading"
    # Fallback for documents that fake headings with bold text.
    if len(text) <= 100 and text[-1] not in ".,;:?!" and not low.startswith("list"):
        runs = [r for r in paragraph.runs if r.text.strip()]
        if runs and all(r.bold for r in runs):
            return "heading"
    return None


def parse_docx(data: bytes, *, title: str | None = None) -> dict[str, Any]:
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    open_zip(data).close()
    try:
        document = docx.Document(io.BytesIO(data))
    except Exception as exc:
        raise WorkerError(422, "parse_failed", "The Word document could not be opened; it may be damaged.") from exc

    segments: list[dict[str, Any]] = []
    heading: str | None = None
    doc_title: str | None = None
    first_heading: str | None = None
    buf: list[str] = []

    def flush() -> None:
        if buf:
            add(segments, segment("\n\n".join(buf), heading=heading))
            buf.clear()

    try:
        for item in document.iter_inner_content():
            if isinstance(item, Paragraph):
                text = clean_inline(item.text)
                if not text:
                    continue
                kind = _docx_heading_kind(item, text)
                if kind:
                    flush()
                    heading = text
                    if kind == "title":
                        doc_title = doc_title or text
                    else:
                        first_heading = first_heading or text
                    continue
                style = ""
                try:
                    style = (item.style.name or "").lower()
                except Exception:
                    pass
                if style.startswith("list"):
                    text = "- " + text
                    if buf and buf[-1].startswith("- "):
                        buf[-1] = buf[-1] + "\n" + text
                        continue
                buf.append(text)
            elif isinstance(item, Table):
                flush()
                rows = []
                for row in item.rows:
                    cells: list[str] = []
                    previous = None
                    for cell in row.cells:
                        if previous is not None and cell._tc is previous:  # horizontally merged cell
                            continue
                        previous = cell._tc
                        cells.append(cell.text)
                    rows.append(cells)
                add(segments, segment(table_rows_to_text(rows), kind="table", heading=heading))
    except WorkerError:
        raise
    except Exception as exc:
        raise WorkerError(422, "parse_failed", "The Word document could not be read; it may be damaged.") from exc
    flush()

    meta_title = None
    try:
        meta_title = clean_inline(document.core_properties.title) or None
    except Exception:
        pass
    return finish("docx", segments, title=title or doc_title or meta_title or first_heading, warnings=[])


def _shape_blocks(shapes: Any, skip_id: int | None, depth: int = 0) -> list[str]:
    blocks: list[str] = []
    if depth > 8:
        return blocks
    for shape in shapes:
        if skip_id is not None and shape.shape_id == skip_id:
            continue
        if shape.shape_type is not None and str(shape.shape_type).startswith("GROUP"):
            blocks.extend(_shape_blocks(shape.shapes, skip_id, depth + 1))
            continue
        if getattr(shape, "has_table", False) and shape.has_table:
            rows = [[cell.text for cell in row.cells] for row in shape.table.rows]
            text = table_rows_to_text(rows)
            if text:
                blocks.append(text)
            continue
        if getattr(shape, "has_text_frame", False) and shape.has_text_frame:
            lines = []
            for para in shape.text_frame.paragraphs:
                value = clean_inline("".join(run.text for run in para.runs) or para.text)
                if value:
                    lines.append(("- " if para.level else "") + value)
            if lines:
                blocks.append("\n".join(lines))
    return blocks


def parse_pptx(data: bytes, *, title: str | None = None) -> dict[str, Any]:
    from pptx import Presentation

    open_zip(data).close()
    try:
        prs = Presentation(io.BytesIO(data))
    except Exception as exc:
        raise WorkerError(422, "parse_failed", "The presentation could not be opened; it may be damaged.") from exc

    segments: list[dict[str, Any]] = []
    first_title: str | None = None
    try:
        for number, slide in enumerate(prs.slides, start=1):
            title_shape = slide.shapes.title
            slide_title = clean_inline(title_shape.text_frame.text) if title_shape is not None and title_shape.has_text_frame else ""
            first_title = first_title or slide_title or None
            body = "\n\n".join(_shape_blocks(slide.shapes, title_shape.shape_id if title_shape is not None else None))
            add(segments, segment(body or slide_title, heading=slide_title or None, slide=number))
            if slide.has_notes_slide and slide.notes_slide.notes_text_frame is not None:
                notes = slide.notes_slide.notes_text_frame.text
                label = slide_title or f"Slide {number}"
                add(segments, segment(notes, heading=f"{label} (speaker notes)", slide=number))
    except WorkerError:
        raise
    except Exception as exc:
        raise WorkerError(422, "parse_failed", "The presentation could not be read; it may be damaged.") from exc

    meta_title = None
    try:
        meta_title = clean_inline(prs.core_properties.title) or None
    except Exception:
        pass
    if meta_title and meta_title.lower() in {"powerpoint presentation", "untitled"}:
        meta_title = None
    return finish("pptx", segments, title=title or meta_title or first_title, warnings=[], empty_message="The presentation has no text on its slides.")
