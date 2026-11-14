import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LearnNoteBody } from "@/db/schema";
import { chunksForTopic, toOrQuery, type RetrievedChunk } from "@/lib/retrieval";
import { isTopicHeading } from "@/lib/ingest/proposals";
import { compute, numericFunctions } from "@/lib/worker";
import { AiError, aiStatus, chatJson } from "./provider";
import { env } from "@/lib/env";
import { logActivity } from "@/lib/activity";
import { supplementSystemPrompt, supplementUserPrompt, learnSystemPrompt, learnUserPrompt, questionSystemPrompt, questionUserPrompt, renderSources, topicSystemPrompt, topicUserPrompt } from "./prompt";
import { supplementSchema, generationSchema, isDuplicate, learnSchema, resolveCitations, shuffleChoices, topicsSchema, validateQuestion } from "./validate";

export type TopicResult = { topicId: string; topicName: string; added: number; rejected: string[]; insufficient: string | null; /** Set when generation had to stop here (limit reached, provider error). Earlier topics keep their questions. */ stopped?: string };

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
async function generateQuestionsRun(opts: { userId: string; courseId: string; topicIds: string[]; perTopic: number; maxRounds?: number }): Promise<TopicResult[]> {
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
      let out: unknown;
      try {
        out = await chatJson(opts.userId, "questions", system, questionUserPrompt({ courseName: course.name, topicName: topic.name, count: need, sources, avoid, feedback }), { tier: round === 0 ? "routine" : "strong" });
      } catch (e) {
        // Nothing saved yet at all: surface the error. Otherwise keep what was added and say why it stopped.
        if (!(e instanceof AiError) || results.every((r) => r.added === 0)) throw e;
        result.stopped = e.message;
        return results;
      }
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

export async function generateQuestions(opts: { userId: string; courseId: string; topicIds: string[]; perTopic: number; maxRounds?: number }): Promise<TopicResult[]> {
  const results = await generateQuestionsRun(opts);
  const reasons = new Map<string, number>();
  for (const r of results) for (const why of r.rejected) reasons.set(why.replace(/\([^)]*\)/g, "()").slice(0, 100), (reasons.get(why.replace(/\([^)]*\)/g, "()").slice(0, 100)) ?? 0) + 1);
  await logActivity(opts.userId, "ai.questions", { courseId: opts.courseId, details: {
    added: results.reduce((n, r) => n + r.added, 0), rejected: results.reduce((n, r) => n + r.rejected.length, 0),
    topics: results.map((r) => ({ name: r.topicName, added: r.added, rejected: r.rejected.length, thin: r.insufficient ? true : undefined, stopped: r.stopped ? true : undefined })),
    rejectedBecause: [...reasons].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([why, n]) => `${n}× ${why}`),
  } });
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

const normTopic = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Ask the AI to organise the course's material into study topics. One small
 * request: a spread of short excerpts (with their headings) from every
 * document. Results are stored as suggestions for the student to review —
 * nothing is applied automatically — and each must point at a provided
 * excerpt and be findable in the material, or it is dropped.
 */
