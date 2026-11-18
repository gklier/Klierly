# Roadmap

## Works now

Phase 1: accounts · courses · upload/paste of ten formats · source viewer with page/slide/timestamp ·
search · reviewable suggestions · study plan · Learn / Drill / Timed exam / Review · validated
question generation · mastery, spaced review, readiness heuristic · deletion · sample course ·
single-page capture extension.

Phase 2: **managed AI** with quotas, cost accounting and operator page (mock-tested; not configured)
· **course discovery** for Canvas-style sites with selection, preview, progress, stop/resume and
sync · **lecture captions** · structure-preserving capture · **AI topic suggestions** · **exam
blueprint**, blueprint-weighted mock exam, targeted follow-up · **CI**.

Phase 2, fourth round: **class library** (share AI summaries with classmates, class membership claimed
through the extension, reports, operator moderation and per-class switch) · caption clean-up for
automatic transcripts (JMP/"jump" search, spaced hyphens and decimals).

## Decisions waiting on the founder

- **Sharing materials between students (crowdsourcing).** Not built. It reverses the original rule against shared repositories of course material, and the main risk is copyright and university policy, not code. See `docs/DECISIONS.md` for the reasoning and the narrow version that would be safe to build.
- **Past exams for structure.** Not built; a structure-only version (count, types, topic spread; never shown, shared or used to write questions) is proposed in `docs/DECISIONS.md`.

## Next, in order

1. **Real-course shakedown (QMB 3250 at UF)**: run discovery and captions on the real site; adjust
   Canvas selectors, file-download handling and caption reading to what is actually there.
2. **Configure a managed AI provider** (founder decision) and evaluate question quality on real material.
3. Mediasite is built from the founder's snippet but untested on a real lecture; next is making lecture videos part of a course-wide run (a permission prompt needs a click, so it needs a deliberate step), and fixing the format once the real transcript is seen.
4. Official Canvas OAuth with an institution-issued developer key, replacing page reading where a university approves it.

## Deliberately not built (hidden, no dead buttons)

| Item | Note |
| --- | --- |
| Official Canvas OAuth | Needs an institution-issued developer key. No "Connect Canvas" button exists |
| Other LMS platforms | Adapter interface exists (`extension/src/lms/`); only Canvas is written |
| OCR for scanned PDFs | Currently rejected with a clear message |
| Embeddings / pgvector | Slot behind `searchChunks()` |
| Diagram and audio presentation modes, mini games, video | Not started; plan form offers only the two modes that exist |
| Collaboration, instructor features, mobile apps, billing | Not started |
| Email (verification, password reset) | Not started — a forgotten password currently needs the operator |
| Data export | Originals can be downloaded; no bulk export yet |

No feature flags are needed yet: unfinished features have no code paths or UI.

## Before a public beta

1. **Legal**: lawyer review of privacy policy and terms; copyright/DMCA process; FERPA position if any
   institution is involved; age and consent wording.
2. **Policies to re-read at that time** (not verified here beyond designing to their intent):
   Chrome Web Store Limited Use and permission justification, Instructure API policy, each
   university's AI and LMS rules (UF's included), NaviGator terms.
3. **Security**: independent review; CSP with nonces; DNS-pinning for AI endpoints (SSRF via DNS
   rebinding); account lockout and email flows; upload malware scanning; secrets rotation plan.
4. **Operations**: error tracking, uptime checks, tested restore from backup, shared rate limiter and
   external job queue if more than one web instance, log retention policy.
5. **Product quality**: evaluate generated questions with a real model on real courses — the checks
   guarantee structure, sources and arithmetic, not pedagogy; conceptual MCQ keys remain
   "not independently verified" and are labelled so.
6. **Framework**: move from Next.js 15 to 16, and re-test the intermittent hydration error in `docs/KNOWN_ISSUES.md` there.

## Launch risks (rough)

- **Rights to course material** are the largest risk: instructors and publishers may object even to
  private use with an outside AI. Mitigations in place: private by default, per-import declaration,
  per-course AI switch, no sharing. Not a legal shield.
- **Academic-integrity perception**: the assessment guard is heuristic; a determined user can paste
  anything. The product should keep refusing to position itself near graded work.
- **AI cost and quality** vary by provider; the app cannot see prices.
- **Heuristic suggestions** depend on how tidy the source documents are.
