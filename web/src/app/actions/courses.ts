"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ActionState } from "@/components/forms";
import { requireUser } from "@/lib/auth";
import { deleteCourse, ownsCourse, resolveProposals } from "@/lib/courses";
import { isIsoDate } from "@/lib/dates";
import { assessAssessment } from "@/lib/ingest/guard";
import { retryDocument } from "@/lib/ingest/jobs";
import { autoMapDocuments, createSource, deleteDocument, IngestError, MAX_PASTE_CHARS } from "@/lib/ingest/pipeline";
import { rateLimit } from "@/lib/ratelimit";
import { logActivity } from "@/lib/activity";
import { hasSampleCourse, loadSampleCourse } from "@/lib/sample";
import { workerHealth } from "@/lib/worker";

const str = (fd: FormData, k: string, max = 300) => String(fd.get(k) ?? "").trim().slice(0, max);
const uuid = (v: string) => /^[0-9a-f-]{36}$/.test(v);

async function guard(fd: FormData) {
  const user = await requireUser();
  const courseId = str(fd, "courseId");
  if (!(await ownsCourse(user.id, courseId))) return null;
  return { user, courseId };
}
const denied: ActionState = { error: "That course was not found." };

export async function createCourse(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const name = str(fd, "name", 160);
  if (name.length < 2) return { error: "Give the course a name, for example “QMB 3250 – Statistics for Business Decisions”." };
  const examDate = str(fd, "examDate");
  if (examDate && !isIsoDate(examDate)) return { error: "The exam date is not a valid date." };
  const [course] = await db.insert(schema.courses).values({
    userId: user.id, name, term: str(fd, "term", 60) || null, goal: str(fd, "goal", 500) || null, examDate: examDate || null,
  }).returning({ id: schema.courses.id });
  await logActivity(user.id, "course.created", { courseId: course.id, details: { name, term: str(fd, "term", 60) || undefined } });
  redirect(`/courses/${course.id}/materials`);
}

export async function updateCourse(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(fd);
  if (!g) return denied;
  const name = str(fd, "name", 160);
  if (name.length < 2) return { error: "The course needs a name." };
  const examDate = str(fd, "examDate");
  if (examDate && !isIsoDate(examDate)) return { error: "The exam date is not a valid date." };
  await db.update(schema.courses).set({
    name, term: str(fd, "term", 60) || null, goal: str(fd, "goal", 500) || null, examDate: examDate || null,
    allowExternalAi: fd.get("allowExternalAi") === "on", integrityNote: str(fd, "integrityNote", 1000) || null,
  }).where(eq(schema.courses.id, g.courseId));
  revalidatePath(`/courses/${g.courseId}`, "layout");
  return { ok: "Saved." };
}

export async function deleteCourseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(fd);
  if (!g) return denied;
  await deleteCourse(g.user.id, g.courseId);
  redirect("/");
}

export async function loadSample(_: ActionState): Promise<ActionState> {
  const user = await requireUser();
  if (await hasSampleCourse(user.id)) return { error: "The sample course is already in your account." };
  if (!(await workerHealth())) return { error: "The parsing service is not running, so the sample files cannot be processed. Start the worker and try again." };
  let id: string;
  try { id = await loadSampleCourse(user.id); }
  catch (e) { return { error: e instanceof Error ? e.message : "The sample course could not be loaded." }; }
  redirect(`/courses/${id}`);
}

export async function pasteText(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(fd);
  if (!g) return denied;
  if (fd.get("permission") !== "on") return { error: "Confirm that you are allowed to use this material for your own study." };
  const text = String(fd.get("text") ?? "");
  if (text.trim().length < 20) return { error: "Paste at least a few sentences." };
  if (text.length > MAX_PASTE_CHARS) return { error: `That is too long to paste at once (limit ${MAX_PASTE_CHARS.toLocaleString("en-US")} characters). Split it or upload a file.` };
  const url = str(fd, "url", 500);
  if (url && !/^https?:\/\//i.test(url)) return { error: "The page address should start with http:// or https://." };
  const title = str(fd, "title", 200) || "Pasted text";
  const check = assessAssessment({ url, title, text });
  if (check.blocked) return { error: `This looks like an active assessment or a restricted page (${check.reasons.join("; ")}). Klierly does not import those. Study from notes, slides and readings instead.` };
  if (!rateLimit(`import:${g.user.id}`, 60, 600_000).ok) return { error: "Too many imports in a short time. Try again in a few minutes." };
  const moduleId = str(fd, "moduleId");
  try {
    const r = await createSource({ userId: g.user.id, courseId: g.courseId, moduleId: uuid(moduleId) ? moduleId : null, kind: "paste", title, filename: "paste.txt", mime: "text/plain", data: Buffer.from(text, "utf8"), originUrl: url || null });
    revalidatePath(`/courses/${g.courseId}/materials`);
    return r.duplicate ? { ok: "That exact text is already in this course." } : { ok: `“${title}” was added and is being processed.` };
  } catch (e) {
    return { error: e instanceof IngestError ? e.message : "The text could not be imported." };
  }
}

export async function deleteDocumentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(fd);
  if (!g) return denied;
  await deleteDocument(g.user.id, str(fd, "documentId"));
  revalidatePath(`/courses/${g.courseId}`, "layout");
  if (fd.get("redirect") === "1") redirect(`/courses/${g.courseId}/materials`);
  return { ok: "Deleted." };
}

