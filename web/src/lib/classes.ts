import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { SummaryBody } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import {
  hasVerbatimRun, looksLikeAssessmentMaterial, membershipActive, parseClassIdentity, REPORTS_TO_HIDE, SHARING_TERMS_VERSION, type ClassIdentity,
} from "@/lib/sharing-rules";

export class SharingError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

/**
 * The student opened this LMS course (the extension saw it) and says it is theirs. We cannot confirm enrolment,
 * so this only creates or refreshes a claim. Optionally links one of the student's own courses to the class.
 */
export async function joinClass(userId: string, ident: ClassIdentity, courseId?: string | null) {
  const [space] = await db.insert(schema.classSpaces).values({ lms: ident.lms, host: ident.host, externalCourseId: ident.externalCourseId, label: ident.label })
    .onConflictDoUpdate({ target: [schema.classSpaces.lms, schema.classSpaces.host, schema.classSpaces.externalCourseId], set: { label: sql`${schema.classSpaces.label}` } })
    .returning();
  const [existing] = await db.select().from(schema.classMembers).where(and(eq(schema.classMembers.userId, userId), eq(schema.classMembers.classId, space.id))).limit(1);
  await db.insert(schema.classMembers).values({ userId, classId: space.id })
    .onConflictDoUpdate({ target: [schema.classMembers.userId, schema.classMembers.classId], set: { verifiedAt: new Date() } });
  let linked = false;
  if (courseId) {
    const res = await db.update(schema.courses).set({ classId: space.id }).where(and(eq(schema.courses.id, courseId), eq(schema.courses.userId, userId))).returning({ id: schema.courses.id });
    linked = res.length > 0;
  }
  if (!existing) await logActivity(userId, "class.joined", { courseId: linked ? courseId! : undefined, details: { label: space.label } });
  return { classId: space.id, label: space.label, sharingEnabled: space.sharingEnabled, linked };
}

export async function unlinkCourse(userId: string, courseId: string) {
  await db.update(schema.courses).set({ classId: null }).where(and(eq(schema.courses.id, courseId), eq(schema.courses.userId, userId)));
}

/** Leaving a class removes the claim, unlinks the student's courses and takes down what they shared there. */
export async function leaveClass(userId: string, classId: string) {
  await db.delete(schema.sharedItems).where(and(eq(schema.sharedItems.classId, classId), eq(schema.sharedItems.authorUserId, userId)));
  await db.update(schema.courses).set({ classId: null }).where(and(eq(schema.courses.userId, userId), eq(schema.courses.classId, classId)));
  await db.delete(schema.classMembers).where(and(eq(schema.classMembers.userId, userId), eq(schema.classMembers.classId, classId)));
  await logActivity(userId, "class.left", {});
}

export type ClassAccess = { classId: string; label: string; sharingEnabled: boolean; active: boolean; approved: boolean };

/** The class a course is linked to and whether this student's claim is current (the LMS course was opened recently). */
export async function classAccessForCourse(userId: string, courseId: string): Promise<ClassAccess | null> {
  const [row] = await db.select({ classId: schema.classSpaces.id, label: schema.classSpaces.label, sharingEnabled: schema.classSpaces.sharingEnabled, verifiedAt: schema.classMembers.verifiedAt, approved: schema.classMembers.approved })
    .from(schema.courses)
    .innerJoin(schema.classSpaces, eq(schema.classSpaces.id, schema.courses.classId))
    .innerJoin(schema.classMembers, and(eq(schema.classMembers.classId, schema.classSpaces.id), eq(schema.classMembers.userId, userId)))
    .where(and(eq(schema.courses.id, courseId), eq(schema.courses.userId, userId))).limit(1);
  return row ? { classId: row.classId, label: row.label, sharingEnabled: row.sharingEnabled, approved: row.approved, active: row.approved && membershipActive(row.verifiedAt) } : null;
}

async function requireActive(userId: string, courseId: string): Promise<ClassAccess> {
  const a = await classAccessForCourse(userId, courseId);
  if (!a) throw new SharingError("not_linked", "Link this course to its Canvas class first: open the course in Canvas and use “Join the class library” in the Klierly extension.");
  if (!a.approved) throw new SharingError("approval_required", "Your class membership needs administrator approval.");
  if (!a.active) throw new SharingError("stale", "Open this course in Canvas again with the extension to confirm you are still in the class.");
  if (!a.sharingEnabled) throw new SharingError("disabled", "Sharing is turned off for this class.");
  return a;
}

const stripExt = (t: string) => t.replace(/\.(pdf|docx?|pptx?|txt|md|vtt|srt|html?)$/i, "").trim();

