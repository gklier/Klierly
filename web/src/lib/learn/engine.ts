import type { LmCursor, LmQuestionState } from "@/db/schema";

/**
 * Learning-flow rules, pure and database-free so they can be tested exhaustively. Behaviour is the prototype's:
 * - a concept is "practiced" after at least 4 of the last 5 answers since the practice baseline are correct WITHOUT a hint.
 *   A hinted correct answer is logged as 0.5 (it moves the progress bar) but never counts toward this rule. NOTE: the prototype
 *   summed scores (3 clean + 2 hinted = 4.0 passed); this follows the stated rule literally and is stricter.
 * - it is "solid" only after a LATER, spaced revisit (a review question) is answered correctly without a hint;
 * - every 3rd practice question is a revisit; a miss re-queues after at least 3 other questions.
 */
export type Status = "new" | "learning" | "practiced" | "solid";
export type ConceptState = { status: Status; log: number[]; baseIndex: number };
export type MissEntry = { key: string; conceptId: string; after: number };

export const SCORE = { unaided: 1, hinted: 0.5, wrong: 0 } as const;
export const REQUIRED_RECENT = 5, REQUIRED_CLEAN = 4, REVISIT_EVERY = 3, REQUEUE_AFTER = 3, RETEACH_AFTER = 8;

export const sum = (a: number[]) => a.reduce((s, x) => s + x, 0);
export const isDone = (s: Status) => s === "practiced" || s === "solid";

export function mastery(st: ConceptState): number {
  if (st.status === "solid") return 1;
  const w = st.log.slice(-REQUIRED_RECENT);
  const m = w.length ? sum(w) / Math.max(w.length, REQUIRED_RECENT) : 0;
  return st.status === "practiced" ? Math.max(m, 0.8) : Math.min(m, 0.79);
}

export const scoreOf = (ok: boolean, hinted: boolean) => (ok ? (hinted ? SCORE.hinted : SCORE.unaided) : SCORE.wrong);

/** Apply one answer. Returns the new state and the new miss queue; `answerCount` is the running total after this answer. */
export function applyAnswer(st: ConceptState, miss: MissEntry[], a: { key: string; conceptId: string; ok: boolean; hinted: boolean; review: boolean; answerCount: number }): { st: ConceptState; miss: MissEntry[] } {
  const next: ConceptState = { ...st, log: [...st.log, scoreOf(a.ok, a.hinted)] };
  let m = miss.filter((x) => x.key !== a.key);
  if (!a.ok) m = [...m, { key: a.key, conceptId: a.conceptId, after: a.answerCount + REQUEUE_AFTER }];
  if (a.review && a.ok && !a.hinted && st.status === "practiced") next.status = "solid";
  if (!a.ok && isDone(st.status)) next.status = "learning";
  return { st: next, miss: m };
}

/** After a practice answer: did the concept just reach "practiced", or does it need re-teaching? */
export function afterPractice(st: ConceptState, cur: LmCursor): { st: ConceptState; reteach: boolean; checkFailed: boolean } {
  if (cur.check) {
    if (cur.checkLog.length >= 4) return sum(cur.checkLog) >= 3 ? { st: { ...st, status: "practiced" }, reteach: false, checkFailed: false } : { st, reteach: false, checkFailed: true };
    return { st, reteach: false, checkFailed: false };
  }
  const w = st.log.slice(st.baseIndex);
  if (w.length >= REQUIRED_RECENT && w.slice(-REQUIRED_RECENT).filter((x) => x === SCORE.unaided).length >= REQUIRED_CLEAN) return { st: { ...st, status: "practiced" }, reteach: false, checkFailed: false };
  return { st, reteach: w.length >= RETEACH_AFTER, checkFailed: false };
}

/** Hint ladder: the first hint never gives the answer. Level 3 is the worked-out step, shown only after levels 1 and 2. */
export const MAX_HINT_LEVEL = 3;
export const nextHintLevel = (shown: number) => Math.min(MAX_HINT_LEVEL, shown + 1);

/** Which concept's question to ask next in practice: a due missed item first, else the weakest earlier concept. */
export function revisitChoice(opts: { practiceCount: number; check: boolean; currentConceptId: string; miss: MissEntry[]; answered: number; weakest: { key: string } | null }): { kind: "own" } | { kind: "miss"; key: string } | { kind: "weak" } {
  if (opts.check || opts.practiceCount % REVISIT_EVERY !== 0) return { kind: "own" };
  const due = opts.miss.find((m) => m.after <= opts.answered && m.conceptId !== opts.currentConceptId) ?? opts.miss.find((m) => m.after <= opts.answered);
  if (due) return { kind: "miss", key: due.key };
  return opts.weakest ? { kind: "weak" } : { kind: "own" };
}

export const newQuestionState = (key: string, mode: LmQuestionState["mode"]): LmQuestionState => ({ key, mode, hints: 0, tries: 0, answered: false, ok: null, resp: null });

export function parseNumber(raw: string): number | null {
  const v = parseFloat(String(raw).replace(/[,%$\s]/g, ""));
  return Number.isFinite(v) ? v : null;
}

export type Graded = { ok: boolean; bad?: boolean; trap?: string | null };
export function gradeNumeric(resp: string, answer: number, tolerance: number, traps: { value: number; message: string }[]): Graded {
  const v = parseNumber(resp);
  if (v === null) return { ok: false, bad: true };
  if (Math.abs(v - answer) <= tolerance) return { ok: true };
  const hit = traps.find((t) => Math.abs(v - t.value) <= Math.max(tolerance, Math.abs(t.value) * 0.002));
  return { ok: false, trap: hit?.message ?? null };
}
