import type { PlanSessionKind } from "@/db/schema";
import { addDays, daysBetween } from "@/lib/dates";

export type PlanTopic = {
  id: string; name: string; mastery: number | null; attempts: number; strength?: number; // 1 (weak) – 5 (strong), self-assessed
  hasSources: boolean; questionCount: number; introduced: boolean; reviewDue: boolean;
};
export type PlanInput = {
  today: string; examDate: string; minutesPerDay: number;
  mode: "practice-first" | "concise-reading" | "diagrams";
  topics: PlanTopic[]; examFormatConfirmed: boolean; minutesUsedToday?: number;
};
export type PlannedSession = { date: string; kind: PlanSessionKind; title: string; topicIds: string[]; minutes: number };

const REVIEW_OFFSETS = [2, 5, 9, 14];
const MIN_TOPIC_MINUTES = 8;

/** Self-assessment only matters until there is real performance data. */
export function effectiveMastery(t: PlanTopic): number {
  if (t.attempts >= 3 && t.mastery !== null) return t.mastery;
  const self = t.strength ? 0.2 + ((t.strength - 1) / 4) * 0.6 : 0.4;
  return t.mastery !== null && t.attempts > 0 ? (t.mastery * t.attempts + self * (3 - t.attempts)) / 3 : self;
}

const names = (ts: PlanTopic[], max = 3) => ts.length <= max ? ts.map((t) => t.name).join(", ") : `${ts.slice(0, max).map((t) => t.name).join(", ")} +${ts.length - max} more`;

/**
 * Day-by-day plan from today until the day before the exam.
 * First exposure (short explanation + worked example + retrieval practice) is
 * spread over the first ~65% of the days in module order; each topic then
 * returns for spaced retrieval practice 2, 5, 9 and 14 days later, grouped
 * into mixed sessions; a timed mock exam sits two days before the exam and a
 * light wrap-up on the last day. Minutes never exceed the daily budget:
 * what does not fit is cut and reported, not silently promised.
 */
