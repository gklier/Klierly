"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AnswerResponse } from "@/db/schema";
import type { ActionState } from "@/components/forms";
import { generateLearnNote, generateQuestions, generateSupplement, proposeTopics } from "@/lib/ai/generate";
import { AiError } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth";
import { ownsCourse } from "@/lib/courses";
import { buildBlueprint } from "@/lib/practice/blueprint";
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
    const stopped = results.find((r) => r.stopped)?.stopped;
    if (stopped) parts.push(`Stopped early: ${stopped}`);
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

/** Start a timed exam whose topic mix follows the practice blueprint. */
export async function startBlueprintExam(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const courseId = String(fd.get("courseId") ?? "");
  if (!(await ownsCourse(user.id, courseId))) return { error: "That course was not found." };
  const bp = await buildBlueprint(user.id, courseId);
  const available = bp.rows.reduce((n, r) => n + r.available, 0);
  if (available < 3) return { error: "There are not enough questions for a mock exam yet. Generate questions first." };
  const r = await startSession({ userId: user.id, courseId, mode: "exam", count: Math.min(bp.total, available), minutes: bp.minutes, topicIds: bp.rows.map((x) => x.id), quota: new Map(bp.rows.map((x) => [x.id, x.target])) });
  if (!r.ok) return { error: r.message };
  redirect(`/courses/${courseId}/practice/${r.sessionId}`);
}

/** Generate just the questions the blueprint is missing (at most 8 topics and 5 questions per topic per click). */
export async function fillBlueprint(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const courseId = String(fd.get("courseId") ?? "");
  if (!(await ownsCourse(user.id, courseId))) return { error: "That course was not found." };
  const short = (await buildBlueprint(user.id, courseId)).rows.filter((r) => r.shortfall > 0).sort((a, b) => b.shortfall - a.shortfall).slice(0, 8);
  if (!short.length) return { ok: "The question bank already covers this blueprint." };
  try {
    let added = 0, rejected = 0; const thin: string[] = [];
    // Topics need different numbers of questions, so each gets its own request size.
    let stopped: string | null = null;
    for (const row of short) {
      try {
        const [res] = await generateQuestions({ userId: user.id, courseId, topicIds: [row.id], perTopic: Math.min(5, row.shortfall) });
        added += res?.added ?? 0; rejected += res?.rejected.length ?? 0;
        if (res?.insufficient) thin.push(`${row.name} (${res.insufficient})`);
        if (res?.stopped) { stopped = res.stopped; break; }
      } catch (e) {
        if (added === 0) throw e; // nothing achieved: report the failure itself
        stopped = aiMessage(e); break;
      }
    }
    revalidatePath(`/courses/${courseId}`, "layout");
    const parts = [`Added ${added} ${added === 1 ? "question" : "questions"} toward the blueprint.`];
    if (rejected) parts.push(`${rejected} AI ${rejected === 1 ? "draft was" : "drafts were"} discarded by the checks.`);
    if (thin.length) parts.push(`Not enough source material for: ${thin.join("; ")}`);
    if (stopped) parts.push(`Stopped early: ${stopped}`);
    return added ? { ok: parts.join(" ") } : { error: parts.join(" ") };
  } catch (e) {
    revalidatePath(`/courses/${courseId}`, "layout");
    return { error: aiMessage(e) };
  }
}

/** Suggest study topics with AI. Suggestions wait on the Materials page for the student to accept or dismiss. */
export async function organizeTopicsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const courseId = String(fd.get("courseId") ?? "");
  if (!(await ownsCourse(user.id, courseId))) return { error: "That course was not found." };
  try {
    const r = await proposeTopics({ userId: user.id, courseId });
    revalidatePath(`/courses/${courseId}`, "layout");
    if (!r.ok) return { error: r.reason };
    return { ok: `${r.proposed} ${r.proposed === 1 ? "topic" : "topics"} suggested${r.dropped ? ` (${r.dropped} discarded: duplicates, labels, or not found in your material)` : ""}. Review them under “Suggestions from your materials” above.` };
  } catch (e) {
    return { error: aiMessage(e) };
  }
}

/** AI explanation of what a topic's notes leave out. Stored separately and always shown as AI-added, not from the course. */
export async function generateSupplementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const courseId = String(fd.get("courseId") ?? ""), topicId = String(fd.get("topicId") ?? "");
  if (!(await ownsCourse(user.id, courseId)) || !uuid(topicId)) return { error: "That topic was not found." };
  try {
    const r = await generateSupplement({ userId: user.id, courseId, topicId });
    revalidatePath(`/courses/${courseId}/practice/learn/${topicId}`);
    return r.ok ? { ok: "Added an AI explanation of what the notes leave out." } : { error: r.reason };
  } catch (e) {
    return { error: aiMessage(e) };
  }
}
