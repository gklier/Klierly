# Architecture

```
Browser ──HTTPS──▶ web (Next.js, Node)  ──SQL──▶ PostgreSQL (rows + full-text index)
   ▲                 │   │
   │                 │   └─HTTP + shared token─▶ worker (FastAPI, Python; stateless)
extension ─Bearer────┘                            parsing · numerical checks
(pairing token, /api/ext/* only)
                     └─HTTPS (only on "Generate")─▶ user-chosen OpenAI-compatible AI provider
```

Only `web` is reachable by users. `worker` and PostgreSQL sit on an internal network. Contracts
between the parts are in `docs/CONTRACTS.md`.

## Data model (`web/src/db/schema.ts`, migrations in `web/drizzle/`)

User, Session, ExtensionToken · Course, Module · SourceDocument, SourceChunk (page / slide /
timestamps / heading / character offsets, generated `tsvector`), ImportJob · Proposal (suggestions
awaiting review), Topic, LearningObjective, CourseDate · ExamPlan, PlanSession · Question,
QuestionReport, PracticeSession, Answer, TopicMastery, LearnNote · ProviderSettings, AiUsage, AiCache.
Every table carries `user_id`; every delete cascades from user or course.

## Ingestion pipeline (one path for upload, paste and extension)

`createSource()` → check ownership, extension, size, emptiness → SHA-256 duplicate check per course →
store original under `UPLOAD_DIR/<user>/<document><ext>` (server-chosen name, mode 0600) →
`ImportJob` queued → in-process runner claims it (`FOR UPDATE SKIP LOCKED`, retries with backoff for
transient failures, none for permanent ones, stale jobs reclaimed) → worker `/parse` or `/parse-text`
(type verified by extension *and* content sniffing; zip-bomb limits; HTML reduced to visible text;
no OCR) → chunking (~1,000 chars, provenance kept) → chunks + index written in one transaction →
deterministic suggestions (modules, topics, objectives, dated exams/deadlines, exam scope) stored as
proposals with the chunk they came from. Nothing is applied until the student accepts it.
Job logs hold status lines only — never document text.

## Retrieval

PostgreSQL full-text search (`ts_rank_cd`, headings weighted above body), always filtered by user
and course, optionally by module. No embeddings are required; pgvector can be added behind
`searchChunks()` without touching callers.

## Question generation and validation (`web/src/lib/ai/`)

Per topic: retrieve ≤ 6 excerpts (≤ 1,400 chars each) → prompt with excerpts wrapped in `<source>`
blocks labelled S1…Sn → JSON response → each draft must pass:

1. **Schema** (zod): type, stem, 4 choices or numeric answer, explanation.
2. **Citations**: must reference a provided S-label (unknown labels are dropped; zero valid → reject).
   The quote must occur in that chunk; otherwise the link is kept but marked unverified and the
   question is labelled as going beyond the materials.
3. **Single answer**: 4 distinct choices, no "all/none/both of the above", no two numeric choices equal.
4. **Numbers**: numeric questions must name a whitelisted calculation (`check.fn` + args). The worker
   recomputes it; a mismatch rejects the draft, and the stored answer is the computed one.
5. **Duplicates**: token-set similarity against the course's bank.

Rejected drafts are reported back to the model for one retry within the user's daily limit.
Stored per question: `correctness_confidence` (verified-numeric / author-reviewed / model-asserted),
`explanation_confidence`, `grounding`, origin. Students can report a question; it leaves the pool at once.

**Prompt-injection stance**: course text is untrusted data. Delimiter/role look-alikes are stripped
before prompting, the system prompt says to treat sources as data, and — the part that does not rely
on the model behaving — output is only ever parsed as data, validated as above, rendered as text,
and can trigger nothing except a whitelisted arithmetic function.

## Practice, mastery, plan

- Server sends questions without answers, hints or explanations. Drill/review grade on submit of each
  answer (first answer final). Timed exams store answers ungraded and reveal nothing until submission
  or time-out (enforced server-side).
- Mastery per topic: exponentially weighted score + expanding review interval (2→4→8… days, back to 1
  on a miss). Drill sampling favours weak and due topics and reserves every 4th slot for mastered ones.
- Study plan (`lib/plan/schedule.ts`, pure function): first pass over ~65% of the days, spaced
  retrieval at +2/+5/+9/+14 days grouped into mixed sessions, mock exam two days out, light wrap-up.
  Never exceeds daily minutes; what does not fit is cut and reported. Topics without material are
  excluded with a warning. Regenerating keeps completed sessions and reschedules missed ones.