export function buildSchedule(input: PlanInput): { sessions: PlannedSession[]; warnings: string[] } {
  const warnings: string[] = [];
  const D = daysBetween(input.today, input.examDate);
  if (D < 0) return { sessions: [], warnings: ["The exam date is in the past. Update it to build a plan."] };
  if (D === 0) return { sessions: [], warnings: ["The exam is today, so there is nothing left to schedule. Good luck."] };

  const missing = input.topics.filter((t) => !t.hasSources);
  const topics = input.topics.filter((t) => t.hasSources);
  if (missing.length) warnings.push(`No imported material covers ${names(missing, 4)}. These are left out of the plan — import material for them or remove them from the exam scope.`);
  if (!topics.length) {
    warnings.push("There is no imported material for the selected modules yet, so a study plan cannot be built from your course. Import notes, slides or readings first.");
    return { sessions: [], warnings };
  }
  const noQuestions = topics.filter((t) => t.questionCount === 0);
  if (noQuestions.length) warnings.push(`No practice questions exist yet for ${names(noQuestions, 4)}. Generate questions before those practice sessions.`);
  if (!input.examFormatConfirmed) warnings.push("The exam format (question types, length, weights) is not confirmed, so the mock exam uses a default length. Confirm the format when your instructor announces it.");

  const B = Math.max(5, input.minutesPerDay);
  const budget = Array.from({ length: D }, (_, i) => (i === 0 ? Math.max(0, B - (input.minutesUsedToday ?? 0)) : B));
  const date = (i: number) => addDays(input.today, i);
  const sessions: PlannedSession[] = [];
  const weight = (t: PlanTopic) => 1.5 - effectiveMastery(t);
  const byWeakness = [...topics].sort((a, b) => effectiveMastery(a) - effectiveMastery(b));

  if (D === 1) {
    warnings.push("Only one day is left, so the plan is a single mixed practice session on your weakest topics.");
    if (budget[0] >= 5) sessions.push({ date: date(0), kind: "mixed", title: `Mixed practice: ${names(byWeakness)}`, topicIds: byWeakness.slice(0, 6).map((t) => t.id), minutes: budget[0] });
    return { sessions, warnings };
  }

  const wrapDay = D - 1;
  const mockDay = D >= 4 ? D - 2 : -1;
  const lastStudyDay = mockDay >= 0 ? mockDay - 1 : wrapDay - 1;
  const P = Math.max(1, D >= 4 ? Math.ceil((lastStudyDay + 1) * 0.65) : lastStudyDay + 1);

  // --- first exposure
  const fresh = topics.filter((t) => !t.introduced);
  const baseFirst = input.mode === "practice-first" ? 22 : 25;
  const introDay = new Map<string, number>();
  const perDay: PlanTopic[][] = Array.from({ length: P }, () => []);
  fresh.forEach((t, i) => perDay[Math.min(P - 1, Math.floor((i * P) / fresh.length))].push(t));
  let compressed = false, overfull = false;
  perDay.forEach((list, d) => {
    if (!list.length) return;
    let mins = list.map((t) => Math.round(baseFirst * weight(t)));
    const total = mins.reduce((a, b) => a + b, 0);
    if (total > budget[d]) {
      compressed = true;
      mins = mins.map((m) => Math.max(MIN_TOPIC_MINUTES, Math.floor((m * budget[d]) / total)));
      // Still too much for the day: keep what fits, push the rest to the next day.
      while (mins.reduce((a, b) => a + b, 0) > budget[d] && list.length > 1) {
        const moved = list.pop()!; mins.pop();
        if (d + 1 <= lastStudyDay) (perDay[d + 1] ??= []).unshift(moved); else { overfull = true; list.push(moved); mins.push(MIN_TOPIC_MINUTES); break; }
      }
    }
    const minutes = Math.min(budget[d], mins.reduce((a, b) => a + b, 0));
    if (minutes < 5) { overfull = true; return; }
    list.forEach((t) => introDay.set(t.id, d));
    budget[d] -= minutes;
    const verb = input.mode === "practice-first" ? "Practice-first intro" : "Read, then practice";
    sessions.push({ date: date(d), kind: "learn", title: `${verb}: ${names(list)}`, topicIds: list.map((t) => t.id), minutes });
  });
  if (compressed) warnings.push("There is not enough time before the exam to cover every topic in depth at your daily minutes. First-pass sessions were shortened; raising minutes per day or narrowing the scope would help.");
  if (overfull) warnings.push("Some topics could not be fitted before the exam at your daily minutes.");

  // --- mock exam and wrap-up
  if (mockDay >= 0 && budget[mockDay] >= 15) {
    const minutes = Math.min(budget[mockDay], 45);
    budget[mockDay] -= minutes;
    sessions.push({ date: date(mockDay), kind: "mock", title: "Timed mock exam on all covered topics", topicIds: topics.map((t) => t.id), minutes });
  }
  if (budget[wrapDay] >= 5) {
    const minutes = Math.min(budget[wrapDay], 25);
    budget[wrapDay] = 0; // keep the last day light
    sessions.push({ date: date(wrapDay), kind: "wrap", title: `Light review of past mistakes: ${names(byWeakness)}`, topicIds: byWeakness.slice(0, 3).map((t) => t.id), minutes });
  }

  // --- spaced retrieval
  type Review = { topic: PlanTopic; due: number; minutes: number };
  const queue: Review[] = [];
  for (const t of topics) {
    const start = introDay.has(t.id) ? introDay.get(t.id)! : t.introduced ? (t.reviewDue || effectiveMastery(t) < 0.6 ? -2 : -1) : null;
    if (start === null) continue;
    for (const off of REVIEW_OFFSETS) {
      const due = start + off;
      // The mock exam already is retrieval practice on every topic, so no separate review that day.
      if (due >= 0 && due < wrapDay && due !== mockDay) queue.push({ topic: t, due, minutes: Math.max(5, Math.round(8 * weight(t))) });
    }
  }
  queue.sort((a, b) => a.due - b.due || effectiveMastery(a.topic) - effectiveMastery(b.topic));
  let dropped = 0;
  for (let d = 0; d < wrapDay; d++) {
    const todays: Review[] = [];
    for (let i = 0; i < queue.length;) {
      const r = queue[i];
      if (r.due > d) break;
      if (d - r.due > 2) { queue.splice(i, 1); dropped++; continue; } // too late to be the same review
      if (todays.some((x) => x.topic.id === r.topic.id)) { i++; continue; }
      if (r.minutes <= budget[d]) { budget[d] -= r.minutes; todays.push(r); queue.splice(i, 1); } else i++;
    }
    if (todays.length) {
      const ts = todays.map((r) => r.topic);
      sessions.push({
        date: date(d), kind: ts.length > 1 ? "mixed" : "review",
        title: ts.length > 1 ? `Mixed retrieval practice: ${names(ts)}` : `Retrieval practice: ${ts[0].name}`,
        topicIds: ts.map((t) => t.id), minutes: todays.reduce((n, r) => n + r.minutes, 0),
      });
    }
  }
  dropped += queue.filter((r) => r.due < wrapDay).length;
  if (dropped) warnings.push(`${dropped} spaced review ${dropped === 1 ? "session" : "sessions"} did not fit in your daily minutes and ${dropped === 1 ? "was" : "were"} left out.`);

  const order: Record<PlanSessionKind, number> = { learn: 0, drill: 1, review: 2, mixed: 2, mock: 3, wrap: 4 };
  sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : order[a.kind] - order[b.kind]));
  return { sessions, warnings };
}
