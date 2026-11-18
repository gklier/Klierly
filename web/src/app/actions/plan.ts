"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ActionState } from "@/components/forms";
import { requireUser } from "@/lib/auth";
import { ownsCourse } from "@/lib/courses";
import { daysBetween, isIsoDate, today } from "@/lib/dates";
import { getPlan, regeneratePlan, savePlan, setPlanSessionStatus } from "@/lib/plan/service";
import { startSession } from "@/lib/practice/service";

const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);

export async function savePlanAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const courseId = String(fd.get("courseId") ?? "");
  if (!(await ownsCourse(user.id, courseId))) return { error: "That course was not found." };
  const examDate = String(fd.get("examDate") ?? "");
  if (!isIsoDate(examDate)) return { error: "Enter the exam date." };
  if (daysBetween(today(), examDate) < 1) return { error: "The exam date must be after today." };
  if (daysBetween(today(), examDate) > 366) return { error: "The exam date is more than a year away. Check the year." };
  const minutes = Number(fd.get("minutesPerDay"));
  if (!Number.isFinite(minutes) || minutes < 10 || minutes > 600) return { error: "Minutes per day should be between 10 and 600." };
  const owned = new Set((await db.select({ id: schema.modules.id }).from(schema.modules).where(eq(schema.modules.courseId, courseId))).map((m) => m.id));
  const moduleIds = fd.getAll("moduleIds").map(String).filter((id) => owned.has(id));
  if (owned.size > 0 && moduleIds.length === 0) return { error: "Choose at least one module that the exam covers." };
  const strengths: Record<string, number> = {};
  for (const [k, v] of fd.entries()) {
    const n = Number(v);
    if (k.startsWith("strength_") && uuid(k.slice(9)) && n >= 1 && n <= 5) strengths[k.slice(9)] = Math.round(n);
  }
  const confirmed = fd.get("formatConfirmed") === "on";
  const qCount = Number(fd.get("formatQuestions")), fMin = Number(fd.get("formatMinutes"));
  const r = await savePlan(user.id, courseId, {
    examDate, moduleIds, desiredGrade: String(fd.get("desiredGrade") ?? "").trim().slice(0, 20) || null, minutesPerDay: Math.round(minutes),
    presentationMode: fd.get("presentationMode") === "concise-reading" ? "concise-reading" : "practice-first", strengths,
    examFormat: {
      confirmed,
      ...(confirmed && qCount >= 1 && qCount <= 200 ? { questionCount: Math.round(qCount) } : {}),
      ...(confirmed && fMin >= 1 && fMin <= 600 ? { minutes: Math.round(fMin) } : {}),
      notes: String(fd.get("formatNotes") ?? "").trim().slice(0, 500) || undefined,
    },
  });
  revalidatePath(`/courses/${courseId}`, "layout");
  if (!r?.sessions) return { error: "The plan was saved, but no sessions could be scheduled. See the notes at the top of the plan." };
  redirect(`/courses/${courseId}/plan`);
}

export async function regeneratePlanAction(fd: FormData) {
  const user = await requireUser();
  const courseId = String(fd.get("courseId") ?? "");
  if (!(await ownsCourse(user.id, courseId))) return;
  await regeneratePlan(user.id, courseId);
  revalidatePath(`/courses/${courseId}`, "layout");
}

export async function togglePlanSession(fd: FormData) {
  const user = await requireUser();
  const courseId = String(fd.get("courseId") ?? ""), id = String(fd.get("planSessionId") ?? "");
  if (!uuid(id) || !(await ownsCourse(user.id, courseId))) return;
  await setPlanSessionStatus(user.id, id, fd.get("to") === "planned" ? "planned" : "done");
  revalidatePath(`/courses/${courseId}`, "layout");
}

/** Start the practice that belongs to a planned session; finishing it marks the session done. */
export async function startPlanSession(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const courseId = String(fd.get("courseId") ?? ""), id = String(fd.get("planSessionId") ?? "");
  if (!uuid(id) || !(await ownsCourse(user.id, courseId))) return { error: "That session was not found." };
  const [ps] = await db.select().from(schema.planSessions).where(and(eq(schema.planSessions.id, id), eq(schema.planSessions.userId, user.id), eq(schema.planSessions.courseId, courseId))).limit(1);
  const plan = await getPlan(user.id, courseId);
  if (!ps || !plan) return { error: "That session was not found." };
  const format = plan.plan.examFormat;
  const r = ps.kind === "mock"
    ? await startSession({ userId: user.id, courseId, mode: "exam", topicIds: ps.topicIds, planSessionId: ps.id,
        count: format.confirmed && format.questionCount ? format.questionCount : Math.max(5, Math.round(ps.minutes / 2.5)),
        minutes: format.confirmed && format.minutes ? format.minutes : ps.minutes })
    : await startSession({ userId: user.id, courseId, mode: "drill", topicIds: ps.topicIds, planSessionId: ps.id, count: Math.min(15, Math.max(4, Math.round(ps.minutes / 2.5))) });
  if (!r.ok) return { error: `${r.message} Generate questions for these topics on the Practice page.` };
  redirect(`/courses/${courseId}/practice/${r.sessionId}`);
}
