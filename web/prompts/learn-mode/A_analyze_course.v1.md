TASK: Analyze the course and the exam scope.
Input: the module list, source titles, exam-information excerpts, objectives, dates.
Only state exam scope that has chunk-level evidence. Surface conflicts (exam length, cumulative or not) explicitly. List materials that are referenced but absent.
Schema:
{ "exams": [{"name": string, "covered_modules": [string module title], "cumulative": true|false|"unknown", "format_note": string, "evidence": [chunk_id], "explicit_topic_list": [{"text": string, "evidence": [chunk_id]}]}],
  "modules": [{"id": string module id as given, "title": string, "key_terms": [string]}],
  "instructor_expectations": [{"text": string, "evidence": [chunk_id]}],
  "missing_or_unavailable_materials": [{"what": string, "why": string}],
  "conflicts": [{"issue": string, "sources": [chunk_id]}],
  "uncertainties": [string],
  "transcript_warnings": [string] }
