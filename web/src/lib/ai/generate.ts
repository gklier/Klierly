import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LearnNoteBody } from "@/db/schema";
import { chunksForTopic } from "@/lib/retrieval";
import { compute, numericFunctions } from "@/lib/worker";
import { AiError, chatJson } from "./provider";
import { learnSystemPrompt, learnUserPrompt, questionSystemPrompt, questionUserPrompt, renderSources } from "./prompt";
import { generationSchema, isDuplicate, learnSchema, resolveCitations, shuffleChoices, validateQuestion } from "./validate";

export type TopicResult = { topicId: string; topicName: string; added: number; rejected: string[]; insufficient: string | null };

async function loadCourse(userId: string, courseId: string) {
  const [course] = await db.select().from(schema.courses).where(and(eq(schema.courses.id, courseId), eq(schema.courses.userId, userId))).limit(1);
  if (!course) throw new Error("Course not found.");
  if (!course.allowExternalAi) throw new AiError("course_disallows_ai", "This course is set to keep materials away from external AI providers. Change it in the course settings if your course rules allow it.");
  return course;
}

/**
 * Generate original, source-grounded questions for the given topics.
 * Each topic gets its own small prompt (retrieved excerpts only, never whole
 * documents). Invalid output is rejected and retried up to `maxRounds` times
 * with the rejection reasons fed back.
 */
export async function generateQuestions(opts: { userId: string; courseId: string; topicIds: string[]; perTopic: number; maxRounds?: number }): Promise<TopicResult[]> {
  const course = await loadCourse(opts.userId, opts.courseId);
  const topics = await db.select().from(schema.topics)
    .where(and(eq(schema.topics.courseId, opts.courseId), eq(schema.topics.userId, opts.userId), inArray(schema.topics.id, opts.topicIds)));
  const fns = await numericFunctions();
  const allowed = new Set(fns.map((f) => f.name));
  const system = questionSystemPrompt(fns);
  const computeFn = async (fn: string, args: Record<string, unknown>) => (await compute(fn, args)).value;
  const existing = await db.select({ fingerprint: schema.questions.fingerprint, stem: schema.questions.stem, topicId: schema.questions.topicId })
    .from(schema.questions).where(eq(schema.questions.courseId, opts.courseId)).orderBy(desc(schema.questions.createdAt));
  const fingerprints = existing.map((e) => e.fingerprint);
  const results: TopicResult[] = [];

  for (const topic of topics) {
    const result: TopicResult = { topicId: topic.id, topicName: topic.name, added: 0, rejected: [], insufficient: null };
    results.push(result);
    const chunks = await chunksForTopic({ userId: opts.userId, courseId: opts.courseId, topicName: topic.name, moduleId: topic.moduleId, limit: 6 });
    if (!chunks.length) { result.insufficient = "No imported material mentions this topic yet."; continue; }
    const sources = renderSources(chunks);
    const avoid = existing.filter((e) => e.topicId === topic.id).slice(0, 12).map((e) => e.stem);
    let feedback: string[] = [];

    for (let round = 0; round < (opts.maxRounds ?? 2) && result.added < opts.perTopic; round++) {
      const need = opts.perTopic - result.added;
      // Routine (cheaper) model first; a retry after rejected drafts is the one place a stronger model is justified.
      const out = await chatJson(opts.userId, "questions", system, questionUserPrompt({ courseName: course.name, topicName: topic.name, count: need, sources, avoid, feedback }), { tier: round === 0 ? "routine" : "strong" });
      const parsed = generationSchema.safeParse(out);
      if (!parsed.success) { feedback = ["The response was not the required JSON object."]; result.rejected.push(feedback[0]); continue; }
      if (parsed.data.insufficient && !parsed.data.questions.length) {
        result.insufficient = parsed.data.reason || "The AI reported that the imported material does not contain enough about this topic.";
        break;
      }
      feedback = [];
      for (const raw of parsed.data.questions) {
        if (result.added >= opts.perTopic) break;
        const verdict = await validateQuestion(raw, chunks, computeFn, allowed);
        if (!verdict.ok) { feedback.push(verdict.reason); result.rejected.push(verdict.reason); continue; }
        const q = verdict.question;
        if (isDuplicate(q.fingerprint, fingerprints)) { const r = "A question duplicated one already in the bank."; feedback.push(r); result.rejected.push(r); continue; }
        const shuffled = q.type === "mcq" ? shuffleChoices(q.choices!, q.correctIndex!, q.fingerprint) : null;
        await db.insert(schema.questions).values({
          userId: opts.userId, courseId: opts.courseId, topicId: topic.id, type: q.type, stem: q.stem,
          choices: shuffled?.choices ?? null, correctIndex: shuffled?.correctIndex ?? null,
          numericValue: q.numericValue !== null ? String(q.numericValue) : null, tolerance: q.tolerance !== null ? String(q.tolerance) : null,
          unit: q.unit, hint: q.hint, explanation: q.explanation, citations: q.citations, grounding: q.grounding,
          correctnessConfidence: q.correctnessConfidence, explanationConfidence: q.explanationConfidence, check: q.check,
          difficulty: q.difficulty, origin: "ai", fingerprint: q.fingerprint,
        });
        fingerprints.push(q.fingerprint);
        avoid.unshift(q.stem);
        result.added++;
      }
      if (!feedback.length) break; // nothing to fix; do not spend another request
    }
  }
  return results;
}

/** Short source-grounded study note for Learn mode. Cached per topic; regenerate replaces it. */
export async function generateLearnNote(opts: { userId: string; courseId: string; topicId: string }): Promise<{ ok: true } | { ok: false; reason: string }> {
  const course = await loadCourse(opts.userId, opts.courseId);
  const [topic] = await db.select().from(schema.topics)
    .where(and(eq(schema.topics.id, opts.topicId), eq(schema.topics.courseId, opts.courseId), eq(schema.topics.userId, opts.userId))).limit(1);
  if (!topic) throw new Error("Topic not found.");
  const chunks = await chunksForTopic({ userId: opts.userId, courseId: opts.courseId, topicName: topic.name, moduleId: topic.moduleId, limit: 6 });
  if (!chunks.length) return { ok: false, reason: "No imported material mentions this topic yet." };
  const out = await chatJson(opts.userId, "learn-note", learnSystemPrompt, learnUserPrompt({ courseName: course.name, topicName: topic.name, sources: renderSources(chunks) }), { cache: true });
  const parsed = learnSchema.safeParse(out);
  if (!parsed.success) throw new AiError("bad_output", "The AI provider returned a study note in an unexpected format. Try again.");
  if (parsed.data.insufficient) return { ok: false, reason: parsed.data.reason || "The imported material does not contain enough about this topic." };
  const keyPoints = parsed.data.keyPoints
    .map((k) => ({ text: k.text, citations: resolveCitations(k.citations, chunks) }))
    .filter((k) => k.citations.length > 0); // a point without a real source is dropped, not shown uncited
  if (!keyPoints.length) return { ok: false, reason: "The AI's note did not cite the imported material, so it was discarded." };
  const body: LearnNoteBody = { summary: parsed.data.summary, keyPoints };
  await db.insert(schema.learnNotes).values({ userId: opts.userId, courseId: opts.courseId, topicId: topic.id, body, origin: "ai" })
    .onConflictDoUpdate({ target: schema.learnNotes.topicId, set: { body, origin: "ai", createdAt: new Date() } });
  return { ok: true };
}