export async function proposeTopics(opts: { userId: string; courseId: string }): Promise<{ ok: true; proposed: number; dropped: number } | { ok: false; reason: string }> {
  const course = await loadCourse(opts.userId, opts.courseId);
  const rows = await db.select({
    id: schema.sourceChunks.id, documentId: schema.sourceChunks.documentId, ordinal: schema.sourceChunks.ordinal, kind: schema.sourceChunks.kind, text: schema.sourceChunks.text,
    heading: schema.sourceChunks.heading, page: schema.sourceChunks.page, slide: schema.sourceChunks.slide, tStartMs: schema.sourceChunks.tStartMs, tEndMs: schema.sourceChunks.tEndMs,
    documentTitle: schema.sourceDocuments.title, moduleId: schema.sourceDocuments.moduleId,
  }).from(schema.sourceChunks).innerJoin(schema.sourceDocuments, eq(schema.sourceDocuments.id, schema.sourceChunks.documentId))
    .where(and(eq(schema.sourceChunks.courseId, opts.courseId), eq(schema.sourceChunks.userId, opts.userId), eq(schema.sourceDocuments.status, "ready"), eq(schema.sourceChunks.kind, "text")))
    .orderBy(asc(schema.sourceChunks.documentId), asc(schema.sourceChunks.ordinal));
  if (!rows.length) return { ok: false, reason: "Import some material first." };
  // An even spread across the course, at most 36 excerpts of 320 characters: enough to see the subjects, cheap to send.
  const step = Math.max(1, Math.ceil(rows.length / 36));
  const sample: RetrievedChunk[] = rows.filter((_, i) => i % step === 0).slice(0, 36)
    .map((r) => ({ ...r, text: `${r.heading ? `[${r.heading}] ` : ""}${r.text}`.slice(0, 320), rank: 0 }));
  const existing = (await db.select({ name: schema.topics.name }).from(schema.topics).where(eq(schema.topics.courseId, opts.courseId))).map((t) => t.name);
  const out = await chatJson(opts.userId, "topics", topicSystemPrompt, topicUserPrompt({ courseName: course.name, existing, sources: renderSources(sample) }), { maxTokens: 1200 });
  const parsed = topicsSchema.safeParse(out);
  if (!parsed.success) throw new AiError("bad_output", "The AI returned topics in an unexpected format. Try again.");
  if (parsed.data.insufficient && !parsed.data.topics.length) return { ok: false, reason: parsed.data.reason || "The material is too thin to suggest topics." };

  const seen = new Set(existing.map(normTopic));
  let proposed = 0, dropped = 0;
  const accepted: { name: string; chunk: RetrievedChunk }[] = [];
  for (const t of parsed.data.topics) {
    const name = t.name.replace(/\s+/g, " ").trim();
    const key = normTopic(name);
    const cited = t.sources.map((s) => /^\[?S(\d{1,2})\]?$/i.exec(s.trim())).map((m) => (m ? sample[Number(m[1]) - 1] : undefined)).find(Boolean);
    const q = toOrQuery(name);
    const found = q ? await db.execute(sql`select 1 from source_chunks where course_id = ${opts.courseId} and user_id = ${opts.userId} and tsv @@ to_tsquery('english', ${q}) limit 1`) : null;
    // Must be a real subject, new, tied to an excerpt that was actually provided, and present in the material.
    if (!isTopicHeading(name) || seen.has(key) || !cited || !found?.rowCount) { dropped++; continue; }
    seen.add(key);
    accepted.push({ name, chunk: cited }); // its module comes from the cited document when the suggestion is accepted
  }
  if (!accepted.length) return { ok: false, reason: "The AI's suggestions could not be tied to your material, so none were kept." };
  await db.transaction(async (tx) => {
    // Heading-based guesses that were never accepted are superseded by this pass.
    await tx.update(schema.proposals).set({ status: "dismissed" }).where(and(eq(schema.proposals.courseId, opts.courseId), eq(schema.proposals.kind, "topic"), eq(schema.proposals.status, "pending")));
    for (const a of accepted) {
      const res = await tx.insert(schema.proposals).values({
        userId: opts.userId, courseId: opts.courseId, kind: "topic", payload: { kind: "topic", name: a.name, documentId: a.chunk.documentId, via: "ai" },
        dedupeKey: normTopic(a.name).slice(0, 200), evidenceChunkId: a.chunk.id, status: "pending",
      }).onConflictDoUpdate({ target: [schema.proposals.courseId, schema.proposals.kind, schema.proposals.dedupeKey], set: { status: "pending", evidenceChunkId: a.chunk.id, payload: { kind: "topic", name: a.name, documentId: a.chunk.documentId, via: "ai" } } }).returning({ id: schema.proposals.id });
      if (res.length) proposed++;
    }
  });
  await logActivity(opts.userId, "ai.topics", { courseId: opts.courseId, details: { proposed, dropped } });
  return { ok: true, proposed, dropped };
}

/**
 * "What your notes leave out": AI-written explanation of gaps around a topic, from general knowledge.
 * It is NOT course material: stored and shown separately, always labelled, never cited, never used to
 * write practice questions, and kept free of numeric claims by the prompt (which cannot be verified here).
 */
export async function generateSupplement(opts: { userId: string; courseId: string; topicId: string }): Promise<{ ok: true } | { ok: false; reason: string }> {
  const course = await loadCourse(opts.userId, opts.courseId);
  const [topic] = await db.select().from(schema.topics)
    .where(and(eq(schema.topics.id, opts.topicId), eq(schema.topics.courseId, opts.courseId), eq(schema.topics.userId, opts.userId))).limit(1);
  if (!topic) throw new Error("Topic not found.");
  const chunks = await chunksForTopic({ userId: opts.userId, courseId: opts.courseId, topicName: topic.name, moduleId: topic.moduleId, limit: 6 });
  if (!chunks.length) return { ok: false, reason: "No imported material mentions this topic yet, so there is nothing to find gaps in. Import the notes or lecture first." };
  const out = await chatJson(opts.userId, "supplement", supplementSystemPrompt, supplementUserPrompt({ courseName: course.name, topicName: topic.name, sources: renderSources(chunks) }), { cache: true, maxTokens: 1800 });
  const parsed = supplementSchema.safeParse(out);
  if (!parsed.success) throw new AiError("bad_output", "The AI returned the explanation in an unexpected format. Try again.");
  const st = await aiStatus(opts.userId);
  const model = st.kind === "byok" ? st.model : env.managedAi?.model ?? "unknown";
  await db.insert(schema.learnSupplements).values({ userId: opts.userId, courseId: opts.courseId, topicId: topic.id, body: parsed.data, model })
    .onConflictDoUpdate({ target: schema.learnSupplements.topicId, set: { body: parsed.data, model, createdAt: new Date() } });
  await logActivity(opts.userId, "ai.supplement", { courseId: opts.courseId, details: { topic: topic.name, gaps: parsed.data.gaps.length } });
  return { ok: true };
}
