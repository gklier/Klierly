import type { AnswerResponse } from "@/db/schema";

/** "1,234.5", "$59.46", "12.5%", " -3 " → number; anything else → null. */
export function parseNumericInput(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = raw.trim().replace(/[\s,$]/g, "").replace(/−/g, "-").replace(/%$/, "");
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export type Gradable = { type: "mcq" | "numeric"; correctIndex: number | null; numericValue: string | null; tolerance: string | null };

export function grade(q: Gradable, response: AnswerResponse): boolean {
  if (q.type === "mcq") return typeof response.choice === "number" && response.choice === q.correctIndex;
  const given = parseNumericInput(response.value);
  if (given === null || q.numericValue === null) return false;
  const answer = Number(q.numericValue);
  const tol = q.tolerance !== null ? Number(q.tolerance) : Math.max(Math.abs(answer) * 0.005, 0.005);
  return Math.abs(given - answer) <= tol + 1e-12;
}

export type Mastery = { score: number; attempts: number; correct: number; streak: number; intervalDays: number; nextReviewAt: Date };
export const PRIOR_SCORE = 0.4;
const RATE = 0.3;
const MAX_INTERVAL = 21;

/**
 * Exponentially weighted mastery (recent answers count more) plus an
 * expanding review interval: a correct answer doubles the gap before the
 * topic is due again, a miss brings it back tomorrow.
 */
export function nextMastery(prev: Mastery | null, correct: boolean, hintUsed: boolean, now: Date): Mastery {
  const outcome = correct ? (hintUsed ? 0.6 : 1) : 0;
  const base = prev?.score ?? PRIOR_SCORE;
  const intervalDays = correct ? Math.min(MAX_INTERVAL, Math.max(2, (prev?.intervalDays ?? 1) * 2)) : 1;
  return {
    score: Math.min(1, Math.max(0, base + RATE * (outcome - base))),
    attempts: (prev?.attempts ?? 0) + 1,
    correct: (prev?.correct ?? 0) + (correct ? 1 : 0),
    streak: correct ? (prev?.streak ?? 0) + 1 : 0,
    intervalDays,
    nextReviewAt: new Date(now.getTime() + intervalDays * 86400_000),
  };
}

export type PoolQuestion = { id: string; topicId: string | null; timesSeen: number; lastAnsweredAt: number | null; lastCorrect: boolean | null };
export type TopicState = { score: number; attempts: number; nextReviewAt: number };

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NONE = "__none__";
const MASTERED = 0.8;

/** Unseen first, then most recently missed, then least recently seen. */
function byPriority(a: PoolQuestion, b: PoolQuestion): number {
  const rank = (q: PoolQuestion) => (q.timesSeen === 0 ? 0 : q.lastCorrect === false ? 1 : 2);
  return rank(a) - rank(b) || (a.lastAnsweredAt ?? 0) - (b.lastAnsweredAt ?? 0) || (a.id < b.id ? -1 : 1);
}

export function topicWeight(state: TopicState | undefined, now: number): number {
  const score = state?.score ?? PRIOR_SCORE;
  const due = state && state.nextReviewAt <= now ? 0.3 : 0;
  return 0.15 + (1 - score) + due;
}

/**
 * Choose questions for a session.
 * - drill: topics are sampled in proportion to weakness (and due reviews);
 *   every fourth slot is reserved for a mastered topic when one exists, so
 *   strong topics keep being revisited (mixed, spaced practice).
 * - exam: unseen questions first, spread evenly across topics.
 * - review: questions whose latest answer was wrong, then questions from
 *   topics whose spaced review is due.
 */
export function pickQuestions(pool: PoolQuestion[], topics: Map<string, TopicState>, mode: "drill" | "exam" | "review", count: number, rng: () => number, now: number): string[] {
  if (mode === "review") {
    const missed = pool.filter((q) => q.lastCorrect === false).sort((a, b) => (a.lastAnsweredAt ?? 0) - (b.lastAnsweredAt ?? 0));
    const dueTopics = new Set([...topics].filter(([, s]) => s.nextReviewAt <= now && s.attempts > 0).map(([id]) => id));
    const due = pool.filter((q) => q.lastCorrect !== false && q.topicId && dueTopics.has(q.topicId)).sort(byPriority);
    return [...missed, ...due].slice(0, count).map((q) => q.id);
  }
  const byTopic = new Map<string, PoolQuestion[]>();
  for (const q of pool) {
    const k = q.topicId ?? NONE;
    if (!byTopic.has(k)) byTopic.set(k, []);
    byTopic.get(k)!.push(q);
  }
  for (const list of byTopic.values()) list.sort(byPriority);
  const picked: string[] = [];
  const take = (k: string) => { const q = byTopic.get(k)!.shift()!; if (!byTopic.get(k)!.length) byTopic.delete(k); picked.push(q.id); };

  if (mode === "exam") {
    const order = [...byTopic.keys()].map((k) => [rng(), k] as const).sort((a, b) => a[0] - b[0]).map(([, k]) => k);
    // Round-robin over topics, but an unseen question anywhere beats a seen one.
    for (const wantUnseen of [true, false]) {
      let progressed = true;
      while (picked.length < count && progressed) {
        progressed = false;
        for (const k of order) {
          if (picked.length >= count) break;
          const head = byTopic.get(k)?.[0];
          if (head && (head.timesSeen === 0) === wantUnseen) { take(k); progressed = true; }
        }
      }
    }
    return picked;
  }

  while (picked.length < count && byTopic.size) {
    const keys = [...byTopic.keys()];
    const mastered = keys.filter((k) => (topics.get(k)?.score ?? 0) >= MASTERED);
    let chosen: string;
    if (picked.length % 4 === 3 && mastered.length) {
      chosen = mastered[Math.floor(rng() * mastered.length)];
    } else {
      const weights = keys.map((k) => topicWeight(topics.get(k), now));
      let r = rng() * weights.reduce((a, b) => a + b, 0);
      chosen = keys[keys.length - 1];
      for (let i = 0; i < keys.length; i++) { r -= weights[i]; if (r <= 0) { chosen = keys[i]; break; } }
    }
    take(chosen);
  }
  return picked;
}

/**
 * Exam built to a blueprint: up to `quota[topic]` questions per topic (unseen
 * first), then topped up from whatever is left so the exam still reaches
 * `count` when a topic's bank is short. Order is shuffled.
 */
export function pickByQuota(pool: PoolQuestion[], quota: Map<string, number>, count: number, rng: () => number): string[] {
  const byTopic = new Map<string, PoolQuestion[]>();
  for (const q of pool) { const k = q.topicId ?? NONE; if (!byTopic.has(k)) byTopic.set(k, []); byTopic.get(k)!.push(q); }
  const picked: PoolQuestion[] = [];
  const rest: PoolQuestion[] = [];
  for (const [topic, list] of byTopic) {
    list.sort(byPriority);
    const n = Math.min(quota.get(topic) ?? 0, list.length);
    picked.push(...list.slice(0, n));
    rest.push(...list.slice(n));
  }
  rest.sort(byPriority);
  const all = [...picked.slice(0, count), ...rest.slice(0, Math.max(0, count - picked.length))];
  return all.map((q) => [rng(), q.id] as const).sort((a, b) => a[0] - b[0]).map(([, id]) => id);
}

export type ReadinessTopic = { score: number | null; attempts: number };

/**
 * Readiness heuristic: average mastery over in-scope topics, where a topic
 * only counts fully once it has at least 5 graded answers. This is a study
 * signal, not a grade prediction.
 */
export function readiness(topics: ReadinessTopic[]): { value: number | null; practised: number; total: number; enoughData: boolean } {
  const total = topics.length;
  const answers = topics.reduce((n, t) => n + t.attempts, 0);
  const practised = topics.filter((t) => t.attempts > 0).length;
  if (!total || answers === 0) return { value: null, practised, total, enoughData: false };
  const sum = topics.reduce((n, t) => n + (t.score ?? 0) * Math.min(1, t.attempts / 5), 0);
  return { value: Math.round((sum / total) * 100), practised, total, enoughData: answers >= Math.max(10, total * 2) };
}