export async function retryDocumentAction(fd: FormData) {
  const g = await guard(fd);
  if (!g) return;
  await retryDocument(g.user.id, str(fd, "documentId"));
  revalidatePath(`/courses/${g.courseId}/materials`);
}

export async function setDocumentModule(fd: FormData) {
  const g = await guard(fd);
  if (!g) return;
  const moduleId = str(fd, "moduleId");
  if (moduleId && !(await db.select({ id: schema.modules.id }).from(schema.modules).where(and(eq(schema.modules.id, moduleId), eq(schema.modules.courseId, g.courseId)))).length) return;
  await db.update(schema.sourceDocuments).set({ moduleId: moduleId || null })
    .where(and(eq(schema.sourceDocuments.id, str(fd, "documentId")), eq(schema.sourceDocuments.courseId, g.courseId)));
  revalidatePath(`/courses/${g.courseId}`, "layout");
}

export async function resolveProposalAction(fd: FormData) {
  const g = await guard(fd);
  if (!g) return;
  const id = str(fd, "proposalId");
  const action = fd.get("do") === "dismiss" ? "dismiss" : "accept";
  await resolveProposals(g.user.id, g.courseId, id === "all" ? "all" : [id], action);
  revalidatePath(`/courses/${g.courseId}`, "layout");
}

export async function addModule(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(fd);
  if (!g) return denied;
  const name = str(fd, "name", 120);
  if (name.length < 2) return { error: "Enter a module name." };
  const [m] = await db.select({ n: sql<number>`coalesce(max(position), 0)::int` }).from(schema.modules).where(eq(schema.modules.courseId, g.courseId));
  await db.insert(schema.modules).values({ userId: g.user.id, courseId: g.courseId, name, position: (m?.n ?? 0) + 1 });
  await autoMapDocuments(g.courseId);
  revalidatePath(`/courses/${g.courseId}`, "layout");
  return { ok: `Added “${name}”.` };
}

export async function deleteModule(fd: FormData) {
  const g = await guard(fd);
  if (!g) return;
  await db.delete(schema.modules).where(and(eq(schema.modules.id, str(fd, "moduleId")), eq(schema.modules.courseId, g.courseId)));
  revalidatePath(`/courses/${g.courseId}`, "layout");
}

export async function addTopic(_: ActionState, fd: FormData): Promise<ActionState> {
  const g = await guard(fd);
  if (!g) return denied;
  const name = str(fd, "name", 120);
  if (name.length < 2) return { error: "Enter a topic name." };
  const moduleId = str(fd, "moduleId");
  const [m] = await db.select({ n: sql<number>`coalesce(max(position), 0)::int` }).from(schema.topics).where(eq(schema.topics.courseId, g.courseId));
  await db.insert(schema.topics).values({ userId: g.user.id, courseId: g.courseId, name, moduleId: uuid(moduleId) ? moduleId : null, origin: "manual", position: (m?.n ?? 0) + 1 });
  revalidatePath(`/courses/${g.courseId}`, "layout");
  return { ok: `Added “${name}”.` };
}

export async function setTopicModule(fd: FormData) {
  const g = await guard(fd);
  if (!g) return;
  const moduleId = str(fd, "moduleId");
  if (moduleId && !(await db.select({ id: schema.modules.id }).from(schema.modules).where(and(eq(schema.modules.id, moduleId), eq(schema.modules.courseId, g.courseId)))).length) return;
  await db.update(schema.topics).set({ moduleId: moduleId || null }).where(and(eq(schema.topics.id, str(fd, "topicId")), eq(schema.topics.courseId, g.courseId)));
  revalidatePath(`/courses/${g.courseId}`, "layout");
}

export async function deleteTopic(fd: FormData) {
  const g = await guard(fd);
  if (!g) return;
  await db.delete(schema.topics).where(and(eq(schema.topics.id, str(fd, "topicId")), eq(schema.topics.courseId, g.courseId)));
  revalidatePath(`/courses/${g.courseId}`, "layout");
}
