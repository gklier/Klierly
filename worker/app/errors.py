"""Error type shared by parsers and numeric code.

Every error leaves the service as
``{"detail": {"code": "<machine_code>", "message": "<plain language>"}}``.
"""
from __future__ import annotations


class WorkerError(Exception):
    def __init__(self, status: int, code: str, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