/** Share one of the student's own AI summaries with the class. Re-checks everything at the moment of sharing. */
export async function shareSummary(userId: string, courseId: string, documentId: string) {
  const access = await requireActive(userId, courseId);
  const [doc] = await db.select().from(schema.sourceDocuments)
    .where(and(eq(schema.sourceDocuments.id, documentId), eq(schema.sourceDocuments.courseId, courseId), eq(schema.sourceDocuments.userId, userId))).limit(1);
  if (!doc) throw new SharingError("not_found", "Source not found.");
  const [sum] = await db.select().from(schema.sourceSummaries).where(eq(schema.sourceSummaries.documentId, doc.id)).limit(1);
  if (!sum) throw new SharingError("no_summary", "Create a summary first.");
  if (looksLikeAssessmentMaterial(doc.title, doc.filename)) throw new SharingError("assessment", "This looks like an exam, quiz or answer key. Those are never shared.");
  const chunks = await db.select({ text: schema.sourceChunks.text }).from(schema.sourceChunks).where(eq(schema.sourceChunks.documentId, doc.id));
  const all = [sum.body.overview, ...sum.body.points.map((p) => p.text)];
  if (all.some((t) => hasVerbatimRun(t, chunks.map((c) => c.text)))) throw new SharingError("copied", "This summary reuses too many of the source's own words to share. Create it again.");
  const [mod] = doc.moduleId ? await db.select({ name: schema.modules.name }).from(schema.modules).where(eq(schema.modules.id, doc.moduleId)).limit(1) : [];
  const body: SummaryBody = { overview: sum.body.overview, points: sum.body.points.map((p) => ({ text: p.text, where: p.where })) };
  await db.delete(schema.sharedItems).where(and(eq(schema.sharedItems.sourceSummaryId, sum.id), eq(schema.sharedItems.classId, access.classId)));
  const [item] = await db.insert(schema.sharedItems).values({
    classId: access.classId, authorUserId: userId, sourceSummaryId: sum.id, title: stripExt(doc.title).slice(0, 160), moduleName: mod?.name ?? null,
    body, aiGenerated: true, termsVersion: SHARING_TERMS_VERSION,
  }).returning({ id: schema.sharedItems.id });
  await logActivity(userId, "class.shared", { courseId, details: { title: doc.title, class: access.label } });
  return item.id;
}

export async function sharedStateForDocument(userId: string, documentId: string) {
  const [row] = await db.select({ id: schema.sharedItems.id, status: schema.sharedItems.status })
    .from(schema.sharedItems).innerJoin(schema.sourceSummaries, eq(schema.sourceSummaries.id, schema.sharedItems.sourceSummaryId))
    .where(and(eq(schema.sourceSummaries.documentId, documentId), eq(schema.sharedItems.authorUserId, userId))).limit(1);
  return row ?? null;
}

export async function unshareItem(userId: string, itemId: string) {
  await db.delete(schema.sharedItems).where(and(eq(schema.sharedItems.id, itemId), eq(schema.sharedItems.authorUserId, userId)));
}

export type LibraryItem = { id: string; title: string; moduleName: string | null; body: SummaryBody; createdAt: Date; mine: boolean };

/** Everything active that classmates shared, for a student whose claim is current. Authors are never named. */
export async function libraryFor(userId: string, courseId: string) {
  const access = await classAccessForCourse(userId, courseId);
  if (!access) return { access: null, items: [] as LibraryItem[] };
  if (!access.active || !access.sharingEnabled) return { access, items: [] as LibraryItem[] };
  const rows = await db.select().from(schema.sharedItems)
    .where(and(eq(schema.sharedItems.classId, access.classId), eq(schema.sharedItems.status, "active"))).orderBy(asc(schema.sharedItems.moduleName), desc(schema.sharedItems.createdAt));
  return { access, items: rows.map((r) => ({ id: r.id, title: r.title, moduleName: r.moduleName, body: r.body, createdAt: r.createdAt, mine: r.authorUserId === userId })) };
}

/** A classmate flags an item. Enough distinct reports hide it until the operator looks. */
export async function reportItem(userId: string, courseId: string, itemId: string, reason: string) {
  const access = await classAccessForCourse(userId, courseId);
  if (!access?.active) throw new SharingError("not_linked", "You need to be in this class to report an item.");
  const [item] = await db.select().from(schema.sharedItems).where(and(eq(schema.sharedItems.id, itemId), eq(schema.sharedItems.classId, access.classId))).limit(1);
  if (!item) throw new SharingError("not_found", "That item is no longer shared.");
  if (item.authorUserId === userId) throw new SharingError("own", "Unshare your own item instead of reporting it.");
  await db.insert(schema.sharedReports).values({ itemId, reporterUserId: userId, reason: reason.trim().slice(0, 500) || "No reason given" }).onConflictDoNothing();
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.sharedReports).where(eq(schema.sharedReports.itemId, itemId));
  if (n >= REPORTS_TO_HIDE) await db.update(schema.sharedItems).set({ status: "hidden" }).where(eq(schema.sharedItems.id, itemId));
  return { hidden: n >= REPORTS_TO_HIDE };
}

export async function moderationQueue() {
  return db.execute<{ id: string; title: string; label: string; status: string; reports: number; reasons: string[]; body: SummaryBody }>(sql`
    select i.id, i.title, c.label, i.status, count(r.id)::int as reports, coalesce(array_agg(r.reason) filter (where r.id is not null), '{}') as reasons, i.body
    from shared_items i join class_spaces c on c.id = i.class_id left join shared_reports r on r.item_id = i.id
    group by i.id, c.label having count(r.id) > 0 or i.status = 'hidden' order by i.status desc, count(r.id) desc limit 100`).then((r) => r.rows);
}

export async function moderate(itemId: string, action: "hide" | "restore" | "remove") {
  if (action === "remove") await db.delete(schema.sharedItems).where(eq(schema.sharedItems.id, itemId));
  else {
    await db.update(schema.sharedItems).set({ status: action === "hide" ? "hidden" : "active" }).where(eq(schema.sharedItems.id, itemId));
    if (action === "restore") await db.delete(schema.sharedReports).where(eq(schema.sharedReports.itemId, itemId));
  }
}

export async function classOverview() {
  return db.execute<{ id: string; label: string; host: string; sharing_enabled: boolean; members: number; items: number }>(sql`
    select c.id, c.label, c.host, c.sharing_enabled, (select count(*)::int from class_members m where m.class_id = c.id) as members,
           (select count(*)::int from shared_items i where i.class_id = c.id) as items from class_spaces c order by c.created_at desc limit 100`).then((r) => r.rows);
}

export const setClassSharing = (classId: string, enabled: boolean) => db.update(schema.classSpaces).set({ sharingEnabled: enabled }).where(eq(schema.classSpaces.id, classId));

export { parseClassIdentity };
