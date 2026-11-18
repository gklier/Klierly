# Test report (Phase 2)

Run on 2026-11-14 in a Linux x86_64 container: Node 22, Python 3.13, PostgreSQL 16, Chromium
(Playwright 1.63). Everything in the tables was executed. What could not be run is under
**Not verified**, and that section matters more than the green numbers.

## Results

| Command | Result |
| --- | --- |
| `cd worker && python -m pytest -q` | **26 passed** |
| `cd web && npm run typecheck` / `npm run lint` | clean / clean |
| `cd web && npm test` (real PostgreSQL + real worker + mock AI) | **101 passed** |
| `cd web && npm run test:e2e` (production build; Chromium with the extension loaded) | **44 passed**: 19 journey, 7 single-page capture, 11 course discovery (incl. joining a class), captions, Mediasite and extension logging, 7 class library |
| `cd extension && npm test` | **17 passed** |
| `npm audit --omit=dev` (web) · `pip-audit` (worker, Phase 1) | 0 vulnerabilities · none known |
| `docker compose config` | valid (syntax only) |
| GitHub Actions on a clean runner (fresh install from the lockfiles) | all 4 jobs pass |

Stability: the full E2E suite was run 13 times after the last fixes: 12 clean. **One run
reported an unexplained browser console error** in the journey suite; it did not reproduce in 7
further runs and its text was not captured. Treat as an open flake.

## What Phase 2 added, and how each was checked

| Feature | Evidence |
| --- | --- |
| Rename to Klierly | all suites re-run after the rename; no "CourseLab" left in tracked text |
| Managed AI: no key needed, quotas, tiering, cost accounting, key secrecy, BYOK precedence | integration "managed AI" (6 tests): per-student daily and monthly limits, shared daily cap, monthly budget stop, failed calls counted, routine model first and stronger model only on retries, cost computed from configured prices, status object free of credentials. E2E 7, 8, 8b: generation with no key entered, usage shown, operator page totals, page source never contains the key, students get 404 on `/admin` |
| "AI not configured" state | manual run on a server without `MANAGED_AI_*`: Practice, Settings and Blueprint show the plain explanation |
| Course discovery | E2E discovery 1–5, 7 against a mock course site: inventory of 3 modules / 13 items with reasons for the 7 not offered; nothing opened or sent during scan; range selection; approval required; 4 imported, 2 reported (unsupported type, no download link); quiz, assignment, discussion, external tool never opened; no LMS API call; modules created by name; PDF page provenance preserved; sync leaves 3 unchanged, replaces 1 changed page, no duplicates; stop and resume; token and ownership enforced |
| Lecture captions | E2E discovery 6: captions from a player on the page and from a player in a cross-site frame, imported as WebVTT, searchable, citation shows the lecture timestamp. Unit: VTT formatting |
| Structure-preserving capture, topic quality | unit "topic headings (from a real course report)" uses the founder's reported cases; integration: AI topic suggestions drop a bare label, an invented subject and an uncited one, supersede heading guesses, apply nothing without review |
| Exam blueprint and follow-up | unit (allocation sums, floors, damping; quota selection with top-up); E2E 10b: scope follows the plan, gaps generated, exam built to it, results offer a weak-topic drill and fresh questions |
| Partial-result handling | found by E2E: two quick generations hit the burst limit and lost finished work; generation now keeps what was saved and reports why it stopped |
| CI | ran on GitHub for pull request #1: worker, extension, web (types, lint, audit, integration, end-to-end) and the no-secrets check all pass. The first run exposed a broken secrets-check script (fixed); the check is proven to fail on a planted key |

## Added in the second round (founder answers)

| Feature | Evidence |
| --- | --- |
| Topics from learning objectives; near-duplicate merging | unit: the four real "Module 21" objectives (unbulleted, under a "Learning Objectives" line) become "Wilcoxon Rank Sum and Mann-Whitney test", "Kruskal Wallace test", "Rank data from other forms of data", "When to use …"; reworded duplicates merged; integration: 12 objective topics from the syllabus, nothing applied without review, a reworded heading is not suggested again |
| Class library | unit: 8-word copy detector (case/punctuation-insensitive, 7 words passes), exam-title heuristic ("t-test" and "Exam 1 review" pass, "Midterm 2" and "Quiz 3 solutions" blocked), identity parsing, claim expiry. Integration (real Postgres, mock AI): joining is idempotent and never links someone else's course; a copying model's summary is discarded; sharing needs a linked course, a current claim and a non-exam title; the shared row contains no source text, file name or author; a different class and a lapsed claim see nothing; reports need two different classmates, the author cannot report, the operator can hide/restore, switch a class off; take-down, leaving a class and deleting an account remove shared items. E2E: terms required, summary private until consent, classmate sees an AI-labelled item without a name, report, operator hides and restores it, outsider sees nothing, student gets 404 on `/admin`; extension E2E: join sends exactly six fields and links the course. **Not verified:** enrolment (it cannot be), real Canvas titles, real AI summary quality, whether instructors accept this. |
| Exam format from the syllabus | unit: question counts, types, minutes, points, matching to Exam 1 / Final, implausible numbers rejected; integration: two formats stored with their evidence; E2E: the plan form is prefilled with 27 questions / 75 minutes and the blueprint uses them |
| AI "what your notes leave out" | integration: stored apart from notes, never feeds questions, refused without material or when the course disallows AI; E2E: shown in a dashed box labelled not from the course, no links, with a verify list |
| Activity log, diagnostics download, clear | integration: events present for imports, failures, AI, practice, plan; redaction keeps token counts, drops text/prompt/key fields, caps size, survives course deletion; E2E: page filters, export holds counts and titles but no document sentences, email, password or key, and is refused without a session |
| Extension run summaries | E2E: scan counts and structure diagnostics, per-failure reasons, caption results reach the log; no titles or page text from the extension; unknown event names and missing tokens refused |
| NaviGator preset | E2E: choosing it fills UF's endpoint and example model from the quickstart, never the key |

