"use server";

import { confirmationScope } from "@/lib/approval-scope";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/forms";
import { generateSummary } from "@/lib/ai/generate";
import { AiError } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth";
import { leaveClass, moderate, reportItem, setClassSharing, SharingError, shareSummary, unlinkCourse, unshareItem } from "@/lib/classes";
import { ownsCourse } from "@/lib/courses";
import { requireAdmin } from "@/lib/security";
import { rateLimit } from "@/lib/ratelimit";

const s = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const uuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

const fail = (e: unknown): ActionState =>
  e instanceof SharingError || e instanceof AiError ? { error: e.message } : { error: "Something went wrong. Nothing was changed." };

export async function createSummaryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const courseId = s(fd, "courseId"), documentId = s(fd, "documentId");
  if (!uuid(documentId) || !(await ownsCourse(user.id, courseId))) return { error: "That source was not found." };
  if (!rateLimit(`summary:${user.id}`, 20, 3_600_000).ok) return { error: "Too many summaries this hour. Try again later." };
  try {
    const r = await generateSummary({ userId: user.id, courseId, documentId });
    revalidatePath(`/courses/${courseId}/materials/${documentId}`);
    return r.ok ? { ok: "Summary created. It is private until you share it." } : { error: r.reason };
  } catch (e) {
    return fail(e);
  }
}

export async function shareSummaryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const courseId = s(fd, "courseId"), documentId = s(fd, "documentId");
  if (fd.get("agree") !== "on") return { error: "Tick the box to confirm the sharing terms." };
  if (!uuid(documentId) || !(await ownsCourse(user.id, courseId))) return { error: "That source was not found." };
  try {
    await shareSummary(user.id, courseId, documentId);
    revalidatePath(`/courses/${courseId}/materials/${documentId}`);
    revalidatePath(`/courses/${courseId}/library`);
    return { ok: "Shared with your class. You can take it down any time." };
  } catch (e) {
    return fail(e);
  }
}

export async function unshareAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const itemId = s(fd, "itemId"), courseId = s(fd, "courseId");
  if (!uuid(itemId)) return { error: "Not found." };
  await unshareItem(user.id, itemId);
  revalidatePath(`/courses/${courseId}`, "layout");
  return { ok: "Taken down." };
}

export async function reportAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const itemId = s(fd, "itemId"), courseId = s(fd, "courseId");
  if (!uuid(itemId) || !(await ownsCourse(user.id, courseId))) return { error: "Not found." };
  try {
    const r = await reportItem(user.id, courseId, itemId, s(fd, "reason"));
    revalidatePath(`/courses/${courseId}/library`);
    return { ok: r.hidden ? "Thanks. It has been hidden until it is reviewed." : "Thanks. It has been reported." };
  } catch (e) {
    return fail(e);
  }
}

export async function leaveClassAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const classId = s(fd, "classId"), courseId = s(fd, "courseId");
  if (!uuid(classId)) return { error: "Not found." };
  await leaveClass(user.id, classId);
  revalidatePath(`/courses/${courseId}`, "layout");
  redirect(`/courses/${courseId}/settings`);
}

export async function unlinkCourseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const courseId = s(fd, "courseId");
  if (!(await ownsCourse(user.id, courseId))) return { error: "Not found." };
  await unlinkCourse(user.id, courseId);
  revalidatePath(`/courses/${courseId}`, "layout");
  return { ok: "Unlinked." };
}

const requireOperator = requireAdmin;

export async function moderateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  await requireOperator(await confirmationScope("class-moderate", fd));
  const itemId = s(fd, "itemId"), action = s(fd, "action");
  if (!uuid(itemId) || !["hide", "restore", "remove"].includes(action)) return { error: "Bad request." };
  await moderate(itemId, action as "hide" | "restore" | "remove");
  revalidatePath("/admin");
  return { ok: "Done." };
}

export async function classSharingSwitchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  await requireOperator(await confirmationScope("class-sharing", fd));
  const classId = s(fd, "classId");
  if (!uuid(classId)) return { error: "Bad request." };
  await setClassSharing(classId, s(fd, "enabled") === "1");
  revalidatePath("/admin");
  return { ok: "Saved." };
}
