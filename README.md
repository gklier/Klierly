# Klierly (working title)

A private, course-grounded study app. You import course material you are allowed to use; Klierly
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
createuser klierly --pwprompt && createdb klierly -O klierly

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

## AI: included, your own, or none

| Mode | Who pays | How |
| --- | --- | --- |
| **Klierly AI (managed)** | The operator | Set `MANAGED_AI_BASE_URL`, `MANAGED_AI_API_KEY`, `MANAGED_AI_MODEL` on the server. Students then need no key; they get a free allowance with visible usage. Details and limits: `docs/MANAGED_AI.md` |
| **Your own provider** | The student | Settings → AI connection: base URL, model ID, API key, Test connection. Takes precedence over Klierly AI |
| **None** | — | Import, search, study plan, practice on existing questions, grading and progress all still work |

**Managed AI is OFF until the operator configures it, and no real provider has been configured or
paid for.** It has been tested only against the bundled mock (`cd web && npm run mock-llm` →
`http://127.0.0.1:4010/v1`, key `test-key`, model `mock-1`), whose questions are structurally valid
but trivial. A ChatGPT or Claude subscription login is not an API credential and cannot be used.
UF NaviGator is experimental and BYOK-only; see `docs/MANAGED_AI.md`.

The sample course (Courses → **Load the sample course**) is synthetic, comes with 35 checked
questions, and needs no AI.

## Study for a real exam (QMB 3250 walk-through)

1. **New course** → `QMB 3250 – Statistics for Business Decisions`, term and tentative exam date optional.
2. **Materials** → tick the permission box → upload syllabus, notes, slides, transcripts
   (PDF, DOCX, PPTX, TXT, Markdown, HTML, CSV, XLSX, SRT, VTT) or paste text. Scanned PDFs without a
   text layer are rejected with a clear message (no OCR yet).
3. Review **Suggestions from your materials** (modules, topics, objectives, dates — each links to the
   passage it came from). Accept, dismiss, or fix module/topic mapping by hand. **Coverage** shows gaps.
   Topics come from your course itself, in this order: the **learning objectives** it states (one topic each, full objective kept), then useful section headings. File names, "Plan / Report / Step 2" labels and near-duplicates are filtered. **Suggest topics with AI** (Materials → Topics) can tidy and merge them; it only reads your material, every suggestion must point at a real excerpt, and nothing is added without your review.
4. **Practice → Generate new questions** (needs AI: included or your own), or **Use the exam blueprint** to see how many
   questions each topic should get, generate only the missing ones, and take a mock exam mixed to it. Drafts with a wrong calculation,
   no real source, duplicate wording or more than one correct answer are discarded.
5. **Study plan → Prepare for an exam**: real exam date, modules covered, minutes per day, how sessions
   start, optional self-ratings, exam format. If your syllabus states the exam structure (questions, types, minutes,
   points), Klierly finds it and fills it in for you to confirm; otherwise the format is labelled unknown, not guessed.
6. Work the plan: **Start practice** on a session, or use Drill / Timed mock exam / Review mistakes / Learn.
   Tag why a miss happened. Click any source reference to see the document, page, slide or timestamp.
7. On a topic's Learn page, **Explain what the notes leave out** asks the AI to fill gaps in thin notes. That text is
   general knowledge, shown separately in a dashed box labelled "AI-added · not from your course", never cited, never used to write questions.
8. **Activity** (top bar) records what you did and what Klierly did for you; **Download diagnostics** gives a
   JSON file of events, counts and titles (never document text or keys) to share when something needs debugging.
9. **Progress** shows mastery by topic, mistake reasons and a readiness estimate (a heuristic, not a
   grade prediction). **Update plan** re-weights the schedule and reschedules missed days.
10. Delete a source (its page), a course (course settings) or everything (Settings → Delete account).

## Browser extension

Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → choose the `extension/` folder.
In Klierly: Settings → Browser extension → **Create pairing token**; paste the server address and
token into the extension's settings.

- **Discover this course** (on a Canvas course page): lists modules and items, lets you pick a
  module range or single items, shows what will and will not be imported and why, then imports with
  progress, stop and resume. Run it again later to pick up new or changed pages.
- **Capture this page**: one page, preview first.
- **Import captions**: on a page with a lecture video, reads the captions the player exposes, with timestamps.

It reads rendered pages in your own tab and does not use the Canvas API. What that relies on, and
what has not been established (institutional permission, real Canvas compatibility): `docs/LMS_ACCESS.md`.
More detail: `extension/README.md`.

## Tests

```bash
cd worker && .venv/bin/pip install -r requirements-dev.txt && .venv/bin/python -m pytest -q
cd web && npm run typecheck && npm run lint && npm test     # needs Postgres + worker running; uses database klierly_test
cd web && npm run test:e2e                                   # builds, then Playwright; uses database klierly_e2e
cd extension && npm test
```
`klierly_test` must exist (`createdb klierly_test -O klierly`); the role needs CREATEDB for the E2E reset.

## Founder action required

- **Managed AI**: choose and fund a provider, then set the three `MANAGED_AI_*` variables. Until then students need their own key.
- **UF / Canvas**: confirm that using the extension on your course site is permitted (`docs/LMS_ACCESS.md`).
- **Real pilot**: import your own permitted QMB 3250 material; check your syllabus/instructor rules on
  sharing material with outside AI services and set the per-course switch accordingly.
- **Before any public launch**: legal review of the privacy draft, hosting decision (nothing has been
  deployed or purchased), extension store policies re-checked. See `ROADMAP.md`.
