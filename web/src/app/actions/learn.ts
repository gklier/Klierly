"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { AiError } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth";
import { ownsCourse } from "@/lib/courses";
import { rateLimit } from "@/lib/ratelimit";
import { advance, answer, hint, LearnError, reportItem, startBuild, startStudying } from "@/lib/learn/service";

const s = (fd: FormData, k: string, n = 300) => String(fd.get(k) ?? "").trim().slice(0, n);
const message = (e: unknown): ActionState => e instanceof LearnError || e instanceof AiError ? { error: e.message } : { error: "Something went wrong. Nothing was changed." };

async function own(fd: FormData) {
  const user = await requireUser();
  const courseId = s(fd, "courseId");
  if (!(await ownsCourse(user.id, courseId))) return null;
  return { user, courseId };
}

export async function buildGuideAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await own(fd); if (!g) return { error: "That course was not found." };
  if (!rateLimit(`learn-build:${g.user.id}`, 6, 3_600_000).ok) return { error: "Too many builds this hour. Try again later." };
  try { await startBuild(g.user.id, g.courseId, fd.getAll("moduleIds").map(String)); } catch (e) { return message(e); }
  revalidatePath(`/courses/${g.courseId}/learn`);
  return { ok: "Building your study guide." };
}

export async function startStudyingAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await own(fd); if (!g) return { error: "That course was not found." };
  try { await startStudying(g.user.id, g.courseId); } catch (e) { return message(e); }
  redirect(`/courses/${g.courseId}/learn/study`);
}

export async function advanceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await own(fd); if (!g) return { error: "That course was not found." };
  try { await advance(g.user.id, g.courseId, s(fd, "token", 300)); } catch (e) { return message(e); }
  revalidatePath(`/courses/${g.courseId}/learn/study`);
  return null;
}

export async function answerAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await own(fd); if (!g) return { error: "That course was not found." };
  if (!rateLimit(`learn-answer:${g.user.id}`, 240, 60_000).ok) return { error: "Slow down a little and try again." };
  try {
    const r = await answer(g.user.id, g.courseId, s(fd, "resp", 40), s(fd, "token", 300));
    if (r.bad) return { error: "Enter a number (decimals are fine)." };
  } catch (e) { return message(e); }
  revalidatePath(`/courses/${g.courseId}/learn/study`);
  return null;
}

export async function hintAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await own(fd); if (!g) return { error: "That course was not found." };
  await hint(g.user.id, g.courseId, s(fd, "token", 300));
  revalidatePath(`/courses/${g.courseId}/learn/study`);
  return null;
}

/** One tap. Never asks the student to judge or fix a question: it simply leaves the pool. */
export async function reportQuestionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await own(fd); if (!g) return null;
  await reportItem(g.user.id, g.courseId, s(fd, "key", 120), "");
  return { ok: "Thanks. That question will not be shown again." };
}