**Not tested against reality:** the topic and objective logic was built from the Module 21 page you
screenshotted, but only the text visible in those screenshots; the real page may differ. The old
sources already in your account keep the topics they got; delete them and re-import to see the new behaviour.

## Added in the third round

| Item | Evidence |
| --- | --- |
| **Docker, for the first time** | The sandbox could run a Docker daemon, so the real `worker/Dockerfile`, `web/Dockerfile` and `docker-compose.yml` were built and started (x86_64): database, worker and web all healthy; the web container runs as user `node`; the sample course was imported by the containerised worker, a duplicate upload recognised and a practice answer graded; after `down` and `up` the account, course and 8 sources were still there. Idle memory: web 143 MB, worker 82 MB, database 35 MB. Builds ran with test-only base images that trust the sandbox proxy; nothing in the repo changed for that. |
| A bug only the image build could show | After dev dependencies are pruned, `next start` tried to install TypeScript to read `next.config.ts` and never became healthy. Fixed by `next.config.mjs`. |
| Mediasite transcripts | Unit: WebVTT, SRT, timed-text XML (entities decoded) and plain text accepted; JSON and a login page refused; each skip reason reported. E2E against a mock Mediasite player embedded from another site: exactly one `GetPlayerOptions` POST naming the presentation with the player's header, one transcript download, first transcript only, preview before import, cited by lecture timestamp in Klierly; timed-text XML converted; a lecture with no transcript explains that plainly. The mock is my reconstruction from the snippet, **not real Mediasite**. |
| Every network call site in the extension is pinned | A test fixes the number of `fetch(` calls per file (api 1, Canvas adapter 1, captions 2). |
| Google AI Studio and NaviGator presets | E2E: each fills its own address (and NaviGator's example model), replaces the other's, never touches the key, and Google's free-versus-paid warning is on the page. |

## CI results for this round (pull request #1)

All jobs passed on a clean runner for the commit that added Mediasite, Docker and the Oracle guide: worker, extension, web (types, lint, audit, integration, end-to-end), no-secrets, **Docker build and start (x86_64)**, and, when started by hand, **Docker build and start on linux/arm64 (emulated)**. The same commit's pull-request run failed once and passed once on identical code: that was the hydration issue below.

## Open defect found by CI: intermittent React hydration error

CI caught the previously unexplained one-in-many failure: `Minified React error #418` on the Materials page of the production build. It is real (reproducible at roughly one load in sixty with the script in `web/scripts/repro-hydration.mjs`), the page recovers and renders identically, and **its cause is not found.** Ruled out by measurement: the polling refresh, streamed metadata, late-streamed content. Details, numbers and how the test suite now treats it are in `docs/KNOWN_ISSUES.md`. A run that prints `KNOWN ISSUE` is passed-with-a-defect, not clean.

## Not verified — read this before relying on anything

1. **Real Canvas (UF or any).** Discovery, file download and caption reading have only met a
   synthetic mock that I wrote from my understanding of Canvas pages. The founder's first real run
   used the *old* single-page capture and already exposed two defects (now fixed). Expect the
   Canvas adapter to need adjustment on first contact: Modules page structure, download redirects
   to a separate file host, and which video platform the course uses.
2. **Permission prompts.** Automation cannot click Chrome's permission dialogs, so tests run a
   temporary copy of the extension with site access pre-granted. The real "Allow for this site"
   click, and whether access persists across the tab navigations discovery performs, are unverified.
3. **Real AI.** No provider is configured and no real model has been called. Managed AI, question
   generation, topic suggestions and blueprint filling were exercised against a deterministic mock.
   Question *quality* on real statistics material is unknown; the checks guarantee structure,
   sources and arithmetic only.
4. **Institutional permission** to use the extension on a university course site: not checked with UF.
5. **Real Oracle hardware.** Docker is verified on x86_64, and the images build and start on linux/arm64 *under emulation* in GitHub Actions (passed 2026-11-14). That is not Oracle's machine. The server scripts and the public HTTPS overlay were never run on one.
6. **Video platforms.** Only standard HTML text tracks and visible transcript panels are read.
   Whether QMB 3250's player exposes either is unknown.
7. Edge and Firefox untested. No screen-reader or load testing.
