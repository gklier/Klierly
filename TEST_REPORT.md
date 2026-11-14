# Test report (Phase 2)

Run on 2026-11-14 in a Linux x86_64 container: Node 22, Python 3.13, PostgreSQL 16, Chromium
(Playwright 1.63). Everything in the tables was executed. What could not be run is under
**Not verified**, and that section matters more than the green numbers.

## Results

| Command | Result |
| --- | --- |
| `cd worker && python -m pytest -q` | **25 passed** |
| `cd web && npm run typecheck` / `npm run lint` | clean / clean |
| `cd web && npm test` (real PostgreSQL + real worker + mock AI) | **88 passed** |
| `cd web && npm run test:e2e` (production build; Chromium with the extension loaded) | **34 passed**: 19 journey, 7 single-page capture, 8 course discovery, captions and extension logging |
| `cd extension && npm test` | **14 passed** |
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
| Exam format from the syllabus | unit: question counts, types, minutes, points, matching to Exam 1 / Final, implausible numbers rejected; integration: two formats stored with their evidence; E2E: the plan form is prefilled with 27 questions / 75 minutes and the blueprint uses them |
| AI "what your notes leave out" | integration: stored apart from notes, never feeds questions, refused without material or when the course disallows AI; E2E: shown in a dashed box labelled not from the course, no links, with a verify list |
| Activity log, diagnostics download, clear | integration: events present for imports, failures, AI, practice, plan; redaction keeps token counts, drops text/prompt/key fields, caps size, survives course deletion; E2E: page filters, export holds counts and titles but no document sentences, email, password or key, and is refused without a session |
| Extension run summaries | E2E: scan counts and structure diagnostics, per-failure reasons, caption results reach the log; no titles or page text from the extension; unknown event names and missing tokens refused |
| NaviGator preset | E2E: choosing it fills UF's endpoint and example model from the quickstart, never the key |

**Not tested against reality:** the topic and objective logic was built from the Module 21 page you
screenshotted, but only the text visible in those screenshots; the real page may differ. The old
sources already in your account keep the topics they got; delete them and re-import to see the new behaviour.

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
5. **Docker / Oracle ARM64.** No Docker daemon available: images never built or started.
6. **Video platforms.** Only standard HTML text tracks and visible transcript panels are read.
   Whether QMB 3250's player exposes either is unknown.
7. Edge and Firefox untested. No screen-reader or load testing.
