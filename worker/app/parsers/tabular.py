"""CSV and XLSX parsers: normalized pipe-delimited tables."""
from __future__ import annotations

import csv
import io
from typing import Any

from ..errors import WorkerError
from .common import MAX_TABLE_ROWS, finish, open_zip, tabular_segments

MAX_COLUMNS = 500


def parse_csv(text: str, *, title: str | None = None) -> dict[str, Any]:
    warnings: list[str] = []
    sample = text[:8192]
    delimiter = ","
    try:
        delimiter = csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        pass
    rows: list[list[str]] = []
    try:
        for row in csv.reader(io.StringIO(text, newline=""), delimiter=delimiter):
            rows.append(row[:MAX_COLUMNS])
            if len(rows) > MAX_TABLE_ROWS + 1:
                break
    except csv.Error as exc:
        raise WorkerError(422, "parse_failed", "The CSV file could not be read (malformed quoting or delimiters).") from exc
    segments = tabular_segments(rows, heading=None, label="This table", warnings=warnings)
    return finish("csv", segments, title=title, warnings=warnings, empty_message="The CSV file has no rows.")


def parse_xlsx(data: bytes, *, title: str | None = None) -> dict[str, Any]:
    from openpyxl import load_workbook

    open_zip(data).close()  # zip-bomb sanity check before openpyxl unpacks anything
    warnings: list[str] = []
    try:
        wb = load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except Exception as exc:  # openpyxl raises many unrelated exception types
        raise WorkerError(422, "parse_failed", "The spreadsheet could not be opened; it may be damaged.") from exc
    segments: list[dict[str, Any]] = []
    try:
        for ws in wb.worksheets:
            rows: list[list[Any]] = []
            try:
                for row in ws.iter_rows(values_only=True):
                    rows.append(list(row[:MAX_COLUMNS]))
                    if len(rows) > MAX_TABLE_ROWS + 1:
                        break
            except Exception as exc:
                raise WorkerError(422, "parse_failed", "A worksheet could not be read; the file may be damaged.") from exc
            sheet = str(ws.title)
            segments.extend(tabular_segments(rows, heading=sheet, label=f"Sheet '{sheet}'", warnings=warnings))
    finally:
        wb.close()
    return finish("xlsx", segments, title=title, warnings=warnings, empty_message="The spreadsheet has no cell values.")
