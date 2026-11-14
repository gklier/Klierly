# Audit of the existing implementation (start of Phase 2)

Done on 2026-11-14 against branch `courselab-initial` before any new feature, by running the app
and every test suite. "Verified" means a test or a manual run in this environment exercised it.

## What works end to end (verified)

| Area | Evidence at audit time |
| --- | --- |
| Accounts, sessions, invite-only registration | E2E journey 1–2, 15 |
| Upload (PDF, DOCX, PPTX, TXT, MD, HTML, CSV, XLSX, SRT, VTT), paste, duplicates, failures | worker tests (25), integration "ingestion", E2E 3, 5 |
| Chunking with page / slide / timestamp provenance; search; citation viewer | integration, E2E 6, 10 |
| Practice (drill, timed exam, review), grading, mastery, spaced review, progress | unit + integration + E2E 10–12 |
| Study plan | unit (6 cases), integration, E2E 9 |
| Deletion of source / course / account, including files | integration "deletion", E2E 15 |
| Extension single-page capture, assessment and grades blocking | extension unit + E2E (7) |

## AI: what needs a connection, what does not

| Needs AI | Works with no AI at all |
| --- | --- |
| Generating new questions | Import, extraction, search, source viewer |
| Generating study notes | Suggestions from headings/syllabus, module and topic management |
| (new) Suggesting topics with AI, filling a blueprint | Study plan, all practice modes on existing questions, grading, numeric checking |
| | Progress, readiness, deletion, the sample course |

At audit time AI required each student to enter their own key (BYOK). There was no managed provider.

## How the extension read content (at audit time)

One page per click: `activeTab` + `scripting`, an extractor that walks visible DOM text of the
current tab, a guard that blocks assessments/grades, preview, declaration, then one POST to the
student's server. It did not read frames, did not follow links, and flattened page structure to
plain text.

## Are imports processed and cited correctly?

Yes for the tested formats: every sample citation is asserted to resolve to the chunk containing
its quote; deleted sources show as unavailable rather than guessed. **Weakness found by the first
real-course use (QMB 3250, reported by the founder):** topics were derived from raw headings, so
file links and worked-example steps became topics, and web captures lost headings and list
structure. Both are addressed in Phase 2 (see TEST_REPORT).

## Authentication and data separation

Verified: scrypt password hashes; HttpOnly SameSite=Lax session cookie; Origin check on cookie-
authenticated mutations; every query scoped by `user_id`; another user gets 404 on pages, files
and APIs (E2E 13, integration "data isolation"); pairing tokens hashed, revocable and limited to
`/api/ext/*`; AI keys encrypted at rest and never returned to the browser.

Gaps (not fixed in this phase, listed in ROADMAP): no email verification or password reset; no
change-password flow; no Content-Security-Policy with nonces; rate limiting and the job runner are
in-process (single instance); AI endpoint check does not defend against DNS rebinding.

## Docker and local development

Local development: works (this is how everything was run). **Docker: never built or started** —
no Docker daemon is available in the build environment; compose files are syntax-checked only.

## Incomplete or untested at audit time

- No managed AI; no real model ever called (mock only).
- Extension tested on synthetic pages only; no course-wide import; no video captions.
- No CI.
- Real Canvas, real UF pages, Edge, Firefox: untested.
