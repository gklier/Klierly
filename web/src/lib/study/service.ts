import { randomInt } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Citation } from "@/db/schema";
import { expandCitations, type CitationView } from "@/lib/citations";
import { ownsCourse } from "@/lib/courses";
import { grade, mulberry32 } from "@/lib/practice/core";
import { addReviewTurn, angleCoverage, buildStudyState, shuffle, stableSeed, topicsNeedingReview, type StudyAngle, type StudyMode, type StudyTask } from "./core";

type Question = typeof schema.questions.$inferSelect;
export type TopicPack = { id: string; name: string; moduleId: string | null; moduleName: string | null; reference: string; keyPoints: string[]; citations: Citation[]; questions: Question[]; origin: string };
export async function studyPacks(userId: string, courseId: string): Promise<TopicPack[]> {
  if (!await ownsCourse(userId, courseId)) return [];
  const [topics, questions] = await Promise.all([
    db.select({ topic: schema.topics, moduleName: schema.modules.name, note: schema.learnNotes, text: sql<string | null>`left(${schema.sourceChunks.text},1600)`, documentId: schema.sourceChunks.documentId, chunkId: schema.sourceChunks.id })
      .from(schema.topics).leftJoin(schema.modules, eq(schema.modules.id, schema.topics.moduleId))
      .leftJoin(schema.learnNotes, and(eq(schema.learnNotes.topicId, schema.topics.id), eq(schema.learnNotes.userId, userId)))
      .leftJoin(schema.sourceChunks, and(eq(schema.sourceChunks.id, schema.topics.evidenceChunkId), eq(schema.sourceChunks.userId, userId), eq(schema.sourceChunks.courseId, courseId)))
      .where(and(eq(schema.topics.userId, userId), eq(schema.topics.courseId, courseId))).orderBy(asc(schema.modules.position), asc(schema.topics.position)).limit(400),
    db.select().from(schema.questions).where(and(eq(schema.questions.userId, userId), eq(schema.questions.courseId, courseId), eq(schema.questions.status, "active"))).orderBy(desc(schema.questions.createdAt)).limit(2000),
  ]);
  return topics.map((r): TopicPack => {
    const qs = questions.filter((q) => q.topicId === r.topic.id);
    const reference = r.note?.body.summary || r.text || qs[0]?.explanation || "";
    const citations = r.note ? r.note.body.keyPoints.flatMap((k) => k.citations).slice(0, 4)
      : r.chunkId && r.documentId ? [{ chunkId: r.chunkId, documentId: r.documentId, quote: "", quoteVerified: false }]
      : qs[0]?.citations ?? [];
    return { id: r.topic.id, name: r.topic.name, moduleId: r.topic.moduleId, moduleName: r.moduleName, reference,
      keyPoints: r.note?.body.keyPoints.map((k) => k.text) ?? [], citations, questions: qs,
      origin: r.note ? r.note.origin === "sample" ? "Sample course study note" : "AI study note · check the sources" : r.text ? "Excerpt from your course material" : "Explanation from your question bank" };
  }).filter((p) => p.reference.trim().length > 20);
}

export type StudyCardView = { key: string; topicId: string; topicName: string | null; angle: StudyAngle; prompt: string; context?: string; choices?: string[]; numeric: boolean; selfRated: boolean; repeated: boolean; answer?: string; detail?: string; origin?: string; citations?: CitationView[]; outcome?: { correct: boolean; selfRated: boolean } };
export type StudyView = { id: string; courseId: string; mode: StudyMode; status: string; position: number; total: number; card: StudyCardView | null; completed: number; objectiveCorrect: number; objectiveTotal: number; selfRemembered: number; selfTotal: number; concepts: { id: string; name: string; angles: StudyAngle[]; needsWork: boolean }[] };
function cardContent(task: StudyTask, packs: TopicPack[]) {
  const topic = packs.find((p) => p.id === task.topicId);
  if (!topic) return null;
  const q = task.questionId ? topic.questions.find((q) => q.id === task.questionId) : null;
  if (task.angle === "apply" && !q) return null;
  const rng = mulberry32(stableSeed(task.key));
  const distractors = [...new Map(packs.filter(p => p.name.trim().toLowerCase() !== topic.name.trim().toLowerCase()).map(p => [p.name.trim().toLowerCase(), p])).values()];
  const choices = task.angle === "identify" && distractors.length ? shuffle([topic, ...shuffle(distractors, rng).slice(0, 3)], rng).map((p) => p.name)
    : q?.choices ? shuffle(q.choices.map((text, original) => ({ text, original })), rng).map((c) => c.text) : undefined;
  const prompt = task.angle === "recall" ? `What does ${topic.name} mean? Explain it before turning the card.`
    : task.angle === "identify" ? "Which concept does this course explanation describe?"
    : task.angle === "explain" ? `Explain ${topic.name} to someone new to it. How would you use it, and what should they be careful about?`
    : q!.stem;
  const answer = task.angle === "identify" ? topic.name : q ? q.type === "numeric" ? `${q.numericValue}${q.unit ? ` ${q.unit}` : ""}` : q.choices?.[q.correctIndex!] ?? "" : topic.reference;
  return { topic, q, choices, prompt, answer, selfRated: task.angle === "recall" || task.angle === "explain" || task.angle === "identify" && !choices };
}

