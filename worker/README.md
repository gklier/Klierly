# Klierly worker

Stateless FastAPI service: file parsing (`/parse`, `/parse-text`) and vetted
numerical checks (`/numeric/*`). Contract: `../docs/CONTRACTS.md`. It has no
database access, never logs or stores document contents, and must not be
exposed to the internet (the web app calls it with `X-Worker-Token`).

```bash
python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
WORKER_TOKEN=<same value as the web app> .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001
.venv/bin/python -m pytest -q
```
