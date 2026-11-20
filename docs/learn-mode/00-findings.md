# Findings before building Learn Mode

What I inspected, and where it differs from what the task assumed.

## The stack (as pushed to `courselab-initial`)
- **Web:** Next.js 15 App Router, React 19, server actions, Drizzle ORM + PostgreSQL (migrations in `web/drizzle`), zod, vitest (real Postgres), Playwright (production build).
- **Worker:** Python FastAPI, stateless: file parsing and numeric checks (numpy, scipy). Same token auth; reachable only from the web server.
- **Extension:** MV3, reads rendered Canvas pages in the student's own tab. **Canvas extraction is in the extension, not in the server.** Imports land as `source_documents` / `source_chunks`, grouped by `modules`.
- **AI:** one OpenAI-compatible client (`web/src/lib/ai/provider.ts`): managed provider (operator key, quotas, cost accounting) or the student's own key (encrypted at rest). Results are cached by input hash in `ai_cache`.
- **Jobs:** a small in-process Postgres-backed queue for imports (`import_jobs`). Learn Mode builds use their own row (`lm_builds`) and run in the web process in the background.
- **Deploy:** Docker Compose (`docker-compose.yml`, overlays for Caddy and a Cloudflare Tunnel), CI on GitHub Actions.

## Where this differs from the task text
1. **No separate extraction step is needed**: Normalize (stage 2) already exists as chunking at import. Learn Mode reads existing chunks. Stage 1 and 2 are reused, not rebuilt.
2. **Repository state:** only `courselab-initial` (PR #1) exists upstream. Work done on the VM (115) that was not pushed is **not visible to me**, and the app on the VM may differ from this branch. `feature/learn-mode` is based on `courselab-initial`.
3. **"Existing AI client" returns JSON with one fixed temperature**: I added a `temperature` option and a per-minute burst limit that can be configured (`AI_BURST_PER_MINUTE`, default 40 as before).
4. **The managed quotas were designed for a few clicks a day**, not for building a guide (see the report: a full build is hundreds of AI calls).
5. **The prototype's generators are hand-written JavaScript for QMB.** For other courses the AI writes them, so the core new component is the checked path from "AI writes a solver" to "stored validated questions" (below).

## Design decisions
- **Where AI-written code runs:** in the existing Python worker, not in the Node web process. `worker/app/sandbox.py` accepts only a pure `solve(p)` (and optional `traps(p)`), checks it against an AST allowlist (no imports, no dunder or most attribute access, only `math` and a small `stats` helper set), and runs it in a separate `python -I` process with CPU, memory and file-size limits, an empty environment and a wall-clock timeout. It cannot block the network on its own: run the worker in a container without egress.
- **Answers come from code.** The model writes the solver, templates and trap formulas; the worker computes every number; a **second, independent solver** written from the question text alone must agree on all validation seeds.
- **Prompts live in `web/prompts/learn-mode/`** (not the repository root) so the existing Docker image already contains them.
- **Mastery:** "practiced" needs at least four **unaided** correct answers among the last five since the practice baseline. The prototype summed scores (hinted = 0.5), which lets three clean and two hinted answers pass. I followed your written rule instead; it is stricter. "Solid" needs a later spaced revisit answered correctly and unaided.
