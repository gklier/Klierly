import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db, schema } from "@/db";
import type { ProposalPayload } from "@/db/schema";
import { autoMapDocuments } from "@/lib/ingest/pipeline";
import { moduleNumberOf } from "@/lib/ingest/proposals";
import { removeFile, removeUserFiles } from "@/lib/ingest/storage";
import { toOrQuery } from "@/lib/retrieval";

/** Every read of a course goes through here: no row without the owner's id. */
export async function getCourse(userId: string, courseId: string) {
  if (!/^[0-9a-f-]{36}$/.test(courseId)) notFound();
  const [course] = await db.select().from(schema.courses).where(and(eq(schema.courses.id, courseId), eq(schema.courses.userId, userId))).limit(1);
  if (!course) notFound();
  return course;
}

export async function ownsCourse(userId: string, courseId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/.test(courseId)) return false;
  const [c] = await db.select({ id: schema.courses.id }).from(schema.courses).where(and(eq(schema.courses.id, courseId), eq(schema.courses.userId, userId))).limit(1);
  return Boolean(c);
}

export const listModules = (courseId: string) =>
  db.select().from(schema.modules).where(eq(schema.modules.courseId, courseId)).orderBy(asc(schema.modules.position), asc(schema.modules.createdAt));

export type TopicState = {
  id: string; name: string; moduleId: string | null; moduleName: string | null; position: number;
  score: number | null; attempts: number; correct: number; nextReviewAt: Date | null;
  questionCount: number; hasSources: boolean;
};

