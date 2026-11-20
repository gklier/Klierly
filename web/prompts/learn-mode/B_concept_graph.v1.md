TASK: Build the concept graph for the modules provided.
Produce 6-20 concepts, in teaching order. Merge tiny topics, split overloaded ones. Prerequisites must only refer to EARLIER concepts by id (the graph must be acyclic). Add one concept titled "Which method should I use?" when the material covers choosing among methods or tests.
Capture instructor-specific rules (which formula form, which table, which decision rule) with evidence chunk ids: generic tutors get these wrong.
Schema:
{ "concepts": [{ "id": string (short slug, unique), "title": string, "module_id": string (as given), "prerequisites": [concept id],
  "exam_relevance": {"level": "explicit"|"likely"|"background", "evidence": [chunk_id]},
  "formulas": [{"name": string, "text": string (plain text, no LaTeX), "instructor_form_note": string}],
  "instructor_specific_rules": [{"rule": string, "evidence": [chunk_id]}],
  "common_mistakes": [string], "decision_cues": [string], "estimated_minutes": integer, "source_refs": [chunk_id] }] }
