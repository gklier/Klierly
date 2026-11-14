import { and, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { AnswerResponse, ErrorReason } from "@/db/schema";
import { ERROR_REASONS } from "@/db/schema";
import { expandCitations, type CitationView } from "@/lib/citations";
import { grade, mulberry32, nextMastery, pickByQuota, pickQuestions, type PoolQuestion, type TopicState } from "./core";

export type Mode = "drill" | "exam" | "review";
type QuestionRow = typeof schema.questions.$inferSelect;

export type PublicQuestion = { id: string; type: "mcq" | "numeric"; stem: string; choices: string[] | null; unit: string | null; hasHint: boolean; topicId: string | null; topicName: string | null; difficulty: number };
export type Feedback = {
  answerId: string; isCorrect: boolean; correctIndex: number | null; correctValue: string | null; unit: string | null; explanation: string;
  citations: CitationView[]; grounding: "direct" | "extrapolated"; correctnessConfidence: string; explanationConfidence: string; origin: "ai" | "sample";
  errorReason: ErrorReason | null;
};

const displayValue = (v: string | null) => (v === null ? null : String(Number(Number(v).toPrecision(6))));

/** What the browser may see before answering: never the answer, explanation or hint text. */
const toPublic = (q: QuestionRow, topicName: string | null): PublicQuestion =>
  ({ id: q.id, type: q.type, stem: q.stem, choices: q.choices, unit: q.unit, hasHint: Boolean(q.hint), topicId: q.topicId, topicName, difficulty: q.difficulty });

async function feedbackFor(q: QuestionRow, a: { id: string; isCorrect: boolean | null; errorReason: ErrorReason | null }): Promise<Feedback> {
  const [citations] = await expandCitations([q.citations]);
  return {
    answerId: a.id, isCorrect: a.isCorrect === true, correctIndex: q.correctIndex, correctValue: displayValue(q.numericValue), unit: q.unit,
    explanation: q.explanation, citations, grounding: q.grounding, correctnessConfidence: q.correctnessConfidence,
    explanationConfidence: q.explanationConfidence, origin: q.origin, errorReason: a.errorReason,
  };
}

export async function questionPool(userId: string, courseId: string, topicIds?: string[]): Promise<PoolQuestion[]> {
  const filter = topicIds?.length ? sql`and q.topic_id in (${sql.join(topicIds.map((t) => sql`${t}::uuid`), sql`, `)})` : sql``;
  const res = await db.execute<{ id: string; topic_id: string | null; times_seen: number; last_at: Date | null; last_correct: boolean | null }>(sql`
    select q.id, q.topic_id,
      (select count(*)::int from answers a where a.question_id = q.id and a.is_correct is not null) as times_seen,
      l.created_at as last_at, l.is_correct as last_correct
    from questions q
    left join lateral (select a.created_at, a.is_correct from answers a where a.question_id = q.id and a.is_correct is not null order by a.created_at desc limit 1) l on true
    where q.user_id = ${userId} and q.course_id = ${courseId} and q.status = 'active' ${filter}`);
  return res.rows.map((r) => ({ id: r.id, topicId: r.topic_id, timesSeen: r.times_seen, lastAnsweredAt: r.last_at ? new Date(r.last_at).getTime() : null, lastCorrect: r.last_correct }));
}

export async function masteryMap(userId: string, courseId: string): Promise<Map<string, TopicState>> {
  const rows = await db.select().from(schema.topicMastery).where(and(eq(schema.topicMastery.userId, userId), eq(schema.topicMastery.courseId, courseId)));
  return new Map(rows.map((r) => [r.topicId, { score: r.score, attempts: r.attempts, nextReviewAt: r.nextReviewAt.getTime() }]));
}

export async function startSession(opts: { userId: string; courseId: string; mode: Mode; count: number; topicIds?: string[]; minutes?: number; planSessionId?: string | null; seed?: number; quota?: Map<string, number> }):
  Promise<{ ok: true; sessionId: string } | { ok: false; message: string }> {
  const pool = await questionPool(opts.userId, opts.courseId, opts.topicIds);
  const count = Math.min(Math.max(1, opts.count), 60);
  const rng = mulberry32(opts.seed ?? Date.now());
  const ids = opts.quota && opts.mode === "exam"
    ? pickByQuota(pool, opts.quota, count, rng)
    : pickQuestions(pool, await masteryMap(opts.userId, opts.courseId), opts.mode, count, rng, Date.now());
  if (!ids.length) {
    return { ok: false, message: opts.mode === "review"
      ? "Nothing to review yet. Missed questions and topics that are due for spaced review appear here."
      : "There are no practice questions for this selection yet." };
  }
  const [row] = await db.insert(schema.practiceSessions).values({
    userId: opts.userId, courseId: opts.courseId, mode: opts.mode, questionIds: ids,
    timeLimitSec: opts.mode === "exam" ? Math.round((opts.minutes ?? Math.max(5, Math.round(ids.length * 1.5))) * 60) : null,
    planSessionId: opts.planSessionId ?? null,
  }).returning({ id: schema.practiceSessions.id });
  return { ok: true, sessionId: row.id };
}

async function loadOwned(userId: string, sessionId: string) {
  if (!/^[0-9a-f-]{36}$/.test(sessionId)) return null;
  const [s] = await db.select().from(schema.practiceSessions).where(and(eq(schema.practiceSessions.id, sessionId), eq(schema.practiceSessions.userId, userId))).limit(1);
  return s ?? null;
}

const GRACE_MS = 15_000;
const expired = (s: { timeLimitSec: number | null; startedAt: Date }) => s.timeLimitSec !== null && Date.now() > s.startedAt.getTime() + s.timeLimitSec * 1000 + GRACE_MS;

export type SessionView = {
  id: string; courseId: string; mode: Mode; status: "active" | "submitted"; startedAt: string; submittedAt: string | null; timeLimitSec: number | null;
  correctCount: number | null; questions: PublicQuestion[];
  answers: Record<string, { response: AnswerResponse; timeMs: number; hintUsed: boolean; feedback: Feedback | null }>;
};

/**
 * Session state for the browser. Feedback (correct answer, explanation,
 * citations) is included only for answers that have been graded: immediately
 * in drill/review, and only after submission in a timed exam.
 */
export async function getSessionView(userId: string, sessionId: string): Promise<SessionView | null> {
  let s = await loadOwned(userId, sessionId);
  if (!s) return null;
  if (s.status === "active" && s.mode === "exam" && expired(s)) { await finishSession(userId, sessionId); s = (await loadOwned(userId, sessionId))!; }
  const rows = await db.select({ q: schema.questions, topicName: schema.topics.name }).from(schema.questions)
    .leftJoin(schema.topics, eq(schema.topics.id, schema.questions.topicId)).where(inArray(schema.questions.id, s.questionIds));
  const byId = new Map(rows.map((r) => [r.q.id, r]));
  const ans = await db.select().from(schema.answers).where(eq(schema.answers.sessionId, s.id));
  const answers: SessionView["answers"] = {};
  for (const a of ans) {
    const q = byId.get(a.questionId)?.q;
    const reveal = q && a.isCorrect !== null && (s.mode !== "exam" || s.status === "submitted");
    answers[a.questionId] = { response: a.response, timeMs: a.timeMs, hintUsed: a.hintUsed, feedback: reveal ? await feedbackFor(q, a) : null };
  }
  return {
    id: s.id, courseId: s.courseId, mode: s.mode, status: s.status, startedAt: s.startedAt.toISOString(), submittedAt: s.submittedAt?.toISOString() ?? null,
    timeLimitSec: s.timeLimitSec, correctCount: s.correctCount,
    questions: s.questionIds.map((id) => byId.get(id)).filter((r): r is NonNullable<typeof r> => Boolean(r)).map((r) => toPublic(r.q, r.topicName)),
    answers,
  };
}

async function applyMastery(userId: string, courseId: string, topicId: string | null, correct: boolean, hintUsed: boolean) {
  if (!topicId) return;
  const [prev] = await db.select().from(schema.topicMastery).where(and(eq(schema.topicMastery.userId, userId), eq(schema.topicMastery.topicId, topicId))).limit(1);
  const next = nextMastery(prev ?? null, correct, hintUsed, new Date());
  await db.insert(schema.topicMastery).values({ userId, topicId, courseId, ...next, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [schema.topicMastery.userId, schema.topicMastery.topicId], set: { ...next, updatedAt: new Date() } });
}

function cleanResponse(q: QuestionRow, r: AnswerResponse): AnswerResponse | null {
  if (q.type === "mcq") return Number.isInteger(r.choice) && r.choice! >= 0 && r.choice! < (q.choices?.length ?? 0) ? { choice: r.choice } : null;
  return typeof r.value === "string" && r.value.trim() && r.value.length <= 40 ? { value: r.value.trim() } : null;
}

export type AnswerResult = { ok: true; feedback: Feedback | null } | { ok: false; message: string };

/**
 * Record an answer. Drill/review: graded at once, first answer is final.
 * Timed exam: stored ungraded, may be changed until submission; nothing about
 * correctness is returned.
 */
export async function submitAnswer(userId: string, sessionId: string, questionId: string, response: AnswerResponse, timeMs: number, hintUsed: boolean): Promise<AnswerResult> {
  const s = await loadOwned(userId, sessionId);
  if (!s || !s.questionIds.includes(questionId)) return { ok: false, message: "That question is not part of this session." };
  if (s.status !== "active") return { ok: false, message: "This session has already been submitted." };
  if (s.mode === "exam" && expired(s)) { await finishSession(userId, sessionId); return { ok: false, message: "Time is up. The exam was submitted." }; }
  const [q] = await db.select().from(schema.questions).where(and(eq(schema.questions.id, questionId), eq(schema.questions.userId, userId))).limit(1);
  if (!q) return { ok: false, message: "That question no longer exists." };
  const clean = cleanResponse(q, response);
  if (!clean) return { ok: false, message: q.type === "mcq" ? "Choose one of the options." : "Enter a number." };
  const time = Math.min(Math.max(0, Math.round(timeMs) || 0), 3_600_000);

  if (s.mode === "exam") {
    await db.insert(schema.answers).values({ userId, courseId: s.courseId, sessionId, questionId, topicId: q.topicId, response: clean, timeMs: time, isCorrect: null })
      .onConflictDoUpdate({ target: [schema.answers.sessionId, schema.answers.questionId], set: { response: clean, timeMs: sql`${schema.answers.timeMs} + ${time}` } });
    return { ok: true, feedback: null };
  }
  const isCorrect = grade(q, clean);
  const inserted = await db.insert(schema.answers).values({ userId, courseId: s.courseId, sessionId, questionId, topicId: q.topicId, response: clean, timeMs: time, hintUsed, isCorrect })
    .onConflictDoNothing().returning();
  if (!inserted.length) {
    const [existing] = await db.select().from(schema.answers).where(and(eq(schema.answers.sessionId, sessionId), eq(schema.answers.questionId, questionId))).limit(1);
    return { ok: true, feedback: await feedbackFor(q, existing) };
  }
  await applyMastery(userId, s.courseId, q.topicId, isCorrect, hintUsed);
  return { ok: true, feedback: await feedbackFor(q, inserted[0]) };
}

/** Hints are available in drill/review only; a mock exam gives no help. */
export async function getHint(userId: string, sessionId: string, questionId: string): Promise<string | null> {
  const s = await loadOwned(userId, sessionId);
  if (!s || s.mode === "exam" || !s.questionIds.includes(questionId)) return null;
  const [q] = await db.select({ hint: schema.questions.hint }).from(schema.questions).where(eq(schema.questions.id, questionId)).limit(1);
  return q?.hint ?? null;
}

/** Close a session. For a timed exam this is the moment everything is graded. */
export async function finishSession(userId: string, sessionId: string): Promise<boolean> {
  const claimed = await db.update(schema.practiceSessions).set({ status: "submitted", submittedAt: new Date() })
    .where(and(eq(schema.practiceSessions.id, sessionId), eq(schema.practiceSessions.userId, userId), eq(schema.practiceSessions.status, "active"))).returning();
  const s = claimed[0];
  if (!s) return false;
  if (s.mode === "exam") {
    const qs = await db.select().from(schema.questions).where(inArray(schema.questions.id, s.questionIds));
    const given = new Map((await db.select().from(schema.answers).where(eq(schema.answers.sessionId, s.id))).map((a) => [a.questionId, a]));
    for (const q of qs) {
      const a = given.get(q.id);
      const isCorrect = a ? grade(q, a.response) : false;
      if (a) await db.update(schema.answers).set({ isCorrect }).where(eq(schema.answers.id, a.id));
      else await db.insert(schema.answers).values({ userId, courseId: s.courseId, sessionId: s.id, questionId: q.id, topicId: q.topicId, response: {}, isCorrect: false, timeMs: 0 });
      await applyMastery(userId, s.courseId, q.topicId, isCorrect, false);
    }
  }
  const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.answers).where(and(eq(schema.answers.sessionId, s.id), eq(schema.answers.isCorrect, true)));
  await db.update(schema.practiceSessions).set({ correctCount: c?.n ?? 0 }).where(eq(schema.practiceSessions.id, s.id));
  if (s.planSessionId) {
    await db.update(schema.planSessions).set({ status: "done", completedAt: new Date() })
      .where(and(eq(schema.planSessions.id, s.planSessionId), eq(schema.planSessions.userId, userId)));
  }
  return true;
}

export async function tagError(userId: string, answerId: string, reason: string): Promise<boolean> {
  if (!ERROR_REASONS.includes(reason as ErrorReason)) return false;
  const res = await db.update(schema.answers).set({ errorReason: reason as ErrorReason })
    .where(and(eq(schema.answers.id, answerId), eq(schema.answers.userId, userId), eq(schema.answers.isCorrect, false))).returning({ id: schema.answers.id });
  return res.length > 0;
}

/** Reported questions leave the pool immediately and are kept for review. */
export async function reportQuestion(userId: string, questionId: string, reason: string): Promise<boolean> {
  const res = await db.update(schema.questions).set({ status: "reported" })
    .where(and(eq(schema.questions.id, questionId), eq(schema.questions.userId, userId))).returning({ id: schema.questions.id });
  if (!res.length) return false;
  await db.insert(schema.questionReports).values({ userId, questionId, reason: reason.trim().slice(0, 500) || "No reason given" });
  return true;
}
