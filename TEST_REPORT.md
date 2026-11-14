# Test report

Run on 2026-11-14 in a Linux x86_64 container: Node 22.23, Python 3.13, PostgreSQL 16.15,
Chromium (Playwright 1.63). Everything below was actually executed; items that could not be run are
listed separately under **Not verified**.

## Commands and results

| Command | Result |
| --- | --- |
| `cd worker && .venv/bin/python -m pytest -q` | **25 passed** |
| `cd web && npm run typecheck` | clean |
| `cd web && npm run lint` | clean (0 errors, 0 warnings) |
| `cd web && npm test` (vitest; real PostgreSQL + real worker + mock AI provider) | **65 passed** (3 files) |
| `cd web && npm run test:e2e` (`next build`, then Playwright against the production build, fresh database) | build OK · **22 passed** (15 journey + 7 extension), repeated 4× without a flake after the fix noted below |
| `cd extension && npm test` | **9 passed** |
| `npm audit --omit=dev` (web) | 0 vulnerabilities (PostCSS pinned ≥ 8.5.23 via `overrides`) |
| `pip-audit -r worker/requirements.txt` | no known vulnerabilities |
| `curl localhost:3000/api/health` | `{"status":"ok","database":true,"worker":true}` |
| `docker compose config` (both compose files) | valid |

`npm audit` including dev-only tooling still reports advisories in test/build tools that are not shipped.

## Required checks

| # | Check | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Fresh install starts; health passes | Pass* | E2E creates a new database from migrations and boots the production build; health asserted. *The README was not replayed on a second clean machine |
| 2 | Create/delete course; data isolation | Pass | E2E 2, 13, 15; integration "data isolation", "deletion" (rows and files checked per table) |
| 3 | Upload PDF and text; chunks and locations inspectable; bad uploads fail clearly | Pass | E2E 3, 6; integration "ingestion"; worker parser tests (wrong type, mismatch, encrypted, empty, oversize) |
| 4 | Paste import; module mapping and sources persist | Pass | E2E 5; integration "duplicates and pasted text" |
| 5 | With a test AI credential: grounded study note and ≥ 10 questions; no-key / bad-key transparent | Pass with a **mock** provider | E2E 7–8; integration "AI generation" (rejections, insufficient sources, bad key, bad output, limits, course switch) |
| 6 | MCQ and numeric scoring; deterministic math; exam grades only after submission | Pass | unit "grading"; worker numeric tests vs scipy/statsmodels; integration "timed exam reveals nothing"; E2E 10–11 |
| 7 | History persists; mastery updates; spaced review queues a missed concept | Pass | integration "drill…"; E2E 10–11 |
| 8 | Plan respects date, modules, minutes; missing scope warns | Pass | unit "study plan" (6 cases); integration "study plan"; E2E 9 |
| 9 | Citations open the right document/page/excerpt; nothing fabricated | Pass | integration "every sample citation resolves…"; E2E 6, 10; unit "rejects citations to sources that were not provided" |
| 10 | Extension: manual capture on mock LMS, preview, confirm, source appears; active quiz blocked; minimal permissions | Pass, with a test seam | E2E extension 1–7 against the real web app; manifest test. See note |
| 11 | Playwright E2E; unit tests for parsing, math, schema, auth/ownership, prompt injection | Pass | above |
| 12 | Build, Python tests, type checks; no console errors or dead navigation | Pass | console errors are collected across the journey and asserted empty (expected 403/404/415 responses provoked by the tests are excluded) |

**Extension test seam.** Automation cannot click the browser toolbar, so `activeTab` is never granted
to a test. The E2E copies the extension to a temp folder and adds a host permission for the local
fixture server *to that copy only*; the popup accepts `?tabId=`. The shipped manifest is asserted to
contain exactly `activeTab`, `scripting`, `storage`. The real toolbar click was therefore **not**
exercised by a machine — try it once by hand (README → Browser extension).

## Bugs the tests caught (all fixed)

- Scheduler dropped a spaced review that landed on mock-exam day and reported it as "did not fit".
- A pasted page naming its module only in the text was not auto-mapped; then a syllabus processed
  *after* the module notes was mis-mapped to a module (order-dependent). Replaced with a per-document
  module hint; regression test added.
- "Use this date and scope" did not untick out-of-scope modules (stale form state).
- Progress page crashed once answers existed (constant imported from a client component).
- Header overflowed at phone width.
- Extension source contained raw invisible Unicode in a regular expression and did not parse.

## Not verified — please read

- **Real AI provider.** Generation was only run against the bundled deterministic mock. Prompts,
  JSON handling and the validators are tested; the *quality* of questions from a real model on real
  course material is untested. First real run should be watched closely.
- **Docker.** No Docker daemon was available: the Dockerfiles and compose files are syntax-checked
  but never built or started, on amd64 or arm64.
- **Real LMS pages.** The extension was tested on synthetic pages only. Real Canvas pages may render
  content in frames or block extensions; the extractor does not read frames by design.
- **Other browsers.** Chromium only. Edge should behave the same; Firefox is not targeted.
- **Founder's actual QMB 3250 material** was not available; all course content in tests is synthetic.
- **Scale and load**: single user, small files. **Accessibility**: keyboard paths and labels were
  exercised by the E2E, but no screen-reader or automated contrast audit was run.
- **External policies** (Chrome Web Store, Instructure, UF, NaviGator, Oracle Always Free limits)
  were designed for, not re-verified line by line; re-read them before publication or deployment.
