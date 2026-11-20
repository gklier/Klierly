"""Plain text and Markdown parsers (split on headings)."""
from __future__ import annotations

import re
from typing import Any

from .common import add, clean_inline, finish, segment, table_rows_to_text

_ATX_RE = re.compile(r"^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$")
_SETEXT_RE = re.compile(r"^ {0,3}(=+|-+)[ \t]*$")
_FENCE_RE = re.compile(r"^ {0,3}(```|~~~)")
_TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$")
_TXT_NUMBERED_RE = re.compile(
    r"^((\d+(\.\d+)*[.)]?\s+)|((Chapter|Module|Section|Part|Unit|Week|Lecture|Topic|Appendix)\s+\w+\b))",
    re.IGNORECASE,
)


def _strip_inline_md(text: str) -> str:
    text = re.sub(r"!\[([^\]]*)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", text)
    text = re.sub(r"(\*\*|__)(.+?)\1", r"\2", text)
    text = re.sub(r"(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])", r"\1", text)
    text = re.sub(r"`([^`]+)`", r"\1", text)
    return text


def _split_md_row(line: str) -> list[str]:
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|") and not line.endswith("\\|"):
        line = line[:-1]
    return [_strip_inline_md(c.replace("\\|", "/").strip()) for c in re.split(r"(?<!\\)\|", line)]


def parse_markdown(text: str, *, parser: str = "markdown", title: str | None = None) -> dict[str, Any]:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    segments: list[dict[str, Any]] = []
    heading: str | None = None
    first_h1: str | None = None
    first_heading: str | None = None
    buf: list[str] = []
    in_fence = False

    def flush() -> None:
        if buf:
            add(segments, segment("\n".join(buf), heading=heading))
            buf.clear()

    def set_heading(level: int, value: str) -> None:
        nonlocal heading, first_h1, first_heading
        flush()
        heading = clean_inline(_strip_inline_md(value)) or None
        if heading:
            first_heading = first_heading or heading
            if level == 1:
                first_h1 = first_h1 or heading

    i = 0
    while i < len(lines):
        line = lines[i]
        if _FENCE_RE.match(line):
            in_fence = not in_fence
            i += 1
            continue
        if in_fence:
            buf.append(line)
            i += 1
            continue
        m = _ATX_RE.match(line)
        if m:
            set_heading(len(m.group(1)), m.group(2))
            i += 1
            continue
        if (
            i + 1 < len(lines)
            and line.strip()
            and "|" not in line
            and _SETEXT_RE.match(lines[i + 1])
            and (i == 0 or not lines[i - 1].strip())
            and len(lines[i + 1].strip()) >= 2
        ):
            set_heading(1 if lines[i + 1].strip().startswith("=") else 2, line.strip())
            i += 2
            continue
        if "|" in line and i + 1 < len(lines) and "|" in lines[i + 1] and _TABLE_SEP_RE.match(lines[i + 1]):
            flush()
            rows = [_split_md_row(line)]
            i += 2
            while i < len(lines) and "|" in lines[i] and lines[i].strip():
                rows.append(_split_md_row(lines[i]))
                i += 1
            add(segments, segment(table_rows_to_text(rows), kind="table", heading=heading))
            continue
        if re.match(r"^ {0,3}([-*_])( ?\1){2,}\s*$", line):  # horizontal rule
            buf.append("")
            i += 1
            continue
        buf.append(_strip_inline_md(line))
        i += 1
    flush()
    return finish(parser, segments, title=title or first_h1 or first_heading, warnings=[])


def _is_txt_heading(line: str, prev_blank: bool, next_blank: bool) -> bool:
    s = line.strip()
    if not s or len(s) > 90 or not (prev_blank and next_blank):
        return False
    if s[-1] in ".,;?!" or len(s.split()) > 12:
        return False
    letters = [c for c in s if c.isalpha()]
    if len(letters) < 3:
        return False
    if all(c.isupper() for c in letters):
        return True
    return bool(_TXT_NUMBERED_RE.match(s)) and s[0].isalnum()


def parse_txt(text: str, *, parser: str = "txt", title: str | None = None) -> dict[str, Any]:
    lines = text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    segments: list[dict[str, Any]] = []
    heading: str | None = None
    first_heading: str | None = None
    buf: list[str] = []
    for i, line in enumerate(lines):
        prev_blank = i == 0 or not lines[i - 1].strip()
        next_blank = i == len(lines) - 1 or not lines[i + 1].strip()
        if _is_txt_heading(line, prev_blank, next_blank):
            add(segments, segment("\n".join(buf), heading=heading))
            buf = []
            heading = clean_inline(line)
            first_heading = first_heading or heading
        else:
            buf.append(line)
    add(segments, segment("\n".join(buf), heading=heading))
    return finish(parser, segments, title=title or first_heading, warnings=[])