export async function recentStudy(userId: string, courseId: string) {
  return db.select().from(schema.studySessions).where(and(eq(schema.studySessions.userId, userId), eq(schema.studySessions.courseId, courseId))).orderBy(desc(schema.studySessions.updatedAt)).limit(12);
}

export async function startStudy(userId: string, courseId: string, mode: StudyMode, count: number, topicIds: string[], moduleIds: string[]) {
  const packs = await studyPacks(userId, courseId);
  let eligible = packs.filter((p) => (!topicIds.length || topicIds.includes(p.id)) && (!moduleIds.length || p.moduleId && moduleIds.includes(p.moduleId)));
  if (!eligible.length) return { error: "No study references are available for this selection. Import material and accept topics, or generate a study note from Practice → Learn." };
  const scopeTopicIds = eligible.map(p => p.id);
  const recent = await recentStudy(userId, courseId);
  const misses = topicsNeedingReview([...recent].reverse().flatMap((s) => s.state.outcomes));
  const seen = new Set(recent.flatMap((s) => s.state.outcomes.map((o) => o.topicId)));
  const rng = mulberry32(randomInt(0, 0x7fffffff));
  eligible = shuffle(eligible, rng).sort((a, b) => Number(misses.has(b.id)) - Number(misses.has(a.id)) || Number(seen.has(a.id)) - Number(seen.has(b.id))).slice(0, Math.max(1, Math.min(6, count)));
  const state = buildStudyState(eligible.map((p) => ({ id: p.id, questionIds: p.questions.map((q) => q.id) })), mode, rng);
  state.scopeTopicIds = scopeTopicIds;
  const id = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${userId}),hashtext(${courseId}))`);
    await tx.update(schema.studySessions).set({ status: "ended", updatedAt: new Date() }).where(and(eq(schema.studySessions.userId, userId), eq(schema.studySessions.courseId, courseId), eq(schema.studySessions.status, "active")));
    const [s] = await tx.insert(schema.studySessions).values({ userId, courseId, mode, state }).returning({ id: schema.studySessions.id });
    return s.id;
  });
  return { id };
}

export async function studyView(userId: string, sessionId: string): Promise<StudyView | null> {
  if (!/^[0-9a-f-]{36}$/.test(sessionId)) return null;
  const [session] = await db.select().from(schema.studySessions).where(and(eq(schema.studySessions.id, sessionId), eq(schema.studySessions.userId, userId)));
  if (!session || !await ownsCourse(userId, session.courseId)) return null;
  const packs = await studyPacks(userId, session.courseId);
  const state = session.state, task = state.queue[state.position], content = task ? cardContent(task, packs.filter(p => !state.scopeTopicIds || state.scopeTopicIds.includes(p.id))) : null;
  const outcome = task ? state.outcomes.find((o) => o.key === task.key) : undefined;
  const revealed = Boolean(state.revealed || outcome);
  let card: StudyCardView | null = null;
  if (task && content && session.status === "active") {
    const { topic, q } = content;
    card = { key: task.key, topicId: task.topicId, topicName: task.angle === "identify" && !revealed ? null : topic.name,
      angle: task.angle, prompt: content.prompt, ...(task.angle === "identify" ? { context: topic.reference.replaceAll(new RegExp(topic.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[…] ") } : {}),
      choices: content.choices, numeric: q?.type === "numeric", selfRated: content.selfRated, repeated: task.repeat,
      ...(revealed ? { answer: content.answer, detail: q?.explanation || (task.angle === "explain" ? topic.keyPoints.join("\n\n") : ""), origin: q ? `${q.origin === "sample" ? "Sample" : "AI-generated"} question · ${q.correctnessConfidence === "model-asserted" ? "answer not independently verified" : "answer checked"}` : topic.origin,
        citations: (await expandCitations([q?.citations ?? topic.citations]))[0], outcome } : {}),
    };
  }
  const coverage = angleCoverage(state.outcomes);
  const concepts = [...new Set(state.queue.map((t) => t.topicId))].map((id) => ({ id, name: packs.find((p) => p.id === id)?.name ?? "Topic removed", angles: [...(coverage.get(id) ?? [])], needsWork: topicsNeedingReview(state.outcomes).has(id) }));
  return { id: session.id, courseId: session.courseId, mode: session.mode, status: session.status, position: state.position, total: state.queue.length, card, completed: state.outcomes.length,
    objectiveCorrect: state.outcomes.filter((o) => !o.selfRated && o.correct).length, objectiveTotal: state.outcomes.filter((o) => !o.selfRated).length,
    selfRemembered: state.outcomes.filter((o) => o.selfRated && o.correct).length, selfTotal: state.outcomes.filter((o) => o.selfRated).length, concepts };
}

export type StudyMove = { kind: "reveal" } | { kind: "answer"; choice?: number; value?: string; rating?: "again" | "remembered" } | { kind: "next" };
export async function moveStudy(userId: string, sessionId: string, taskKey: string, move: StudyMove): Promise<{ ok: boolean; message?: string }> {
  const [s] = await db.select().from(schema.studySessions).where(and(eq(schema.studySessions.id, sessionId), eq(schema.studySessions.userId, userId)));
  if (!s || !await ownsCourse(userId, s.courseId)) return { ok: false, message: "That study round was not found." };
  const packs = await studyPacks(userId, s.courseId);
  return db.transaction(async (tx) => {
    const [session] = await tx.select().from(schema.studySessions).where(and(eq(schema.studySessions.id, sessionId), eq(schema.studySessions.userId, userId))).for("update");
    if (!session || session.status !== "active") return { ok: false, message: "This round has ended. Start a fresh round." };
    const state = session.state, task = state.queue[state.position];
    if (!task || task.key !== taskKey) return { ok: false, message: "This card changed on another device. Reload to continue." };
    const content = cardContent(task, packs.filter(p => !state.scopeTopicIds || state.scopeTopicIds.includes(p.id))), existing = state.outcomes.find((o) => o.key === task.key);
    if (move.kind === "next") {
      if (content && !existing) return { ok: false, message: "Answer or review the card first." };
      state.position++; state.revealed = false;
    } else if (!content) return { ok: false, message: "This source or question was removed. Skip to the next card." };
    else if (move.kind === "reveal") {
      if (!content.selfRated) return { ok: false, message: "Try the question before viewing the answer." };
      state.revealed = true;
    } else if (!existing) {
      let correct: boolean;
      if (content.selfRated) {
        if (!state.revealed || !["again", "remembered"].includes(move.rating ?? "")) return { ok: false, message: "Turn the card and compare your answer first." };
        correct = move.rating === "remembered";
      } else {
        if (content.choices && (!Number.isInteger(move.choice) || move.choice! < 0 || move.choice! >= content.choices.length)) return { ok: false, message: "Choose an answer." };
        if (content.q?.type === "numeric" && (typeof move.value !== "string" || !move.value.trim() || move.value.length > 40)) return { ok: false, message: "Enter a number." };
        correct = task.angle === "identify" ? content.choices![move.choice!] === content.topic.name
          : content.q!.type === "mcq" ? content.choices![move.choice!] === content.q!.choices![content.q!.correctIndex!]
          : grade(content.q!, { value: move.value });
      }
      state.outcomes.push({ key: task.key, topicId: task.topicId, angle: task.angle, correct, selfRated: content.selfRated });
      state.revealed = true;
      if (!correct) state.queue = addReviewTurn(state, task, { id: task.topicId, questionIds: content.topic.questions.map((q) => q.id) });
    }
    await tx.update(schema.studySessions).set({ state, updatedAt: new Date(), status: state.position >= state.queue.length ? "completed" : "active" }).where(eq(schema.studySessions.id, sessionId));
    return { ok: true };
  });
}
