"""HTML parser: visible text only. No markup is ever returned."""
from __future__ import annotations

import re
from typing import Any

from bs4 import BeautifulSoup, Comment, Doctype, NavigableString, Tag

from .common import add, clean_inline, finish, segment, table_rows_to_text

_DROP_TAGS = [
    "script", "style", "nav", "form", "noscript", "template", "svg", "canvas", "iframe", "object",
    "embed", "button", "select", "input", "textarea", "dialog", "audio", "video", "head", "link", "meta",
]
_HEADINGS = {"h1", "h2", "h3", "h4", "h5", "h6"}
_BLOCKS = _HEADINGS | {
    "p", "div", "section", "article", "main", "header", "footer", "aside", "ul", "ol", "li", "dl", "dt",
    "dd", "blockquote", "pre", "figure", "figcaption", "table", "tr", "td", "th", "hr", "address",
    "details", "summary", "body", "html", "caption", "thead", "tbody", "tfoot",
}
_HIDDEN_STYLE_RE = re.compile(r"(display\s*:\s*none|visibility\s*:\s*(hidden|collapse))", re.IGNORECASE)


def _is_hidden(tag: Tag) -> bool:
    attrs = tag.attrs or {}
    if "hidden" in attrs:
        return True
    if str(attrs.get("aria-hidden", "")).strip().lower() == "true":
        return True
    if _HIDDEN_STYLE_RE.search(str(attrs.get("style", ""))):
        return True
    return False


def parse_html(text: str, *, parser: str = "html", title: str | None = None) -> dict[str, Any]:
    soup = BeautifulSoup(text, "html.parser")
    doc_title = soup.title.get_text(" ", strip=True) if soup.title else None
    for node in soup.find_all(string=lambda s: isinstance(s, (Comment, Doctype))):
        node.extract()
    for tag in soup.find_all(_DROP_TAGS):
        tag.decompose()
    for tag in [t for t in soup.find_all(True) if _is_hidden(t)]:
        if not tag.decomposed:
            tag.decompose()

    segments: list[dict[str, Any]] = []
    state: dict[str, Any] = {"heading": None, "first_h1": None, "first_heading": None}
    paragraphs: list[str] = []
    inline: list[str] = []

    def flush_inline(prefix: str = "") -> None:
        value = clean_inline("".join(inline))
        inline.clear()
        if value:
            paragraphs.append(prefix + value)

    def flush_section() -> None:
        flush_inline()
        if paragraphs:
            add(segments, segment("\n\n".join(paragraphs), heading=state["heading"]))
            paragraphs.clear()

    def walk(node: Any) -> None:
        if isinstance(node, NavigableString):
            inline.append(str(node))
            return
        if not isinstance(node, Tag):
            return
        name = (node.name or "").lower()
        if name in _HEADINGS:
            flush_section()
            value = clean_inline(node.get_text(" "))
            if value:
                state["heading"] = value
                state["first_heading"] = state["first_heading"] or value
                if name == "h1":
                    state["first_h1"] = state["first_h1"] or value
            return
        if name == "table":
            flush_section()
            rows = []
            for tr in node.find_all("tr"):
                cells = tr.find_all(["th", "td"])
                if cells:
                    rows.append([c.get_text(" ") for c in cells])
            add(segments, segment(table_rows_to_text(rows), kind="table", heading=state["heading"]))
            return
        if name == "br":
            flush_inline()
            return
        if name == "pre":
            flush_inline()
            value = node.get_text()
            if value.strip():
                paragraphs.append(value)
            return
        is_block = name in _BLOCKS
        if is_block:
            flush_inline()
        for child in node.children:
            walk(child)
        if is_block:
            flush_inline("- " if name == "li" else "")

    walk(soup)
    flush_section()
    return finish(
        parser,
        segments,
        title=title or doc_title or state["first_h1"] or state["first_heading"],
        warnings=[],
        empty_message="No visible text was found in this page.",
    )
