import os
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ["WORKER_TOKEN"] = "test-token"
os.environ["MAX_UPLOAD_MB"] = "2"

from app.main import app  # noqa: E402

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
SAMPLE = FIXTURES / "qmb-sample"
BAD = FIXTURES / "bad"
AUTH = {"X-Worker-Token": "test-token"}


@pytest.fixture(scope="session")
def client():
    return TestClient(app)


@pytest.fixture(scope="session")
def parse(client):
    def _parse(path: Path | None = None, *, name: str | None = None, data: bytes | None = None):
        content = data if data is not None else path.read_bytes()
        return client.post("/parse", headers=AUTH, files={"file": (name or path.name, content)})
    return _parse


@pytest.fixture(scope="session")
def compute(client):
    def _compute(fn, args):
        return client.post("/numeric/compute", headers=AUTH, json={"fn": fn, "args": args})
    return _compute
