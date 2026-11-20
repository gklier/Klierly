# Learn Mode: report

## What exists and works (run, with evidence)
- **Module checklist → one button → full guide → Start.** Pre-selection from exam pages with the reason shown ("Why: “Exam 3 information” says Exam 3 covers Modules 17-18"); nothing pre-selected when scope is unclear. Selecting two of three modules produced zero rows for the third (asserted). Adding a module later builds only that module (asserted).
- **Pipeline stages A, B, C, D, E** with versioned prompts, zod validation, one retry with the validator's message, hash-cached through the existing AI cache. Re-running with unchanged input made **zero new AI calls** and no new rows (asserted).
- **Numbers come from code.** AI-written solvers run in a worker sandbox; every numeric generator is validated over 50+ seeds against an independent solver; bad generators are rejected (tests cover: disagreeing solver, trap equal to answer, undefined placeholder, repeated stems, absurd values, missing independent solver, sandbox-refused code).
- **Guided flow** in the browser: lesson cards → worked example one step at a time → three guided rounds with fading scaffolding → practice → "practiced"; mastery needs ≥4 unaided of the last 5; revisit every 3rd question; misses re-queue after ≥3; hint ladder never reveals the answer; trap-specific feedback for numeric misses; every option explained for multiple choice; reload and "come back later" resume the same question and hint level; one-tap "Report a problem" retires the question without interrupting.
- **Dedupe:** 400 consecutive picks for one concept: 0 repeated stems, no AI call (asserted).
- **Stale screens:** every action carries a token for the screen it was made on; a double-click on Next, a second tab or a late submit is ignored or refused instead of being applied to whichever question is current (asserted).
- **Isolation:** another account sees nothing and cannot answer or advance (asserted); the guide page redirects an unauthenticated browser to sign-in.
- **No vetting UI:** the E2E asserts no generate/approve/accept/edit buttons on the study screens.

## Test results (this branch)
| Suite | Result |
|---|---|
| Worker (pytest) | 43 passed (17 new: sandbox escapes, runaway loops, memory bombs, NaN, limits, scipy agreement) |
| Web integration and unit (vitest, real Postgres + worker, mock AI) | 138 passed (37 new: engine 10, pipeline 16, study service 11) |
| Browser (Playwright, production build) | 53 passed (9 new Learn Mode tests with screenshots in `docs/learn-mode/screenshots/`), zero console errors |
| Extension | 17 passed |
| Types, lint, `npm audit` | clean |

Bugs found and fixed while testing: a trap that coincided with the right answer made whole generators fail (now dropped per instance); duplicated stems across concepts produced empty generators (now rejected up front); a blocking sandbox endpoint could stall file parsing (now runs in a thread); the build hit the per-minute AI limit (now waits instead of failing); the captions button could be clicked before its page was ready (fixed in the extension) and a flaky discovery test waited for the wrong thing.

## What is NOT built (be clear before relying on this)
- **Tutor drawer** (Prompt G is written, not wired), **exam simulation mode**, **concept map**, **formula sheet screen**, **session timer chips**, **visual labs** (and Prompt F), **add-on picker** and every add-on (flashcards, daily plan, extra packs, listen mode, practice exams), **mistake diagnosis** (Prompt H), **video lessons** (Prompts I and J, Manim). None of these exist in the UI.
- **The three build-time skills** (security, React performance, design) and the Manim skill were **not installed, vetted or used**, and no `skills-vetting` documents were written. So there is no skill-driven security report: my security work is my own review plus tests, and the React performance budgets (200 KB, LCP, interaction latency) and an accessibility audit were **not measured**.
- **Not deployed.** I cannot reach the VM (10.10.23.3) from here and did not touch production. Nothing here was smoke-tested on the live URL.
- **Never run against a real AI model.** All AI stages were tested with a deterministic mock that exercises the validators. How good real generated lessons, solvers and questions are is **unknown**. The mock cannot show whether a real model resists prompt injection; the tests prove the course text is delimited, neutralised and sent as data, not that a particular model obeys.
- The two real Canvas/Mediasite items from earlier (live verification) are still open.

## Known limitations and things you need to decide
1. **Cost and quotas.** At default targets a 15-concept guide is roughly 250 AI calls (per concept: a lesson, up to 6 numeric generators with an independent solver each, plus conceptual questions with a blind answerer and a critic). The managed defaults (40 requests a day, 400k tokens a month per student) will stop a build part-way with a clear message. Raise `MANAGED_AI_USER_DAILY_REQUESTS` and the token limit, lower the `LEARN_*` targets, or use the student's own key. I did not run real inference, so I cannot give a real cost.
2. **Sandbox is a strong filter, not a perfect boundary.** Run the worker in a container without outbound network access.
3. **Mastery rule** is stricter than the prototype (see findings).
4. **Which-method scenarios** are generated only for a concept whose title names choosing a method; if the course has none, there are no matching questions.
5. **The `learn` pages poll with `router.refresh()` only while a build runs.** The hydration error documented in `docs/KNOWN_ISSUES.md` was not seen on the new pages, but it remains unexplained elsewhere.
6. **Prerequisite graph** is acyclic by construction (a prerequisite must be an earlier concept); forward references from the model are dropped.

## Deployment and rollback (not executed)
Migration `0005_learn_mode.sql` only creates eight `lm_*` tables. To deploy: pull the branch, `docker compose up -d --build` (the worker image includes the new endpoint). **Rollback:** deploy the previous image; the new tables are unused and harmless, or drop them (`drop table lm_reports, lm_answers, lm_progress, lm_concept_state, lm_items, lm_generators, lm_concepts, lm_builds;`). Existing flows do not read them.