/** Topics with mastery, question counts and whether any imported chunk supports them. */
export async function topicStates(userId: string, courseId: string): Promise<TopicState[]> {
  const rows = await db.execute<{
    id: string; name: string; module_id: string | null; module_name: string | null; position: number; module_position: number | null;
    score: number | null; attempts: number | null; correct: number | null; next_review_at: Date | null; question_count: number; evidence: boolean;
  }>(sql`
    select t.id, t.name, t.module_id, m.name as module_name, t.position, m.position as module_position,
           tm.score, tm.attempts, tm.correct, tm.next_review_at,
           (select count(*)::int from questions q where q.topic_id = t.id and q.status = 'active') as question_count,
           (t.evidence_chunk_id is not null) as evidence
    from topics t
    left join modules m on m.id = t.module_id
    left join topic_mastery tm on tm.topic_id = t.id and tm.user_id = ${userId}
    where t.course_id = ${courseId} and t.user_id = ${userId}
    order by m.position nulls last, t.position, t.created_at`);
  return Promise.all(rows.rows.map(async (r) => {
    let hasSources = r.evidence;
    if (!hasSources) {
      const q = toOrQuery(r.name);
      if (q) {
        const hit = await db.execute(sql`select 1 from source_chunks where course_id = ${courseId} and user_id = ${userId} and tsv @@ to_tsquery('english', ${q}) limit 1`);
        hasSources = (hit.rowCount ?? 0) > 0;
      }
    }
    return {
      id: r.id, name: r.name, moduleId: r.module_id, moduleName: r.module_name, position: r.position,
      score: r.score, attempts: r.attempts ?? 0, correct: r.correct ?? 0, nextReviewAt: r.next_review_at ? new Date(r.next_review_at) : null,
      questionCount: r.question_count, hasSources,
    };
  }));
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function applyProposal(p: typeof schema.proposals.$inferSelect) {
  const payload = p.payload as ProposalPayload;
  const base = { userId: p.userId, courseId: p.courseId };
  if (payload.kind === "module") {
    const mods = await listModules(p.courseId);
    const exists = mods.some((m) => norm(m.name) === norm(payload.name) || (payload.number !== undefined && moduleNumberOf(m.name) === payload.number));
    if (!exists) await db.insert(schema.modules).values({ ...base, name: payload.name, position: payload.number ?? mods.length + 1 });
  } else if (payload.kind === "topic") {
    const existing = await db.select({ name: schema.topics.name }).from(schema.topics).where(eq(schema.topics.courseId, p.courseId));
    if (!existing.some((t) => norm(t.name) === norm(payload.name))) {
      let moduleId: string | null = null;
      if (payload.documentId) {
        const [doc] = await db.select({ moduleId: schema.sourceDocuments.moduleId }).from(schema.sourceDocuments).where(eq(schema.sourceDocuments.id, payload.documentId)).limit(1);
        moduleId = doc?.moduleId ?? null;
      }
      await db.insert(schema.topics).values({ ...base, name: payload.name, moduleId, origin: "materials", evidenceChunkId: p.evidenceChunkId, position: existing.length });
    }
  } else if (payload.kind === "objective") {
    const mods = await listModules(p.courseId);
    const mod = payload.moduleNumber !== undefined ? mods.find((m) => moduleNumberOf(m.name) === payload.moduleNumber) : undefined;
    await db.insert(schema.learningObjectives).values({ ...base, text: payload.text, moduleId: mod?.id ?? null, evidenceChunkId: p.evidenceChunkId });
  } else {
    await db.insert(schema.courseDates).values({ ...base, label: payload.label, date: payload.date, dateKind: payload.dateKind, modulesCovered: payload.modulesCovered ?? null, evidenceChunkId: p.evidenceChunkId });
  }
  await db.update(schema.proposals).set({ status: "accepted" }).where(eq(schema.proposals.id, p.id));
}

/** Give module-less topics and objectives the module of the document they came from. */
async function backfillModules(courseId: string) {
  await autoMapDocuments(courseId);
  await db.execute(sql`
    update topics t set module_id = d.module_id
    from source_chunks c join source_documents d on d.id = c.document_id
    where t.course_id = ${courseId} and t.module_id is null and t.evidence_chunk_id = c.id and d.module_id is not null`);
}

export async function resolveProposals(userId: string, courseId: string, ids: string[] | "all", action: "accept" | "dismiss", kinds?: ProposalPayload["kind"][]) {
  const where = and(
    eq(schema.proposals.userId, userId), eq(schema.proposals.courseId, courseId), eq(schema.proposals.status, "pending"),
    ids === "all" ? undefined : inArray(schema.proposals.id, ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
    kinds?.length ? inArray(schema.proposals.kind, kinds) : undefined,
  );
  if (action === "dismiss") { await db.update(schema.proposals).set({ status: "dismissed" }).where(where); return; }
  const rows = await db.select().from(schema.proposals).where(where).orderBy(asc(schema.proposals.createdAt));
  const rank = { module: 0, topic: 1, objective: 2, date: 3 } as const;
  rows.sort((a, b) => rank[a.kind] - rank[b.kind]);
  for (const p of rows) {
    await applyProposal(p);
    if (p.kind === "module") await autoMapDocuments(courseId);
  }
  await backfillModules(courseId);
}

export async function deleteCourse(userId: string, courseId: string): Promise<boolean> {
  const docs = await db.select({ storagePath: schema.sourceDocuments.storagePath }).from(schema.sourceDocuments)
    .where(and(eq(schema.sourceDocuments.courseId, courseId), eq(schema.sourceDocuments.userId, userId)));
  const res = await db.delete(schema.courses).where(and(eq(schema.courses.id, courseId), eq(schema.courses.userId, userId))).returning({ id: schema.courses.id });
  if (!res.length) return false;
  await Promise.all(docs.map((d) => removeFile(d.storagePath)));
  return true;
}

/** Deletes the account and, by cascade, every row that belongs to it, plus stored files. */
export async function deleteAccount(userId: string) {
  await db.delete(schema.users).where(eq(schema.users.id, userId));
  await removeUserFiles(userId);
}

export async function courseSummaries(userId: string) {
  const courses = await db.select().from(schema.courses).where(eq(schema.courses.userId, userId)).orderBy(desc(schema.courses.createdAt));
  return Promise.all(courses.map(async (c) => {
    const [plan] = await db.select({ examDate: schema.examPlans.examDate, moduleIds: schema.examPlans.moduleIds }).from(schema.examPlans).where(eq(schema.examPlans.courseId, c.id)).limit(1);
    const [docs] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.sourceDocuments).where(eq(schema.sourceDocuments.courseId, c.id));
    const recent = await db.select({ id: schema.sourceDocuments.id, title: schema.sourceDocuments.title, status: schema.sourceDocuments.status, createdAt: schema.sourceDocuments.createdAt })
      .from(schema.sourceDocuments).where(eq(schema.sourceDocuments.courseId, c.id)).orderBy(desc(schema.sourceDocuments.createdAt)).limit(3);
    const topics = await db.select({ id: schema.topics.id, moduleId: schema.topics.moduleId, score: schema.topicMastery.score, attempts: schema.topicMastery.attempts })
      .from(schema.topics).leftJoin(schema.topicMastery, and(eq(schema.topicMastery.topicId, schema.topics.id), eq(schema.topicMastery.userId, userId)))
      .where(eq(schema.topics.courseId, c.id));
    const scope = plan?.moduleIds.length ? topics.filter((t) => t.moduleId && plan.moduleIds.includes(t.moduleId)) : topics;
    const [answered] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.answers).where(and(eq(schema.answers.courseId, c.id), sql`${schema.answers.isCorrect} is not null`));
    return { course: c, examDate: plan?.examDate ?? c.examDate, examConfirmed: Boolean(plan), documentCount: docs?.n ?? 0, recent, scopeTopics: scope.map((t) => ({ score: t.score, attempts: t.attempts ?? 0 })), answered: answered?.n ?? 0 };
  }));
}

export async function pendingProposalCount(courseId: string): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.proposals).where(and(eq(schema.proposals.courseId, courseId), eq(schema.proposals.status, "pending")));
  return r?.n ?? 0;
}

