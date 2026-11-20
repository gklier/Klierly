"""SRT / WebVTT parsers: cues merged into ~45 second segments."""
from __future__ import annotations

import re
from typing import Any

from ..errors import WorkerError
from .common import add, clean_inline, finish, segment

SEGMENT_MS = 45_000
_TS = r"(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[.,](\d{1,3})"
_CUE_RE = re.compile(rf"^\s*{_TS}\s*-->\s*{_TS}")
_TAG_RE = re.compile(r"</?[A-Za-z][^>]*>|<\d{2}:\d{2}[^>]*>|\{\\[^}]*\}")
# Automatic captions detach punctuation from its word: "p -value", "in -store", "negative 0 .286".
_SPACED_HYPHEN = re.compile(r"(?<=[A-Za-z0-9]) -(?=[A-Za-z0-9])")
_SPACED_DECIMAL = re.compile(r"(?<=\d) \.(?=\d)")


def fix_caption_spacing(text: str) -> str:
    """Rejoin hyphens and decimal points that speech recognition split from their words. Wording is not changed."""
    return _SPACED_DECIMAL.sub(".", _SPACED_HYPHEN.sub("-", text))


def _ms(h: str | None, m: str, s: str, frac: str) -> int:
    return ((int(h or 0) * 60 + int(m)) * 60 + int(s)) * 1000 + int(frac.ljust(3, "0"))


def _parse_cues(text: str) -> list[tuple[int, int, str]]:
    cues: list[tuple[int, int, str]] = []
    blocks = re.split(r"\n[ \t]*\n", text.replace("\r\n", "\n").replace("\r", "\n"))
    for block in blocks:
        lines = [ln for ln in block.split("\n") if ln.strip()]
        for idx, line in enumerate(lines[:2]):  # timing line is first, or second after a cue id
            m = _CUE_RE.match(line)
            if m:
                g = m.groups()
                start, end = _ms(*g[0:4]), _ms(*g[4:8])
                body = fix_caption_spacing(clean_inline(_TAG_RE.sub("", " ".join(lines[idx + 1 :]))))
                if body and end >= start:
                    cues.append((start, end, body))
                break
    cues.sort(key=lambda c: c[0])
    return cues


def parse_subtitles(text: str, *, parser: str, title: str | None = None) -> dict[str, Any]:
    if parser == "vtt" and not text.lstrip("﻿ \t\r\n").startswith("WEBVTT"):
        raise WorkerError(415, "type_mismatch", "The file is named .vtt but does not start with the WEBVTT header.")
    cues = _parse_cues(text)
    segments: list[dict[str, Any]] = []
    group: list[tuple[int, int, str]] = []

    def flush() -> None:
        if group:
            add(
                segments,
                segment(
                    " ".join(c[2] for c in group),
                    t_start_ms=group[0][0],
                    t_end_ms=max(c[1] for c in group),
                ),
            )
            group.clear()

    for cue in cues:
        if group and cue[1] - group[0][0] > SEGMENT_MS:
            flush()
        group.append(cue)
    flush()
    return finish(parser, segments, title=title, warnings=[], empty_message="No subtitle cues with text were found.")
