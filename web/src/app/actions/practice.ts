"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AnswerResponse } from "@/db/schema";
import type { ActionState } from "@/components/forms";
import { generateLearnNote, generateQuestions } from "@/lib/ai/generate";
import { AiError } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth";
import { ownsCourse } from "@/lib/courses";
import { finishSession, getHint, reportQuestion, startSession, submitAnswer, tagError, type AnswerResult, type Mode } from "@/lib/practice/service";
import { WorkerError } from "@/lib/worker";

const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);
const int = (v: FormDataEntryValue | null, min: number, max: number, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
};

export async function startPractice(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const courseId = String(fd.get("courseId") ?? "");
  if (!(await ownsCourse(user.id, courseId))) return { error: "That course was not found." };
  const mode = (["drill", "exam", "review"] as const).find((m) => m === fd.get("mode")) as Mode | undefined;
  if (!mode) return { error: "Choose a practice mode." };
  const topicIds = fd.getAll("topicIds").map(String).filter(uuid);
  const planSessionId = fd.get("planSessionId");
  const r = await startSession({
    userId: user.id, courseId, mode, count: int(fd.get("count"), 1, 60, 10), topicIds: topicIds.length ? topicIds : undefined,
    minutes: fd.get("minutes") ? int(fd.get("minutes"), 1, 240, 20) : undefined, planSessionId: uuid(planSessionId) ? planSessionId : null,
  });
  if (!r.ok) return { error: r.message };
  redirect(`/courses/${courseId}/practice/${r.sessionId}`);
}

export async function answerQuestion(sessionId: string, questionId: string, response: AnswerResponse, timeMs: number, hintUsed: boolean): Promise<AnswerResult> {
  const user = await requireUser();
  if (!uuid(sessionId) || !uuid(questionId) || typeof response !== "object" || response === null) return { ok: false, message: "Invalid request." };
  return submitAnswer(user.id, sessionId, questionId, { choice: typeof response.choice === "number" ? response.choice : undefined, value: typeof response.value === "string" ? response.value : undefined }, Number(timeMs) || 0, hintUsed === true);
}

export async function revealHint(sessionId: string, questionId: string): Promise<string | null> {
  const user = await requireUser();
  return uuid(sessionId) && uuid(questionId) ? getHint(user.id, sessionId, questionId) : null;
}

export async function finishPractice(sessionId: string): Promise<void> {
  const user = await requireUser();
  if (uuid(sessionId)) await finishSession(user.id, sessionId);
  revalidatePath("/courses", "layout");
}

export async function tagErrorAction(answerId: string, reason: string): Promise<boolean> {
  const user = await requireUser();
  return uuid(answerId) ? tagError(user.id, answerId, String(reason)) : false;
}

export async function reportQuestionAction(questionId: string, reason: string): Promise<boolean> {
  const user = await requireUser();
  return uuid(questionId) ? reportQuestion(user.id, questionId, String(reason)) : false;
}

const aiMessage = (e: unknown) =>
  e instanceof AiError ? e.message
  : e instanceof WorkerError ? "The calculation-checking service is not reachable, so new questions cannot be verified. Start the worker and try again."
  : "Generation failed unexpectedly. Nothing was saved.";

export async function generateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const courseId = String(fd.get("courseId") ?? "");
  if (!(await ownsCourse(user.id, courseId))) return { error: "That course was not found." };
  const topicIds = fd.getAll("topicIds").map(String).filter(uuid).slice(0, 8);
  if (!topicIds.length) return { error: "Choose at least one topic." };
  try {
    const results = await generateQuestions({ userId: user.id, courseId, topicIds, perTopic: int(fd.get("perTopic"), 1, 6, 3) });
    revalidatePath(`/courses/${courseId}`, "layout");
    const added = results.reduce((n, r) => n + r.added, 0);
    const rejected = results.reduce((n, r) => n + r.rejected.length, 0);
    const short = results.filter((r) => r.insufficient);
    const parts = [`Added ${added} new ${added === 1 ? "question" : "questions"}.`];
    if (rejected) parts.push(`${rejected} AI ${rejected === 1 ? "draft was" : "drafts were"} discarded by the checks (wrong calculation, missing source, duplicate or ambiguous answer).`);
    if (short.length) parts.push(`Not enough source material for: ${short.map((r) => `${r.topicName} (${r.insufficient})`).join("; ")}`);
    return added ? { ok: parts.join(" ") } : { error: parts.join(" ") };
  } catch (e) {
    return { error: aiMessage(e) };
  }
}

export async function generateNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const courseId = String(fd.get("courseId") ?? ""), topicId = String(fd.get("topicId") ?? "");
  if (!(await ownsCourse(user.id, courseId)) || !uuid(topicId)) return { error: "That topic was not found." };
  const [topic] = await db.select({ id: schema.topics.id }).from(schema.topics).where(and(eq(schema.topics.id, topicId), eq(schema.topics.courseId, courseId))).limit(1);
  if (!topic) return { error: "That topic was not found." };
  try {
    const r = await generateLearnNote({ userId: user.id, courseId, topicId });
    revalidatePath(`/courses/${courseId}/practice/learn/${topicId}`);
    return r.ok ? { ok: "Study note created from your materials." } : { error: r.reason };
  } catch (e) {
    return { error: aiMessage(e) };
  }
}
