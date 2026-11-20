# Learn Mode: architecture

```
Import (existing) ──► modules + source_chunks
                          │
 module checklist ──► "Build my study guide" ──► lm_builds row ──► background runBuild()
                                                     │
   A analyze (exam scope, conflicts, gaps)  ─────────┤ cached by hash through ai_cache
   B concept graph per module (acyclic by construction)
   C lesson per concept (4 cards, sanitised HTML)
   D numeric generators  ──► worker sandbox ──► 60 seeds ──► E1 independent solver ──► code compares ──► lm_items
   D mcq / scenario      ──► E2 blind answer + E3 critic (batched) ──► lm_items
   publish: concept status "ready" only with a lesson and validated questions
                          │
 STUDY FOR MY EXAM ──► lm_progress.cursor (server-side) ──► learn → worked → guided (3 rounds) → practice → done
```

## Data model (migration `0005_learn_mode`, additive only)
| Table | Purpose |
|---|---|
| `lm_builds` | one build per click: modules, stage, progress, `analysis` (Prompt A output), error |
| `lm_concepts` | concept, prerequisites (earlier concepts only), lesson cards, formulas, instructor rules, source chunk ids, prompt version, model, input hash |
| `lm_generators` | numeric (spec + solver code + hash + validation report), mcq, scenario |
| `lm_items` | a concrete validated question; key `generatorId:seed` regenerates it; `UNIQUE(course, stem_hash)`; `retired` after a report |
| `lm_concept_state`, `lm_progress`, `lm_answers`, `lm_reports` | per student: status and recent scores, cursor and miss queue, answer history, one-tap reports |

Mapping to the names in the task: `concept`, `question_generator`, `question_instance`, `user_concept_state`, `user_answer`, `user_miss_queue` (inside `lm_progress.miss`), `course_analysis` (inside `lm_builds.analysis`). `worked_example` is the first numeric item of a concept at a fixed seed. `video_lesson`, `exam_attempt` and `tutor_message` are **not created** (features not built).

## Validation of numeric generators (`web/src/lib/learn/validate.ts`)
Over `LEARN_VALIDATION_SEEDS` (default 60) seeds: (a) runs, finite; (b) the last step shows `{answer}`; (c) traps never equal the answer (dropped per instance; the generator fails if more than 10% of seeds are affected); (d) an independent solver agrees on **every** seed; (e) at least 50 unique stems; (f) sane magnitudes, non-degenerate. A generator that fails is not stored. The pipeline asks again (up to `LEARN_GENERATOR_ATTEMPTS` per slot) and tells the model what it already wrote.

## Question supply
Numeric questions are pre-built from validated seeds and **topped up with more seeds automatically, with no AI call**, when the unseen pool runs low. Conceptual and matching questions are fixed at build time. Wording the student has already seen is never served again.

## Security notes
Course text is placed inside `<course_material>` / `<chunk>` blocks with delimiter look-alikes neutralised, and the system prompt says it is data. All AI-written HTML is sanitised to `b i br ul li sub sup` without attributes **when stored**. AI-written solver code runs only in the worker sandbox. Every Learn Mode read and write is scoped by the signed-in user id.

## Adding a subject or course
Nothing is course-specific. Import the course, make sure material sits in modules, and press **Build my study guide**. To tune a subject: add a new prompt version (e.g. `D_numeric.v2.md`), bump `PROMPT_VERSIONS` in `web/src/lib/learn/prompts.ts`, and add allowlisted helper functions to `worker/app/sandbox.py` (`Stats`) if the subject needs them (with a test against scipy).

## Configuration
`LEARN_NUMERIC_GENERATORS` (6), `LEARN_MCQ_ITEMS` (8), `LEARN_SCENARIOS` (15), `LEARN_GENERATOR_ATTEMPTS` (2), `LEARN_VALIDATION_SEEDS` (60), `AI_BURST_PER_MINUTE` (40). Tests lower the first four.
