# Calculation questions on a hosted site: the isolated solver

Learn Mode's calculation questions are made by AI-written Python (`solve(p)`), run by code, and checked by a second AI-written solver. Running AI-written code is the riskiest thing in the app, so a hosted deployment does **not** run it unless you set up a dedicated container for it. Without one, Learn Mode builds conceptual and matching questions only (the Learn page says so).

## What is enforced
- The ordinary parsing worker never executes solver code (`/sandbox/run` returns 404 there).
- A separate **solver** container (`WORKER_ROLE=solver`) serves only `/health` and `/sandbox/run`: no parsers, no numeric helpers.
- It has its **own secret** (`SOLVER_TOKEN`), different from `WORKER_TOKEN`, so a leak of one does not open the other. If the secret is empty the solver refuses every call, so a missing secret fails closed. (It is not a *required* compose variable, because Compose reads it even when the solver is switched off.)
- It sits on its **own Docker network** (`solver-net`, `internal: true`) shared only with the web app: no route to the internet and no route to the database or the parsing worker.
- The container is read-only, drops all capabilities, cannot gain privileges, and is limited to 1 CPU, 1 GB and 64 processes.
- Inside it, each batch runs in a fresh `python -I` process: an AST allowlist (no imports, no dunder or most attribute access), CPU, memory and file-size limits, an empty environment and a wall-clock timeout. See `worker/app/sandbox.py`.

## Turn it on (server `.env`)
```
COMPOSE_PROFILES=solver
SOLVER_TOKEN=<new long random secret, not the same as WORKER_TOKEN>
WORKER_SOLVER_URL=http://solver:8001
```
```bash
docker compose up -d --build
```
If you use an overlay file (tunnel, Caddy), keep the same `-f` flags you use today.

## Turn it off
Empty `WORKER_SOLVER_URL` (or remove the profile) and restart the web container. Questions already built stay; no new calculation questions are made.

## What is verified and what is not
Verified here: the worker refuses solver calls unless it is the solver role or a test worker; the solver role exposes nothing else; the web app sends solver calls to the solver URL with the solver token and never uses it for parsing; the compose file puts the solver on a network that contains neither the database nor the parsing worker (checked by parsing the file); the sandbox's own tests (escape attempts, runaway loops, memory bombs, NaN).

**Not verified:** the container itself. Docker was not available in the environment I worked in, so I have not built the image with this role or confirmed from inside it that there is no outbound network. Please check once on the server:
```bash
docker compose exec solver python -c "import urllib.request;urllib.request.urlopen('https://example.com',timeout=3)"
```
It should fail. A sandbox with this design is a strong filter, not a proof; keep the solver container disposable and never give it secrets.
