# Learn Mode prompt library

Versioned prompts for the study-guide pipeline. File name = `<stage>.v<N>.md`. The loader (`src/lib/learn/prompts.ts`)
prepends `_preamble.vN.md` to every pipeline prompt and records `<stage>.v<N>` as the prompt version on every row it
produces. Change a prompt by adding a new version file and bumping the version in the loader; old rows keep their version.

| Stage | File | Output |
|---|---|---|
| A | `A_analyze_course` | exam scope with evidence, conflicts, missing materials, uncertainties |
| B | `B_concept_graph` | ordered concepts, prerequisites (acyclic, checked in code), formulas, instructor rules |
| C | `C_lesson` | four lesson cards, why-it-matters, one-line recap, alternative explanation |
| D | `D_numeric`, `D_mcq`, `D_scenario` | parameterized numeric generators (code computes answers); conceptual MCQs; method-matching scenarios |
| E | `E1_independent_solver`, `E2_independent_mcq`, `E3_quality_critic` | blind re-solve, blind re-answer, quality gate |
| G | `G_tutor` | runtime tutor system prompt |

Not built yet: F (lab selector), H (mistake diagnosis), I and J (video storyboard and narration).

Rules for every call: course text only inside `<course_material>` as `<chunk id="...">` blocks and declared to be data;
JSON output validated with zod; one retry with the validator's message, then the stage fails visibly; results cached by
SHA-256 of (prompt version, model, input) through the existing AI cache, so unchanged input makes no new AI call.
