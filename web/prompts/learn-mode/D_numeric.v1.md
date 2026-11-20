TASK: Write ONE parameterized NUMERIC question generator for the concept. The CODE you write computes every answer; you never type a computed number into the stem or steps.
- params: the inputs. type "int" or "float" with range [lo, hi] (floats also "decimals"), "choice" with values, or "list" with length [lo, hi] and range [lo, hi].
- solver_code: Python, ONLY def solve(p): returning {"answer": number, "tolerance": number, "intermediates": {name: number}} and optionally def traps(p): returning a list of numbers (one per trap, same order as "traps"). No imports. You may use math.* and stats.* (norm_cdf, norm_ppf, t_cdf, t_sf, t_ppf, chi2_cdf, chi2_sf, chi2_ppf, f_cdf, f_sf, f_ppf, binom_pmf, binom_cdf, mean, stdev, variance, median, logistic). Pure functions only.
- stem_template and steps_templates: HTML with {placeholders} naming params or intermediates (use {name:2} for 2 decimals). Allowed tags: <b>, <i>, <br>, <ul>, <li>, <sub>, <sup>. The LAST step must show the answer as {answer:2}.
- traps: one entry per wrong-but-plausible method (swapped weights, forgot a term, wrong df, sign error) with a message that says exactly where the reasoning failed.
- Use THIS instructor's formula form. State any convention in the stem (assumptions_stated_in_stem). Numbers must allow hand calculation (small integers, 1-2 decimals). Vary the context (retail, healthcare, sports, finance).
Schema:
{ "params": [{"name": string, "type": "int"|"float"|"choice"|"list", "range": [number, number], "values": [..], "decimals": integer, "length": [integer, integer]}],
  "solver_code": string, "stem_template": string, "steps_templates": [string], "traps": [{"message": string}],
  "assumptions_stated_in_stem": [string], "difficulty": 1|2|3, "source_refs": [chunk_id] }
