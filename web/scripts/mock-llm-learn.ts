/** Deterministic stand-ins for the Learn Mode prompts. They exercise the pipeline and its validators; they are NOT a quality test of any real model. */
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
const firstChunk = (u: string) => /<chunk id="(c\d+)"/.exec(u)?.[1] ?? null;

// Each generator: a template the "author" writes, plus an independent solver written differently (what E1 would produce).
const GENS = [
  { sig: "period simple moving average", params: [{ name: "v", type: "list", range: [40, 90], length: [9, 12] }, { name: "k", type: "int", range: [3, 4] }],
    code: "def solve(p):\n    w = p['v'][-p['k']:]\n    return {'answer': sum(w) / p['k'], 'tolerance': 0.02, 'intermediates': {'total': sum(w)}}\ndef traps(p):\n    return [sum(p['v'][:p['k']]) / p['k'], sum(p['v']) / len(p['v'])]\n",
    indep: "def solve(p):\n    n = len(p['v'])\n    s = 0\n    for i in range(n - p['k'], n):\n        s = s + p['v'][i]\n    return {'answer': s / p['k']}\n",
    stem: "Weekly orders were: <b>{v}</b>. Use a <b>{k}-period simple moving average</b> to forecast next week.", steps: ["The forecast is the average of the last {k} values.", "Their sum is {total:0}; divided by {k} gives <b>{answer:2}</b>."], traps: ["You averaged the FIRST values; the window is the most recent ones.", "You averaged every value; only the last window counts."] },
  { sig: "smoothing model", params: [{ name: "a", type: "choice", values: [0.2, 0.3, 0.4, 0.6, 0.7, 0.8] }, { name: "y", type: "int", range: [40, 90] }, { name: "f", type: "int", range: [40, 90] }],
    code: "def solve(p):\n    return {'answer': p['a'] * p['y'] + (1 - p['a']) * p['f'], 'tolerance': 0.02, 'intermediates': {'w': 1 - p['a']}}\ndef traps(p):\n    return [(1 - p['a']) * p['y'] + p['a'] * p['f']]\n",
    indep: "def solve(p):\n    new = p['y'] * p['a']\n    old = p['f'] * (1 - p['a'])\n    return {'answer': new + old}\n",
    stem: "A smoothing model uses alpha = <b>{a}</b>. The latest actual was <b>{y}</b> and the forecast was <b>{f}</b>. What is the next forecast?", steps: ["New forecast = alpha x actual + (1 - alpha) x old forecast.", "= {a} x {y} + {w:1} x {f} = <b>{answer:2}</b>."], traps: ["You swapped the weights: alpha multiplies the latest actual."] },
  { sig: "percent change", params: [{ name: "a", type: "int", range: [50, 200] }, { name: "b", type: "int", range: [50, 200] }],
    code: "def solve(p):\n    return {'answer': (p['b'] - p['a']) / p['a'] * 100, 'tolerance': 0.05, 'intermediates': {'d': p['b'] - p['a']}}\ndef traps(p):\n    return [(p['b'] - p['a']) / p['b'] * 100]\n",
    indep: "def solve(p):\n    return {'answer': 100 * (p['b'] / p['a'] - 1)}\n",
    stem: "Sales moved from <b>{a}</b> to <b>{b}</b>. What is the percent change?", steps: ["Change = {b} - {a} = {d:0}.", "Divide by the starting value {a} and multiply by 100: <b>{answer:1}</b>%."], traps: ["You divided by the new value; divide by the starting value."] },
  { sig: "standard deviations", params: [{ name: "x", type: "int", range: [60, 100] }, { name: "m", type: "int", range: [70, 85] }, { name: "s", type: "int", range: [4, 12] }],
    code: "def solve(p):\n    return {'answer': (p['x'] - p['m']) / p['s'], 'tolerance': 0.01, 'intermediates': {'diff': p['x'] - p['m']}}\ndef traps(p):\n    return [(p['m'] - p['x']) / p['s'], p['x'] - p['m']]\n",
    indep: "def solve(p):\n    z = p['x'] - p['m']\n    return {'answer': z / float(p['s'])}\n",
    stem: "A score of <b>{x}</b> comes from a group with mean <b>{m}</b> and standard deviation <b>{s}</b>. How many standard deviations above the mean is it?", steps: ["z = (x - mean) / sd.", "= ({x} - {m}) / {s} = <b>{answer:2}</b>."], traps: ["Sign error: subtract the mean from the score.", "You stopped before dividing by the standard deviation."] },
  { sig: "margin of error", params: [{ name: "n", type: "int", range: [25, 100] }, { name: "s", type: "int", range: [5, 20] }],
    code: "def solve(p):\n    se = p['s'] / math.sqrt(p['n'])\n    return {'answer': stats.t_ppf(0.975, p['n'] - 1) * se, 'tolerance': 0.01, 'intermediates': {'se': se}}\ndef traps(p):\n    return [1.96 * p['s'] / math.sqrt(p['n']), p['s'] / math.sqrt(p['n'])]\n",
    indep: "def solve(p):\n    n = p['n']\n    crit = stats.t_ppf(1 - 0.025, n - 1)\n    return {'answer': crit * (p['s'] / n ** 0.5)}\n",
    stem: "A sample of <b>{n}</b> has standard deviation <b>{s}</b>. Find the 95% margin of error using the t distribution.", steps: ["Standard error = s / sqrt(n) = {se:3}.", "Margin = t critical (df = {n} - 1) x SE = <b>{answer:2}</b>."], traps: ["You used the normal 1.96 instead of the t value.", "You stopped at the standard error."] },
  { sig: "expected value", params: [{ name: "p", type: "choice", values: [0.2, 0.3, 0.4, 0.6] }, { name: "w", type: "int", range: [100, 400] }, { name: "l", type: "int", range: [20, 90] }],
    code: "def solve(p):\n    return {'answer': p['p'] * p['w'] - (1 - p['p']) * p['l'], 'tolerance': 0.02, 'intermediates': {'q': 1 - p['p']}}\ndef traps(p):\n    return [p['p'] * p['w'], p['w'] - p['l']]\n",
    indep: "def solve(p):\n    gain = p['w'] * p['p']\n    loss = p['l'] * (1 - p['p'])\n    return {'answer': gain - loss}\n",
    stem: "A launch wins <b>{w}</b> with probability <b>{p}</b> and loses <b>{l}</b> otherwise. What is the expected value?", steps: ["EV = P(win) x win - P(lose) x loss.", "= {p} x {w} - {q:1} x {l} = <b>{answer:2}</b>."], traps: ["You ignored the loss branch.", "You ignored the probabilities."] },
];

