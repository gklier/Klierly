import { sql } from "drizzle-orm";
import { db } from "@/db";
import { topicStates } from "@/lib/courses";
import { getPlan } from "@/lib/plan/service";
import { toOrQuery } from "@/lib/retrieval";

export type BlueprintTopic = { id: string; name: string; moduleName: string | null; excerpts: number; available: number; mastery: number | null; attempts: number };
export type BlueprintRow = BlueprintTopic & { target: number; shortfall: number; share: number };
export type Blueprint = { rows: BlueprintRow[]; total: number; minutes: number; formatConfirmed: boolean; scope: "plan" | "course"; notes: string[]; uncovered: string[] };

/**
 * Split `total` questions across topics in proportion to how much the
 * student's own material says about each one (square-root damped so one long
 * document cannot crowd everything else out). Every topic gets at least one
 * question when there are enough to go round. Largest-remainder rounding, so
 * the parts always sum to the total.
 */
export function allocate(topics: { id: string; excerpts: number }[], total: number): Map<string, number> {
  const out = new Map<string, number>(topics.map((t) => [t.id, 0]));
  if (!topics.length || total <= 0) return out;
  const weights = topics.map((t) => Math.sqrt(Math.max(1, t.excerpts)));
  const sum = weights.reduce((a, b) => a + b, 0);
  const floor = total >= topics.length ? 1 : 0;
  const spare = total - floor * topics.length;
  const exact = weights.map((w) => (w / sum) * spare);
  const base = exact.map(Math.floor);
  let left = spare - base.reduce((a, b) => a + b, 0);
  const order = exact.map((e, i) => [e - base[i], i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (left <= 0) break; base[i]++; left--; }
  if (!floor) {
    // Fewer questions than topics: the best-covered topics get them.
    const ranked = weights.map((w, i) => [w, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, total);
    for (const [, i] of ranked) out.set(topics[i].id, 1);
    return out;
  }
  topics.forEach((t, i) => out.set(t.id, floor + base[i]));
  return out;
}

/**
 * A practice-exam blueprint for the plan's scope (or the whole course).
 * Built only from the student's materials and question bank. It is a study
 * aid — it does not know and must not claim the instructor's real exam design.
 */
export async function buildBlueprint(userId: string, courseId: string): Promise<Blueprint> {
  const [all, plan] = await Promise.all([topicStates(userId, courseId), getPlan(userId, courseId)]);
  const scoped = plan?.plan.moduleIds.length ? all.filter((t) => t.moduleId && plan.plan.moduleIds.includes(t.moduleId)) : all;
  const covered = scoped.filter((t) => t.hasSources);
  const topics: BlueprintTopic[] = await Promise.all(covered.map(async (t) => {
    const q = toOrQuery(t.name);
    const r = q ? await db.execute<{ n: number }>(sql`select count(*)::int as n from (select 1 from source_chunks where course_id = ${courseId} and user_id = ${userId} and tsv @@ to_tsquery('english', ${q}) limit 40) s`) : null;
    return { id: t.id, name: t.name, moduleName: t.moduleName, excerpts: Math.max(1, r?.rows[0]?.n ?? 1), available: t.questionCount, mastery: t.score, attempts: t.attempts };
  }));
  const format = plan?.plan.examFormat;
  const confirmed = Boolean(format?.confirmed);
  const total = confirmed && format?.questionCount ? format.questionCount : Math.min(30, Math.max(10, topics.length * 2));
  const minutes = confirmed && format?.minutes ? format.minutes : Math.round(total * 1.5);
  const targets = allocate(topics, total);
  const rows = topics.map((t) => { const target = targets.get(t.id) ?? 0; return { ...t, target, shortfall: Math.max(0, target - t.available), share: total ? target / total : 0 }; });
  const notes = [
    "This blueprint weights topics by how much your imported material says about each one. It is a study aid, not your instructor's exam design.",
    confirmed ? `Length uses the format you confirmed in your study plan (${total} questions, ${minutes} minutes).` : `The real exam format is not confirmed, so this uses a default of ${total} questions in ${minutes} minutes. Confirm the format in your study plan when it is announced.`,
  ];
  if (!plan) notes.push("No study plan yet, so the blueprint covers every topic in the course.");
  return { rows, total, minutes, formatConfirmed: confirmed, scope: plan?.plan.moduleIds.length ? "plan" : "course", notes, uncovered: scoped.filter((t) => !t.hasSources).map((t) => t.name) };
}