- Readiness = mean topic mastery, discounted below 5 answers. Shown as a heuristic everywhere.

## Permission boundaries

| Actor | Can | Cannot |
| --- | --- | --- |
| Signed-in user (session cookie: HttpOnly, SameSite=Lax; Origin check on mutations) | Everything on own rows | Read or change another user's rows (all queries scoped by `user_id`; other users get 404) |
| Extension pairing token (hashed at rest, revocable) | `GET /api/ext/courses`, `POST /api/ext/import` | Anything else; it is not a session |
| Worker | Parse bytes it is handed; compute | Database, files, network egress needs none |
| AI provider | See excerpts sent on Generate | Anything else; per-course switch disables it |

Other controls: scrypt password hashes, AES-256-GCM for API keys (key derived from `APP_SECRET`),
rate limits on sign-in, imports and AI calls, AI endpoint validation (https; private addresses only
if enabled — DNS rebinding is not defended, see ROADMAP), originals served only as attachments,
log redaction, security headers.

## Phase 2 additions

- **Managed AI** (`lib/ai/provider.ts`): `aiStatus()` resolves BYOK → managed → none and returns a
  credential-free status for the UI; `chatJson()` enforces per-student and global quotas, a burst
  limit, caching and tiering (routine model first, stronger model only for validation retries), and
  records provider, tier, tokens and estimated cost in `ai_usage`. Operator view at `/admin`.
  Credentials exist only in the server environment. See `docs/MANAGED_AI.md`.
- **Course discovery** (`extension/src/lms/`, `discover.js`): LMS adapters read rendered pages in
  the student's tab (no LMS API). The server stores `external_id` per source; `createSource()`
  returns `created | unchanged | updated`, replaces a changed resource, and files sources under
  modules by name. Endpoints: `GET /api/ext/courses/:id/sources`, `POST /api/ext/import-file`.
  Access model and open questions: `docs/LMS_ACCESS.md`.
- **Structure-preserving capture**: page captures arrive as light Markdown (headings, list items),
  so objectives and sections survive. **Topics**: stricter heading filter plus `proposeTopics()`
  (one AI request; suggestions must cite a provided excerpt and be findable in the material; always
  reviewed by the student).
- **Captions** (`extension/src/captions.js`): text tracks and transcript panels → WebVTT → the
  normal upload path, keeping timestamps for citations.
- **Blueprint** (`lib/practice/blueprint.ts`): questions per topic in proportion to material volume
  (square-root damped), gap analysis against the bank, `pickByQuota()` for the mock exam, and
  targeted follow-up from results (drill weak topics, generate fresh questions on them).
- **CI** (`.github/workflows/ci.yml`): worker tests, extension tests and packaging, web type check,
  lint, audit, integration and E2E with Postgres, plus a check that no secrets or uploads are tracked.

- **Objectives as topics, exam formats, supplements, activity log** (round two): `proposals.ts` turns
  stated objectives into topic proposals (`topicFromObjective`), merges near-duplicates (`sameTopic`) and
  parses exam structure from syllabus lines (`parseExamFormat`, matched by `examKeyOf`) into `exam_formats`,
  which the plan form offers alongside exam dates. `learn_supplements` holds labelled AI gap-filling apart
  from `learn_notes`. `activity_log` (`lib/activity.ts`) records events, counts and titles through the same
  redaction as server logs; the extension reports run summaries via `POST /api/ext/log` (fixed event names,
  size-limited, redacted). Viewed and exported at `/activity` and `/api/activity/export`.

## Deployment options

- **Local** (default): processes or `docker compose up`; web bound to 127.0.0.1.
- **Single small server** (e.g. an Oracle Cloud Always Free Arm instance, if available in your
  region — check current limits at Oracle's Always Free page; nothing here assumes a size):
  `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d` adds Caddy with automatic
  HTTPS and publishes only 80/443. Images use multi-arch bases and pure-wheel dependencies.
- **Persistence/backups**: volumes `db-data` and `uploads`; `deploy/backup.sh` dumps both.
- The job runner and rate limiter are in-process: run one web instance. Scaling out needs a shared
  limiter and is listed in the roadmap.

Nothing has been deployed, purchased or registered.
