import { and, asc, eq, gte, lt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ExamFormat } from "@/db/schema";
import { topicStates } from "@/lib/courses";
import { today as todayStr } from "@/lib/dates";
import { buildSchedule, type PlanTopic } from "./schedule";

export type PlanForm = {
  examDate: string; moduleIds: string[]; desiredGrade: string | null; minutesPerDay: number;
  presentationMode: "practice-first" | "concise-reading" | "diagrams"; strengths: Record<string, number>; examFormat: ExamFormat;
};

export async function getPlan(userId: string, courseId: string) {
  const [plan] = await db.select().from(schema.examPlans).where(and(eq(schema.examPlans.courseId, courseId), eq(schema.examPlans.userId, userId))).limit(1);
  if (!plan) return null;
  const sessions = await db.select().from(schema.planSessions).where(eq(schema.planSessions.planId, plan.id)).orderBy(asc(schema.planSessions.date));
  return { plan, sessions };
}

export async function savePlan(userId: string, courseId: string, form: PlanForm) {
  const values = { ...form, userId, courseId, generatedAt: new Date() };
  await db.insert(schema.examPlans).values(values).onConflictDoUpdate({ target: schema.examPlans.courseId, set: values });
  return regeneratePlan(userId, courseId);
}

/**
 * Rebuild the schedule from today using current mastery. Completed sessions
 * are kept as history; planned sessions from earlier days are marked skipped
 * and their topics are simply scheduled again, so a missed day never leaves
 * a hole in the plan.
 */
export async function regeneratePlan(userId: string, courseId: string, now = new Date()) {
  const [plan] = await db.select().from(schema.examPlans).where(and(eq(schema.examPlans.courseId, courseId), eq(schema.examPlans.userId, userId))).limit(1);
  if (!plan) return null;
  const today = todayStr(now);
  const all = await topicStates(userId, courseId);
  const inScope = plan.moduleIds.length ? all.filter((t) => t.moduleId && plan.moduleIds.includes(t.moduleId)) : all;

  await db.update(schema.planSessions).set({ status: "skipped" })
    .where(and(eq(schema.planSessions.planId, plan.id), eq(schema.planSessions.status, "planned"), lt(schema.planSessions.date, today)));
  await db.delete(schema.planSessions).where(and(eq(schema.planSessions.planId, plan.id), eq(schema.planSessions.status, "planned"), gte(schema.planSessions.date, today)));
  const done = await db.select().from(schema.planSessions).where(and(eq(schema.planSessions.planId, plan.id), eq(schema.planSessions.status, "done")));
  const introducedByPlan = new Set(done.filter((s) => s.kind === "learn").flatMap((s) => s.topicIds));
  const minutesUsedToday = done.filter((s) => s.date === today).reduce((n, s) => n + s.minutes, 0);

  const topics: PlanTopic[] = inScope.map((t) => ({
    id: t.id, name: t.name, mastery: t.score, attempts: t.attempts, strength: plan.strengths[t.id], hasSources: t.hasSources,
    questionCount: t.questionCount, introduced: t.attempts > 0 || introducedByPlan.has(t.id),
    reviewDue: t.nextReviewAt !== null && t.nextReviewAt.getTime() <= now.getTime(),
  }));
  const warnings: string[] = [];
  if (plan.moduleIds.length && !inScope.length) warnings.push("The selected modules have no topics yet. Accept topic suggestions on the Materials page or add topics by hand.");
  const built = buildSchedule({ today, examDate: plan.examDate, minutesPerDay: plan.minutesPerDay, mode: plan.presentationMode, topics, examFormatConfirmed: plan.examFormat.confirmed, minutesUsedToday });
  warnings.push(...built.warnings);
  if (built.sessions.length) {
    await db.insert(schema.planSessions).values(built.sessions.map((s) => ({ ...s, userId, courseId, planId: plan.id })));
  }
  await db.update(schema.examPlans).set({ warnings, generatedAt: now }).where(eq(schema.examPlans.id, plan.id));
  return { sessions: built.sessions.length, warnings };
}

export async function setPlanSessionStatus(userId: string, planSessionId: string, status: "done" | "planned") {
  await db.update(schema.planSessions).set({ status, completedAt: status === "done" ? new Date() : null })
    .where(and(eq(schema.planSessions.id, planSessionId), eq(schema.planSessions.userId, userId), sql`${schema.planSessions.status} <> 'skipped'`));
}
