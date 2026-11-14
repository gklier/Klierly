# Roadmap

## Works now (Phase 1 and 1b)

Accounts (first-user / invite code) · courses · upload of PDF, DOCX, PPTX, TXT, Markdown, HTML, CSV,
XLSX, SRT, VTT · paste · duplicate handling, retries, per-file errors · source viewer with page /
slide / timestamp · search · suggestions for modules, topics, objectives, dates and exam scope ·
manual module/topic mapping · coverage warnings · OpenAI-compatible AI connection with test button,
encrypted key, usage counts, daily limit, cache · validated question generation · study notes ·
Learn / Drill / Timed mock exam / Review mistakes · hints · calculator and scratchpad · mistake
tagging · bad-question reports · mastery, spaced review, readiness heuristic · study plan with
regeneration · deletion of source / course / account · light/dark, phone layout · synthetic sample
course · MV3 extension with preview, declaration, assessment/grades blocking.

## Deliberately not built (hidden, no dead buttons)

| Item | Note |
| --- | --- |
| Official Canvas OAuth + incremental sync | Needs an institution-issued developer key. Interface: an LMS adapter producing the same `createSource()` inputs. No "Connect Canvas" button exists |
| Other LMS integrations | Same adapter shape |
| OCR for scanned PDFs | Currently rejected with a clear message |
| Embeddings / pgvector | Slot behind `searchChunks()` |
| AI topic proposals | Topics today come from headings; an AI pass could propose better ones, still reviewed by the student |
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
6. **Framework**: move from Next.js 15 to 16.

## Launch risks (rough)

- **Rights to course material** are the largest risk: instructors and publishers may object even to
  private use with an outside AI. Mitigations in place: private by default, per-import declaration,
  per-course AI switch, no sharing. Not a legal shield.
- **Academic-integrity perception**: the assessment guard is heuristic; a determined user can paste
  anything. The product should keep refusing to position itself near graded work.
- **AI cost and quality** vary by provider; the app cannot see prices.
- **Heuristic suggestions** depend on how tidy the source documents are.
