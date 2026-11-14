# CourseLab (working title)

A private, course-grounded study app. You import course material you are allowed to use; CourseLab
turns it into a searchable library, a day-by-day study plan and original practice questions with
scored feedback and source references. It is a learning tool, not a way to complete graded work,
and it does not predict exam questions or grades.

Three parts: `web/` (Next.js + PostgreSQL), `worker/` (Python: file parsing and tested numerical
checks), `extension/` (optional Chrome/Edge extension). See `ARCHITECTURE.md`, `ROADMAP.md`,
`TEST_REPORT.md`.

## Run it locally

Needs Node 22+, Python 3.11+, PostgreSQL 16.

```bash
# 1. Database (once)
createuser courselab --pwprompt && createdb courselab -O courselab

# 2. Settings
cp .env.example web/.env.local
#    edit web/.env.local: set DATABASE_URL password, APP_SECRET (openssl rand -base64 48), WORKER_TOKEN (openssl rand -hex 24)

# 3. Worker (terminal 1)
cd worker && python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
WORKER_TOKEN=<same value as in web/.env.local> .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8001

# 4. Web app (terminal 2)
cd web && npm install && npm run db:migrate && npm run build && npm start
```

Open http://localhost:3000. Health check: `curl http://localhost:3000/api/health` →
`{"status":"ok","database":true,"worker":true}`. For development use `npm run dev` instead of build/start.

**Or with Docker** (builds for amd64 and arm64): `cp .env.example .env`, set `APP_SECRET`,
`WORKER_TOKEN`, `POSTGRES_PASSWORD`, then `docker compose up --build`. Only the web app is published,
on 127.0.0.1:3000.

**Account.** The first account can be created freely at `/register`; after that registration needs
`INVITE_CODE`. No passwords are built in. Optional: `SEED_EMAIL=… SEED_PASSWORD=… npm run db:seed`
creates an account with the sample course.

### Settings (`web/.env.local`)

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection |
| `APP_SECRET` | 32+ random characters; encrypts saved AI keys. Changing it invalidates saved keys |
| `APP_URL` | Public address of the app (https in production) |
| `WORKER_URL`, `WORKER_TOKEN` | Internal parsing/calculation service and its shared secret |
| `UPLOAD_DIR`, `MAX_UPLOAD_MB` | Where originals are stored; per-file limit (default 25 MB) |
| `INVITE_CODE` | Required to register once an account exists |
| `TZ` | Time zone for "today" in plans |
| `ALLOW_PRIVATE_AI_ENDPOINTS` | `true` allows http://localhost model servers; set `false` on a shared server |

## Try it without an AI key

On the Courses page choose **Load the sample course**. It imports a *synthetic* statistics course
(`fixtures/qmb-sample`, written for this app — not real university content) through the normal
pipeline and adds 35 hand-written questions whose numeric answers are recomputed by the worker.
Everything except generating new questions and notes works without a key.

## Connect an AI provider (optional)

Settings → AI connection: base URL (ending before `/chat/completions`), model ID, API key, then
**Test connection**. Any OpenAI-compatible API works, including a model on your own machine.
A ChatGPT/Claude subscription login is not an API key. The key is stored encrypted, never returned
to the browser, never logged. Only when you click Generate, the course name, topic names and up to
six short excerpts per topic are sent to that provider. A daily request limit protects your quota.

UF NaviGator Toolkit is listed as **experimental**: confirm in UF's current terms that your
allocation may be used with a third-party tool, and take the endpoint and model ID from UF's
documentation, before using it. CourseLab makes no claim about either.

For testing without a paid provider: `cd web && npm run mock-llm` starts a deterministic stand-in
(base URL `http://127.0.0.1:4010/v1`, key `test-key`, model `mock-1`). Its questions are
structurally valid but trivial — it exists to test the pipeline, not to study from.

## Study for a real exam (QMB 3250 walk-through)

1. **New course** → `QMB 3250 – Statistics for Business Decisions`, term and tentative exam date optional.
2. **Materials** → tick the permission box → upload syllabus, notes, slides, transcripts
   (PDF, DOCX, PPTX, TXT, Markdown, HTML, CSV, XLSX, SRT, VTT) or paste text. Scanned PDFs without a
   text layer are rejected with a clear message (no OCR yet).
3. Review **Suggestions from your materials** (modules, topics, objectives, dates — each links to the
   passage it came from). Accept, dismiss, or fix module/topic mapping by hand. **Coverage** shows gaps.
4. **Practice → Generate new questions** (needs the AI connection). Drafts with a wrong calculation,
   no real source, duplicate wording or more than one correct answer are discarded.
5. **Study plan → Prepare for an exam**: real exam date, modules covered, minutes per day, how sessions
   start, optional self-ratings, exam format if announced. Unknown format is labelled, not guessed.
6. Work the plan: **Start practice** on a session, or use Drill / Timed mock exam / Review mistakes / Learn.
   Tag why a miss happened. Click any source reference to see the document, page, slide or timestamp.
7. **Progress** shows mastery by topic, mistake reasons and a readiness estimate (a heuristic, not a
   grade prediction). **Update plan** re-weights the schedule and reschedules missed days.
8. Delete a source (its page), a course (course settings) or everything (Settings → Delete account).

## Browser extension (optional)

Chrome/Edge: `chrome://extensions` (or `edge://extensions`) → Developer mode → **Load unpacked** →
choose the `extension/` folder. Then in CourseLab: Settings → Browser extension → **Create pairing
token**; paste the server address and token into the extension's settings. Details, limits and the
pre-publication checklist: `extension/README.md`.

## Tests

```bash
cd worker && .venv/bin/pip install -r requirements-dev.txt && .venv/bin/python -m pytest -q
cd web && npm run typecheck && npm run lint && npm test     # needs Postgres + worker running; uses database courselab_test
cd web && npm run test:e2e                                   # builds, then Playwright; uses database courselab_e2e
cd extension && npm test
```
`courselab_test` must exist (`createdb courselab_test -O courselab`); the role needs CREATEDB for the E2E reset.

## Founder action required

- **AI provider**: choose one and enter its key in Settings (or confirm NaviGator's terms first).
- **Real pilot**: import your own permitted QMB 3250 material; check your syllabus/instructor rules on
  sharing material with outside AI services and set the per-course switch accordingly.
- **Before any public launch**: legal review of the privacy draft, hosting decision (nothing has been
  deployed or purchased), extension store policies re-checked. See `ROADMAP.md`.