function stage(system: string): string | null {
  const m = /TASK: ([^\n]+)/.exec(system);
  const t = m?.[1] ?? "";
  if (/^Analyze the course/.test(t)) return "A";
  if (/^Build the concept graph/.test(t)) return "B";
  if (/^Write the lesson/.test(t)) return "C";
  if (/ONE parameterized NUMERIC/.test(t)) return "Dn";
  if (/^Write conceptual multiple-choice/.test(t)) return "Dm";
  if (/matching scenarios/.test(t)) return "Ds";
  if (/^Independent verification\. You will see a question template/.test(t)) return "E1";
  if (/^Independent verification\. Answer each/.test(t)) return "E2";
  if (/^Quality check/.test(t)) return "E3";
  return null;
}

export const mockLearnTraps = { lastUser: "" };

export function learnReply(system: string, user: string): unknown | null {
  const st = stage(system);
  if (!st) return null;
  mockLearnTraps.lastUser = user;
  const cite = firstChunk(user);
  if (st === "A") {
    const mods = [...user.matchAll(/id=([0-9a-f-]{36}) title=([^\n]+)/g)].map((m) => ({ id: m[1], title: m[2] }));
    return { exams: [{ name: "Exam 3", covered_modules: mods.map((m) => m.title), cumulative: "unknown", format_note: "Format not stated in the excerpts.", evidence: cite ? [cite] : [], explicit_topic_list: [] }],
      modules: mods.map((m) => ({ id: m.id, title: m.title, key_terms: [] })), instructor_expectations: [], missing_or_unavailable_materials: [{ what: "Formula sheet", why: "Mentioned but not imported" }],
      conflicts: [{ issue: "Two different exam lengths are mentioned.", sources: cite ? [cite] : [] }], uncertainties: ["Whether the exam is cumulative."], transcript_warnings: [] };
  }
  if (st === "B") {
    const m = /id=([0-9a-f-]{36}) title=([^\n]+)/.exec(user)!; const tag = m[1].slice(0, 6);
    const refs = [...user.matchAll(/<chunk id="(c\d+)"/g)].slice(0, 3).map((x) => x[1]);
    return { concepts: [
      { id: `avg-${tag}`, title: `${m[2]}: Averages and forecasts`, module_id: m[1], prerequisites: [], exam_relevance: { level: "explicit", evidence: refs.slice(0, 1) }, formulas: [{ name: "Moving average", text: "average of the last k values", instructor_form_note: "" }], instructor_specific_rules: [{ rule: "Use the most recent k values.", evidence: refs.slice(0, 1) }], common_mistakes: ["Averaging the wrong window"], decision_cues: [], estimated_minutes: 10, source_refs: refs },
      { id: `spread-${tag}`, title: `${m[2]}: Spread and standardizing`, module_id: m[1], prerequisites: [`avg-${tag}`, "does-not-exist"], exam_relevance: { level: "likely", evidence: [] }, formulas: [{ name: "z-score", text: "z = (x - mean) / sd", instructor_form_note: "" }], instructor_specific_rules: [], common_mistakes: [], decision_cues: [], estimated_minutes: 10, source_refs: refs },
      { id: `which-${tag}`, title: `Which method should I use? (${m[2]})`, module_id: m[1], prerequisites: [`spread-${tag}`], exam_relevance: { level: "likely", evidence: [] }, formulas: [], instructor_specific_rules: [], common_mistakes: [], decision_cues: ["Look at what is being compared"], estimated_minutes: 8, source_refs: refs },
    ] };
  }
  if (st === "C") {
    const title = /"title":"([^"]+)"/.exec(user)?.[1] ?? "this idea";
    return { why_it_matters: `${title} shows up on the exam and decides which method you use.`, short: `${title}: the short version.`,
      cards: ["The big idea", "How it works", "This course's detail", "Watch out"].map((h) => ({ heading: h, body_html: `<b>${h}.</b> A short card about ${title}.` })), alt_explanation: "Think of it as a sliding window over the data.", background_flags: [] };
  }
  if (st === "Dn") {
    // Like a real model told what was already written: take the first template not yet used.
    const g = GENS.find((x) => !user.includes(x.stem.slice(0, 40))) ?? GENS[0];
    const topic = /"title":"([^"]+)"/.exec(user)?.[1] ?? "";
    return { params: g.params, solver_code: g.code, stem_template: `${g.stem}<br><i>(${topic})</i>`, steps_templates: g.steps, traps: g.traps.map((message) => ({ message })), assumptions_stated_in_stem: [], difficulty: 2, source_refs: cite ? [cite] : [] };
  }
  if (st === "E1") {
    const g = GENS.find((x) => user.includes(x.sig));
    return { solver_code: g ? g.indep : "def solve(p):\n    return {'answer': 0}\n" };
  }
  if (st === "Dm") {
    const n = Number(/Write (\d+) questions/.exec(user)?.[1] ?? 6), title = /"title":"([^"]+)"/.exec(user)?.[1] ?? "topic";
    const items = Array.from({ length: n }, (_, i) => {
      const stem = `[mock] Question ${i + 1} about ${title}: which statement is correct in this course?`;
      const right = hash(stem) % 4;
      const options = Array.from({ length: 4 }, (_, k) => k === right ? { text: `The course's rule for ${title}, variant ${i + 1}.`, why: "This is how the course states it." } : { text: `A common mix-up number ${k + 1} for question ${i + 1}.`, why: "This reverses a step the course teaches." });
      return { stem, options, correct_index: right, skill: (["recall", "scenario", "contrast", "application"] as const)[i % 4], source_refs: cite ? [cite] : [] };
    });
    // One deliberately ambiguous item: the blind answerer will disagree and it must be dropped.
    items.push({ stem: "[mock] BAD: which option is best?", options: [0, 1, 2, 3].map((k) => ({ text: `Option ${k}`, why: "x" })), correct_index: (hash("[mock] BAD: which option is best?") + 1) % 4, skill: "recall", source_refs: [] });
    return { items };
  }
  if (st === "Ds") {
    const methods = [...user.matchAll(/^- (.+)$/gm)].map((m) => m[1]);
    const items = Array.from({ length: Math.min(6, methods.length * 2) }, (_, i) => ({ scenario: `[mock] A ${["retailer", "clinic", "team", "bank", "school", "airline"][i % 6]} wants to decide something (case ${i + 1}).`, correct_method: methods[i % methods.length], tempting_alternative: methods[(i + 1) % methods.length], why_correct: "The clues describe this method.", why_alternative_wrong: "It does not fit the comparison being made.", clues: ["clue"] }));
    return { items };
  }
  if (st === "E2") {
    const qs = [...user.matchAll(/Question (\d+): ([^\n]+)/g)];
    return { answers: qs.map((q) => ({ n: Number(q[1]), chosen_index: q[2].includes("Which method fits?") ? 0 : hash(q[2]) % 4, justification: "mock", cited_chunk: cite })) };
  }
  if (st === "E3") {
    const qs = [...user.matchAll(/Question (\d+): ([^\n]+)/g)];
    return { verdicts: qs.map((q) => ({ n: Number(q[1]), clear: true, one_defensible_answer: true, matches_course_convention: true, issues: [] })) };
  }
  return null;
}
