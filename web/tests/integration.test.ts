import fs from "node:fs/promises";
import path from "node:path";
import type http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db, getPool, schema } from "@/db";
import { encryptSecret } from "@/lib/crypto";
import { env } from "@/lib/env";
import { createSource, deleteDocument, IngestError } from "@/lib/ingest/pipeline";
import { deleteAccount, deleteCourse, ownsCourse, resolveProposals, topicStates } from "@/lib/courses";
import { loadSampleCourse } from "@/lib/sample";
import { chunksForTopic, searchChunks } from "@/lib/retrieval";
import { finishSession, getHint, getSessionView, reportQuestion, startSession, submitAnswer, tagError } from "@/lib/practice/service";
import { getPlan, savePlan } from "@/lib/plan/service";
import { generateLearnNote, generateQuestions, proposeTopics } from "@/lib/ai/generate";
import { AiError, aiStatus } from "@/lib/ai/provider";
import { expandCitations } from "@/lib/citations";
import { addDays, today } from "@/lib/dates";
import { resetRateLimits } from "@/lib/ratelimit";
import { MOCK_KEY, startMockLlm } from "../scripts/mock-llm";
import { FIXTURES, makeCourse, makeUser, prepareDb, waitForDocument } from "./helpers";

const SAMPLE = path.join(FIXTURES, "qmb-sample");
let alice: Awaited<ReturnType<typeof makeUser>>, bob: Awaited<ReturnType<typeof makeUser>>;
let sampleId: string;
let llm: http.Server;
const LLM_PORT = 4011;

const upload = async (userId: string, courseId: string, file: string, dir = SAMPLE) =>
  createSource({ userId, courseId, moduleId: null, kind: "file", title: file, filename: file, mime: null, data: await fs.readFile(path.join(dir, file)), originUrl: null });

beforeAll(async () => {
  await prepareDb();
  alice = await makeUser("alice"); bob = await makeUser("bob");
  llm = await startMockLlm(LLM_PORT);
  sampleId = await loadSampleCourse(alice.id);
}, 120_000);

afterAll(async () => {
  await deleteAccount(alice.id); await deleteAccount(bob.id);
  llm.close();
  await getPool().end();
});

describe("ingestion", () => {
  it("processes every sample file with inspectable provenance", async () => {
    const docs = await db.select().from(schema.sourceDocuments).where(eq(schema.sourceDocuments.courseId, sampleId));
    expect(docs).toHaveLength(8);
    expect(docs.every((d) => d.status === "ready" && d.chunkCount > 0 && d.parserConfidence === 1)).toBe(true);
    const pdf = docs.find((d) => d.filename.endsWith(".pdf"))!;
    const chunks = await db.select().from(schema.sourceChunks).where(eq(schema.sourceChunks.documentId, pdf.id)).orderBy(schema.sourceChunks.ordinal);
    expect(new Set(chunks.map((c) => c.page))).toEqual(new Set([1, 2, 3]));
    expect(chunks.find((c) => c.text.includes("p-value is the probability"))).toMatchObject({ page: 2, heading: "Testing the slope" });
    const slides = await db.select({ slide: schema.sourceChunks.slide }).from(schema.sourceChunks).where(eq(schema.sourceChunks.documentId, docs.find((d) => d.filename.endsWith(".pptx"))!.id));
    expect(slides.every((s) => s.slide !== null)).toBe(true);
    const vtt = await db.select().from(schema.sourceChunks).where(eq(schema.sourceChunks.documentId, docs.find((d) => d.filename.endsWith(".vtt"))!.id));
    expect(vtt.every((c) => c.tStartMs !== null && c.tEndMs! > c.tStartMs!)).toBe(true);
    const jobs = await db.select().from(schema.importJobs).where(eq(schema.importJobs.courseId, sampleId));
    expect(jobs.every((j) => j.status === "done" && j.log.length >= 3)).toBe(true);
    expect(JSON.stringify(jobs.map((j) => j.log))).not.toMatch(/least-squares|regression describes/i); // logs carry no document text
  });

  it("derives modules, objectives and dates from the syllabus and maps documents to modules", async () => {
    const modules = await db.select().from(schema.modules).where(eq(schema.modules.courseId, sampleId)).orderBy(schema.modules.position);
    expect(modules.map((m) => m.name)).toEqual(["Module 1: Simple Linear Regression", "Module 2: Multiple Regression and Model Building", "Module 3: Indicator Variables and Interactions", "Module 4: Time-Series Forecasting"]);
    const objectives = await db.select().from(schema.learningObjectives).where(eq(schema.learningObjectives.courseId, sampleId));
    expect(objectives).toHaveLength(12);
    expect(objectives.every((o) => o.moduleId && o.evidenceChunkId)).toBe(true);
    const dates = await db.select().from(schema.courseDates).where(eq(schema.courseDates.courseId, sampleId));
    expect(dates.find((d) => d.date === "2026-12-04")).toMatchObject({ dateKind: "exam", modulesCovered: [1, 2, 3] });
    expect(dates.find((d) => d.date === "2026-11-20")).toMatchObject({ dateKind: "deadline" });
    const docs = await db.select().from(schema.sourceDocuments).where(eq(schema.sourceDocuments.courseId, sampleId));
    expect(docs.find((d) => d.filename.startsWith("module3"))!.moduleId).toBe(modules[2].id);
    expect(docs.find((d) => d.filename === "syllabus.md")!.moduleId).toBeNull();
  });

  it("fails bad uploads clearly and does not create half-imported sources", async () => {
    const course = await makeCourse(alice.id, "Bad uploads");
    await expect(upload(alice.id, course.id, "malware.exe", path.join(FIXTURES, "bad"))).rejects.toMatchObject({ code: "unsupported_type" });
    await expect(upload(alice.id, course.id, "empty.txt", path.join(FIXTURES, "bad"))).rejects.toMatchObject({ code: "empty_document" });
    const r = await upload(alice.id, course.id, "not-a-pdf.pdf", path.join(FIXTURES, "bad"));
    const doc = await waitForDocument(r.documentId);
    expect(doc.status).toBe("failed");
    expect(doc.error).toMatch(/not a PDF/i);
    const [job] = await db.select().from(schema.importJobs).where(eq(schema.importJobs.documentId, r.documentId));
    expect(job).toMatchObject({ status: "failed", attempts: 1 }); // permanent errors are not retried
    expect(await db.select().from(schema.sourceChunks).where(eq(schema.sourceChunks.documentId, r.documentId))).toHaveLength(0);
  });

  it("handles duplicates and pasted text through the same pipeline", async () => {
    const course = await makeCourse(alice.id, "Paste");
    const first = await upload(alice.id, course.id, "module4-forecasting.md");
    const again = await upload(alice.id, course.id, "module4-forecasting.md");
    expect(again).toMatchObject({ duplicate: true, documentId: first.documentId, jobId: null });
    const text = "Module 2: Confidence intervals\n\nA confidence interval gives a range of plausible values for a parameter. Wider intervals reflect more uncertainty.";
    const paste = await createSource({ userId: alice.id, courseId: course.id, moduleId: null, kind: "paste", title: "Pasted notes", filename: "paste.txt", mime: "text/plain", data: Buffer.from(text), originUrl: "https://lms.example.edu/courses/1/pages/ci" });
    const doc = await waitForDocument(paste.documentId);
    expect(doc).toMatchObject({ status: "ready", parser: "paste-plain", kind: "paste", originUrl: "https://lms.example.edu/courses/1/pages/ci" });
    await resolveProposals(alice.id, course.id, "all", "accept");
    const mods = await db.select().from(schema.modules).where(eq(schema.modules.courseId, course.id)).orderBy(schema.modules.position);
    expect(mods.map((m) => m.name)).toEqual(["Module 2: Confidence intervals", "Module 4: Time-Series Forecasting"]);
    const mod = mods[0];
    const [after] = await db.select().from(schema.sourceDocuments).where(eq(schema.sourceDocuments.id, paste.documentId));
    expect(after.moduleId).toBe(mod.id); // module mapping persists
    const hits = await searchChunks({ userId: alice.id, courseId: course.id, query: "plausible values confidence interval" });
    expect(hits[0].documentId).toBe(paste.documentId);
  });
});

describe("module mapping", () => {
  it("does not depend on import order: a syllabus processed last is not mistaken for a module's notes", async () => {
    const course = await makeCourse(alice.id, "Order test");
    for (const f of ["module1-simple-regression.pdf", "module2-multiple-regression.docx", "module4-forecasting.md", "syllabus.md"]) await waitForDocument((await upload(alice.id, course.id, f)).documentId);
    await resolveProposals(alice.id, course.id, "all", "accept");
    const docs = await db.select().from(schema.sourceDocuments).where(eq(schema.sourceDocuments.courseId, course.id));
    const mods = await db.select().from(schema.modules).where(eq(schema.modules.courseId, course.id));
    expect(mods).toHaveLength(4);
    expect(docs.find((d) => d.filename === "syllabus.md")).toMatchObject({ moduleId: null, moduleHint: null });
    expect(docs.find((d) => d.filename.startsWith("module4"))!.moduleId).toBe(mods.find((m) => m.name.startsWith("Module 4"))!.id);
  });
});

describe("data isolation", () => {
  it("never returns another user's data", async () => {
    expect(await ownsCourse(bob.id, sampleId)).toBe(false);
    expect(await searchChunks({ userId: bob.id, courseId: sampleId, query: "regression slope" })).toEqual([]);
    expect(await topicStates(bob.id, sampleId)).toEqual([]);
    await expect(upload(bob.id, sampleId, "syllabus.md")).rejects.toBeInstanceOf(IngestError);
    expect(await startSession({ userId: bob.id, courseId: sampleId, mode: "drill", count: 5 })).toMatchObject({ ok: false });
    const [doc] = await db.select().from(schema.sourceDocuments).where(eq(schema.sourceDocuments.courseId, sampleId)).limit(1);
    expect(await deleteDocument(bob.id, doc.id)).toBe(false);
    expect(await deleteCourse(bob.id, sampleId)).toBe(false);
    const s = await startSession({ userId: alice.id, courseId: sampleId, mode: "drill", count: 2, seed: 1 });
    expect(s.ok).toBe(true);
    if (s.ok) {
      expect(await getSessionView(bob.id, s.sessionId)).toBeNull();
      const view = (await getSessionView(alice.id, s.sessionId))!;
      expect(await submitAnswer(bob.id, s.sessionId, view.questions[0].id, { choice: 0 }, 10, false)).toMatchObject({ ok: false });
      expect(await getHint(bob.id, s.sessionId, view.questions[0].id)).toBeNull();
      await finishSession(alice.id, s.sessionId);
    }
    const [q] = await db.select().from(schema.questions).where(eq(schema.questions.courseId, sampleId)).limit(1);
    expect(await reportQuestion(bob.id, q.id, "x")).toBe(false);
  });
});

describe("retrieval and citations", () => {
  it("finds the right excerpts and scopes by module", async () => {
    const hits = await searchChunks({ userId: alice.id, courseId: sampleId, query: "variance inflation factor multicollinearity" });
    expect(hits[0].documentTitle).toMatch(/Module 2/);
    const topics = await topicStates(alice.id, sampleId);
    expect(topics).toHaveLength(11);
    expect(topics.every((t) => t.hasSources && t.questionCount >= 3 && t.moduleId)).toBe(true);
    const t = topics.find((x) => x.name === "Interaction terms")!;
    const chunks = await chunksForTopic({ userId: alice.id, courseId: sampleId, topicName: t.name, moduleId: t.moduleId });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].slide).not.toBeNull();
  });
  it("every sample citation resolves to the chunk that contains the quote; deleted sources are reported, not invented", async () => {
    const qs = await db.select().from(schema.questions).where(eq(schema.questions.courseId, sampleId));
    expect(qs).toHaveLength(35);
    const views = await expandCitations(qs.map((q) => q.citations));
    for (const [i, list] of views.entries()) {
      expect(list.length).toBeGreaterThan(0);
      for (const c of list) {
        expect(c.available).toBe(true);
        const [ch] = await db.select().from(schema.sourceChunks).where(eq(schema.sourceChunks.id, c.chunkId));
        expect(ch.text.replace(/\s+/g, " ").toLowerCase()).toContain(qs[i].citations.find((x) => x.chunkId === c.chunkId)!.quote.toLowerCase());
      }
    }
    const pdfCite = views.flat().find((c) => c.title.includes("Module 1"))!;
    expect(pdfCite.location).toMatch(/^p\. [123]$/);
    const [gone] = await expandCitations([[{ chunkId: crypto.randomUUID(), documentId: crypto.randomUUID(), quote: "q", quoteVerified: true }]]);
    expect(gone[0]).toMatchObject({ available: false, title: "Source removed", quoteVerified: false });
  });
});

describe("practice", () => {
  it("drill grades immediately, gives explanations with citations, and updates mastery", async () => {
    const s = await startSession({ userId: alice.id, courseId: sampleId, mode: "drill", count: 6, seed: 42 });
    if (!s.ok) throw new Error(s.message);
    const view = (await getSessionView(alice.id, s.sessionId))!;
    expect(view.questions).toHaveLength(6);
    expect(JSON.stringify(view.questions)).not.toMatch(/correctIndex|explanation|numericValue|"hint"/); // nothing answer-bearing is sent up front
    const qs = await db.select().from(schema.questions).where(sql`${schema.questions.id} in ${view.questions.map((q) => q.id)}`);
    const byId = new Map(qs.map((q) => [q.id, q]));
    const right = (id: string) => { const q = byId.get(id)!; return q.type === "mcq" ? { choice: q.correctIndex! } : { value: q.numericValue! }; };
    const wrong = (id: string) => { const q = byId.get(id)!; return q.type === "mcq" ? { choice: (q.correctIndex! + 1) % 4 } : { value: String(Number(q.numericValue) * 2 + 7) }; };

    const first = view.questions[0];
    const r1 = await submitAnswer(alice.id, s.sessionId, first.id, right(first.id), 4000, false);
    expect(r1).toMatchObject({ ok: true, feedback: { isCorrect: true } });
    if (r1.ok) { expect(r1.feedback!.explanation.length).toBeGreaterThan(20); expect(r1.feedback!.citations[0].available).toBe(true); }
    const again = await submitAnswer(alice.id, s.sessionId, first.id, wrong(first.id), 1, false);
    expect(again).toMatchObject({ ok: true, feedback: { isCorrect: true } }); // first answer is final; no double counting
    const second = view.questions[1];
    const r2 = await submitAnswer(alice.id, s.sessionId, second.id, wrong(second.id), 9000, true);
    expect(r2).toMatchObject({ ok: true, feedback: { isCorrect: false } });
    expect(await submitAnswer(alice.id, s.sessionId, crypto.randomUUID(), { choice: 0 }, 1, false)).toMatchObject({ ok: false });
    expect(await submitAnswer(alice.id, s.sessionId, view.questions[2].id, { choice: 99, value: "" }, 1, false)).toMatchObject({ ok: false });

    const m1 = await db.select().from(schema.topicMastery).where(and(eq(schema.topicMastery.userId, alice.id), eq(schema.topicMastery.topicId, byId.get(first.id)!.topicId!)));
    expect(m1[0].attempts).toBeGreaterThanOrEqual(1);
    if (r2.ok) {
      expect(await tagError(alice.id, r2.feedback!.answerId, "calculation-error")).toBe(true);
      expect(await tagError(alice.id, r2.feedback!.answerId, "made-up")).toBe(false);
      expect(await tagError(bob.id, r2.feedback!.answerId, "careless-error")).toBe(false);
    }
    expect(await finishSession(alice.id, s.sessionId)).toBe(true);
    expect(await finishSession(alice.id, s.sessionId)).toBe(false);
    const done = (await getSessionView(alice.id, s.sessionId))!;
    expect(done).toMatchObject({ status: "submitted", correctCount: 1 });
    expect(await submitAnswer(alice.id, s.sessionId, view.questions[3].id, right(view.questions[3].id), 1, false)).toMatchObject({ ok: false });

    // Spaced review queues the missed concept.
    const review = await startSession({ userId: alice.id, courseId: sampleId, mode: "review", count: 5 });
    if (!review.ok) throw new Error(review.message);
    const rv = (await getSessionView(alice.id, review.sessionId))!;
    expect(rv.questions[0].id).toBe(second.id);
    const fixed = await submitAnswer(alice.id, review.sessionId, second.id, right(second.id), 3000, false);
    expect(fixed).toMatchObject({ ok: true, feedback: { isCorrect: true } });
    await finishSession(alice.id, review.sessionId);
    const [mastery] = await db.select().from(schema.topicMastery).where(and(eq(schema.topicMastery.userId, alice.id), eq(schema.topicMastery.topicId, byId.get(second.id)!.topicId!)));
    expect(mastery.nextReviewAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("a timed exam reveals nothing until it is submitted, then grades everything", async () => {
    const s = await startSession({ userId: alice.id, courseId: sampleId, mode: "exam", count: 8, minutes: 10, seed: 7 });
    if (!s.ok) throw new Error(s.message);
    const view = (await getSessionView(alice.id, s.sessionId))!;
    expect(view.timeLimitSec).toBe(600);
    const qs = await db.select().from(schema.questions).where(sql`${schema.questions.id} in ${view.questions.map((q) => q.id)}`);
    expect(qs.filter((q) => q.id).length).toBe(8);
    const byId = new Map(qs.map((q) => [q.id, q]));
    const right = (id: string) => { const q = byId.get(id)!; return q.type === "mcq" ? { choice: q.correctIndex! } : { value: q.numericValue! }; };
    const masteryBefore = await db.select().from(schema.topicMastery).where(eq(schema.topicMastery.userId, alice.id));

    for (const q of view.questions.slice(0, 5)) expect(await submitAnswer(alice.id, s.sessionId, q.id, right(q.id), 5000, false)).toEqual({ ok: true, feedback: null });
    const changed = view.questions[4];
    const cq = byId.get(changed.id)!;
    await submitAnswer(alice.id, s.sessionId, changed.id, cq.type === "mcq" ? { choice: (cq.correctIndex! + 1) % 4 } : { value: "123456" }, 2000, false); // answers may be changed before submitting
    expect(await getHint(alice.id, s.sessionId, view.questions[0].id)).toBeNull();
    const mid = (await getSessionView(alice.id, s.sessionId))!;
    expect(Object.values(mid.answers).every((a) => a.feedback === null)).toBe(true);
    expect(mid.correctCount).toBeNull();
    const ungraded = await db.select().from(schema.answers).where(eq(schema.answers.sessionId, s.sessionId));
    expect(ungraded.every((a) => a.isCorrect === null)).toBe(true);
    expect(await db.select().from(schema.topicMastery).where(eq(schema.topicMastery.userId, alice.id))).toEqual(masteryBefore); // no mastery change before submission

    await finishSession(alice.id, s.sessionId);
    const done = (await getSessionView(alice.id, s.sessionId))!;
    expect(done).toMatchObject({ status: "submitted", correctCount: 4 });
    expect(Object.keys(done.answers)).toHaveLength(8); // unanswered questions are graded as incorrect
    expect(Object.values(done.answers).every((a) => a.feedback !== null)).toBe(true);
    expect(done.answers[changed.id].timeMs).toBe(7000);
    expect(Object.values(done.answers).filter((a) => !a.feedback!.isCorrect)).toHaveLength(4);
  });

  it("auto-submits an exam after time runs out", async () => {
    const s = await startSession({ userId: alice.id, courseId: sampleId, mode: "exam", count: 3, minutes: 5, seed: 3 });
    if (!s.ok) throw new Error(s.message);
    await db.update(schema.practiceSessions).set({ startedAt: new Date(Date.now() - 6 * 60_000) }).where(eq(schema.practiceSessions.id, s.sessionId));
    const view = (await getSessionView(alice.id, s.sessionId))!;
    expect(view.status).toBe("submitted");
  });

  it("reported questions leave the pool", async () => {
    const [q] = await db.select().from(schema.questions).where(and(eq(schema.questions.courseId, sampleId), eq(schema.questions.status, "active"))).limit(1);
    expect(await reportQuestion(alice.id, q.id, "Ambiguous wording")).toBe(true);
    const s = await startSession({ userId: alice.id, courseId: sampleId, mode: "exam", count: 60, seed: 1 });
    if (!s.ok) throw new Error(s.message);
    const view = (await getSessionView(alice.id, s.sessionId))!;
    expect(view.questions).toHaveLength(34);
    expect(view.questions.map((x) => x.id)).not.toContain(q.id);
    await finishSession(alice.id, s.sessionId);
  });
});

describe("study plan", () => {
  it("respects exam date, selected modules and minutes; updates after practice", async () => {
    const modules = await db.select().from(schema.modules).where(eq(schema.modules.courseId, sampleId)).orderBy(schema.modules.position);
    const examDate = addDays(today(), 21);
    await savePlan(alice.id, sampleId, { examDate, moduleIds: modules.slice(0, 3).map((m) => m.id), desiredGrade: "A-", minutesPerDay: 45, presentationMode: "practice-first", strengths: {}, examFormat: { confirmed: false } });
    const { plan, sessions } = (await getPlan(alice.id, sampleId))!;
    expect(sessions.length).toBeGreaterThan(8);
    expect(sessions.every((s) => s.date >= today() && s.date < examDate)).toBe(true);
    const perDay = new Map<string, number>();
    sessions.forEach((s) => perDay.set(s.date, (perDay.get(s.date) ?? 0) + s.minutes));
    expect(Math.max(...perDay.values())).toBeLessThanOrEqual(45);
    const topics = await topicStates(alice.id, sampleId);
    const module4 = new Set(topics.filter((t) => t.moduleId === modules[3].id).map((t) => t.id));
    expect(sessions.flatMap((s) => s.topicIds).some((id) => module4.has(id))).toBe(false);
    expect(plan.warnings.join(" ")).toMatch(/format .* not confirmed/i);
    expect(sessions.some((s) => s.kind === "mock")).toBe(true);
  });
  it("warns clearly when the scope has no material", async () => {
    const course = await makeCourse(alice.id, "Empty course");
    const [mod] = await db.insert(schema.modules).values({ userId: alice.id, courseId: course.id, name: "Module 1: Nothing yet", position: 1 }).returning();
    await db.insert(schema.topics).values({ userId: alice.id, courseId: course.id, moduleId: mod.id, name: "Bayesian hierarchical widgets" });
    const r = await savePlan(alice.id, course.id, { examDate: addDays(today(), 10), moduleIds: [mod.id], desiredGrade: null, minutesPerDay: 30, presentationMode: "concise-reading", strengths: {}, examFormat: { confirmed: true } });
    expect(r!.sessions).toBe(0);
    expect(r!.warnings.join(" ")).toMatch(/no imported material/i);
  });
});

describe("AI generation (mock OpenAI-compatible provider)", () => {
  const connect = (model: string, key = MOCK_KEY, limit = 60) => db.insert(schema.providerSettings)
    .values({ userId: alice.id, baseUrl: `http://127.0.0.1:${LLM_PORT}/v1`, model, apiKeyEnc: encryptSecret(key), keyHint: "…-key", dailyRequestLimit: limit, disclosureAckAt: new Date() })
    .onConflictDoUpdate({ target: schema.providerSettings.userId, set: { model, apiKeyEnc: encryptSecret(key), dailyRequestLimit: limit } });
  let courseId: string; let topicIds: string[];

  beforeAll(async () => {
    const course = await makeCourse(alice.id, "Generated course");
    courseId = course.id;
    for (const f of ["module1-simple-regression.pdf", "module2-multiple-regression.docx", "module4-forecasting.md"]) await waitForDocument((await upload(alice.id, courseId, f)).documentId);
    await resolveProposals(alice.id, courseId, "all", "accept");
    topicIds = (await topicStates(alice.id, courseId)).map((t) => t.id);
  }, 60_000);

  it("is transparent when no provider is connected", async () => {
    await expect(generateQuestions({ userId: alice.id, courseId, topicIds: topicIds.slice(0, 1), perTopic: 2 })).rejects.toMatchObject({ code: "no_provider" });
  });

  it("generates 10+ source-grounded questions, rejecting invalid model output", async () => {
    expect(topicIds.length).toBeGreaterThanOrEqual(8);
    await connect("mock-1");
    const results = await generateQuestions({ userId: alice.id, courseId, topicIds: topicIds.slice(0, 4), perTopic: 3 });
    const added = results.reduce((n, r) => n + r.added, 0);
    expect(added).toBeGreaterThanOrEqual(10);
    const rejected = results.flatMap((r) => r.rejected).join(" | ");
    expect(rejected).toMatch(/did not match the verified calculation/);
    expect(rejected).toMatch(/cited no source from the provided list/);
    const qs = await db.select().from(schema.questions).where(eq(schema.questions.courseId, courseId));
    expect(qs).toHaveLength(added);
    expect(qs.every((q) => q.origin === "ai" && q.citations.length > 0 && q.citations.every((c) => c.quoteVerified))).toBe(true);
    expect(qs.some((q) => q.type === "numeric" && q.correctnessConfidence === "verified-numeric")).toBe(true);
    expect(qs.some((q) => /Predict y when x = 5/.test(q.stem) && q.numericValue === "99")).toBe(false);
    expect(new Set(qs.map((q) => q.fingerprint)).size).toBe(qs.length);
    for (const q of qs.filter((x) => x.type === "mcq")) expect(new Set(q.choices!.map((c) => c.toLowerCase())).size).toBe(4);
    const chunkIds = new Set((await db.select({ id: schema.sourceChunks.id }).from(schema.sourceChunks).where(eq(schema.sourceChunks.courseId, courseId))).map((c) => c.id));
    expect(qs.flatMap((q) => q.citations).every((c) => chunkIds.has(c.chunkId))).toBe(true); // only this course's own chunks are cited
    const usage = await db.select().from(schema.aiUsage).where(eq(schema.aiUsage.userId, alice.id));
    expect(usage.length).toBeGreaterThanOrEqual(4);
    expect(usage.every((u) => u.ok && u.promptTokens! > 0)).toBe(true);
  }, 60_000);

  it("generated questions can be practised", async () => {
    const s = await startSession({ userId: alice.id, courseId, mode: "drill", count: 5, seed: 2 });
    expect(s.ok).toBe(true);
    if (s.ok) await finishSession(alice.id, s.sessionId);
  });

  it("builds a cited study note and drops uncited points", async () => {
    expect(await generateLearnNote({ userId: alice.id, courseId, topicId: topicIds[0] })).toEqual({ ok: true });
    const [note] = await db.select().from(schema.learnNotes).where(eq(schema.learnNotes.topicId, topicIds[0]));
    expect(note.body.keyPoints).toHaveLength(3);
    expect(note.body.keyPoints.every((k) => k.citations.length === 1 && k.citations[0].quoteVerified)).toBe(true);
    expect(JSON.stringify(note.body)).not.toContain("uncited claim");
  });

  it("reports insufficient sources instead of inventing content", async () => {
    await connect("mock-insufficient");
    const r = await generateQuestions({ userId: alice.id, courseId, topicIds: topicIds.slice(4, 5), perTopic: 2 });
    expect(r[0]).toMatchObject({ added: 0 });
    expect(r[0].insufficient).toMatch(/do not cover/);
    const [t] = await db.insert(schema.topics).values({ userId: alice.id, courseId, name: "Zebra quantum blockchain" }).returning();
    const none = await generateQuestions({ userId: alice.id, courseId, topicIds: [t.id], perTopic: 2 });
    expect(none[0].insufficient).toMatch(/No imported material/);
  });

  it("surfaces bad keys, bad output, limits and course rules honestly", async () => {
    await connect("mock-1", "wrong-key");
    await expect(generateQuestions({ userId: alice.id, courseId, topicIds: topicIds.slice(5, 6), perTopic: 1 })).rejects.toMatchObject({ code: "auth_failed" });
    await connect("mock-garbage");
    await expect(generateQuestions({ userId: alice.id, courseId, topicIds: topicIds.slice(5, 6), perTopic: 1 })).rejects.toMatchObject({ code: "bad_output" });
    await connect("mock-1", MOCK_KEY, 1);
    await expect(generateQuestions({ userId: alice.id, courseId, topicIds: topicIds.slice(5, 6), perTopic: 1 })).rejects.toMatchObject({ code: "limit_reached" });
    await connect("mock-1", MOCK_KEY, 500);
    await db.update(schema.courses).set({ allowExternalAi: false }).where(eq(schema.courses.id, courseId));
    await expect(generateQuestions({ userId: alice.id, courseId, topicIds: topicIds.slice(5, 6), perTopic: 1 })).rejects.toBeInstanceOf(AiError);
    await db.update(schema.courses).set({ allowExternalAi: true }).where(eq(schema.courses.id, courseId));
    resetRateLimits();
    const [row] = await db.select().from(schema.providerSettings).where(eq(schema.providerSettings.userId, alice.id));
    expect(row.apiKeyEnc).not.toContain(MOCK_KEY); // stored encrypted
  });

  it("deleting a source removes its chunks and the AI questions that cited only it", async () => {
    const [doc] = await db.select().from(schema.sourceDocuments).where(and(eq(schema.sourceDocuments.courseId, courseId), eq(schema.sourceDocuments.filename, "module1-simple-regression.pdf")));
    const before = await db.select().from(schema.questions).where(eq(schema.questions.courseId, courseId));
    const citing = before.filter((q) => q.citations.some((c) => c.documentId === doc.id));
    expect(citing.length).toBeGreaterThan(0);
    expect(await deleteDocument(alice.id, doc.id)).toBe(true);
    await expect(fs.access(path.join(env.uploadDir, doc.storagePath))).rejects.toThrow();
    expect(await db.select().from(schema.sourceChunks).where(eq(schema.sourceChunks.documentId, doc.id))).toHaveLength(0);
    const after = await db.select().from(schema.questions).where(eq(schema.questions.courseId, courseId));
    expect(after.some((q) => q.citations.some((c) => c.documentId === doc.id))).toBe(false);
    expect(after.every((q) => q.citations.length > 0)).toBe(true);
    expect(after.length).toBeLessThan(before.length);
  });
});

describe("managed AI (no key needed)", () => {
  const SECRET = "managed-secret-key-never-shown";
  let courseId: string; let topicIds: string[];
  const configure = (over: Record<string, string> = {}) => Object.assign(process.env, {
    MANAGED_AI_BASE_URL: `http://127.0.0.1:${LLM_PORT}/v1`, MANAGED_AI_API_KEY: MOCK_KEY, MANAGED_AI_MODEL: "mock-cheap", MANAGED_AI_MODEL_STRONG: "mock-strong",
    MANAGED_AI_USER_DAILY_REQUESTS: "40", MANAGED_AI_USER_MONTHLY_TOKENS: "400000", MANAGED_AI_GLOBAL_DAILY_REQUESTS: "500", MANAGED_AI_GLOBAL_MONTHLY_USD: "10",
    MANAGED_AI_PRICE_IN_PER_MTOK: "0.5", MANAGED_AI_PRICE_OUT_PER_MTOK: "2", MANAGED_AI_STRONG_PRICE_IN_PER_MTOK: "5", MANAGED_AI_STRONG_PRICE_OUT_PER_MTOK: "20", ...over });
  const usage = () => db.select().from(schema.aiUsage).where(eq(schema.aiUsage.userId, bob.id));

  beforeAll(async () => {
    const course = await makeCourse(bob.id, "Bob's managed course");
    courseId = course.id;
    for (const f of ["module1-simple-regression.pdf", "module4-forecasting.md"]) await waitForDocument((await upload(bob.id, courseId, f)).documentId);
    await resolveProposals(bob.id, courseId, "all", "accept");
    topicIds = (await topicStates(bob.id, courseId)).map((t) => t.id);
    resetRateLimits();
  }, 60_000);
  afterAll(() => { for (const k of Object.keys(process.env)) if (k.startsWith("MANAGED_AI_")) delete process.env[k]; });

  it("is off unless the operator configured it, and says so", async () => {
    expect(await aiStatus(bob.id)).toMatchObject({ available: false, kind: null });
    process.env.MANAGED_AI_BASE_URL = "http://127.0.0.1:1/v1"; // incomplete configuration stays off
    expect((await aiStatus(bob.id)).kind).toBeNull();
    await expect(generateQuestions({ userId: bob.id, courseId, topicIds: topicIds.slice(0, 1), perTopic: 1 })).rejects.toMatchObject({ code: "no_provider" });
  });

  it("generates without any user key, accounts requests, tokens and cost, and uses the stronger model only for retries", async () => {
    configure();
    const status = await aiStatus(bob.id);
    expect(status).toMatchObject({ available: true, kind: "managed", label: "Klierly AI", usedToday: 0, dailyLimit: 40 });
    expect(JSON.stringify(status)).not.toContain(MOCK_KEY); // what the UI receives carries no credential
    const results = await generateQuestions({ userId: bob.id, courseId, topicIds: topicIds.slice(0, 2), perTopic: 3 });
    expect(results.reduce((n, r) => n + r.added, 0)).toBeGreaterThanOrEqual(5);
    const rows = await usage();
    expect(rows.every((r) => r.provider === "managed" && r.ok)).toBe(true);
    const routine = rows.filter((r) => r.tier === "routine"), strong = rows.filter((r) => r.tier === "strong");
    expect(routine.length).toBe(2); // one first attempt per topic on the inexpensive model
    expect(routine.every((r) => r.model === "mock-cheap")).toBe(true);
    expect(strong.length).toBeGreaterThanOrEqual(1); // the mock's first reply contains invalid drafts → retry
    expect(strong.every((r) => r.model === "mock-strong")).toBe(true);
    for (const r of rows) {
      const price = r.tier === "strong" ? { in: 5, out: 20 } : { in: 0.5, out: 2 };
      expect(r.costMicroUsd).toBe(Math.round(r.promptTokens! * price.in + r.completionTokens! * price.out));
      expect(r.costMicroUsd).toBeGreaterThan(0);
    }
    const after = await aiStatus(bob.id);
    expect(after).toMatchObject({ kind: "managed", usedToday: rows.length });
    if (after.kind === "managed") expect(after.tokensThisMonth).toBe(rows.reduce((n, r) => n + r.promptTokens! + r.completionTokens!, 0));
    const [stored] = await db.select().from(schema.providerSettings).where(eq(schema.providerSettings.userId, bob.id));
    expect(stored).toBeUndefined(); // the managed key is never copied into a user's settings
  }, 60_000);

  it("enforces the per-student daily quota, monthly allowance, shared daily cap and budget stop", async () => {
    const used = (await usage()).length;
    const blocked = async (over: Record<string, string>, pattern: RegExp) => {
      configure(over);
      const st = await aiStatus(bob.id);
      expect(st.available).toBe(false);
      expect(st.reason).toMatch(pattern);
      await expect(generateQuestions({ userId: bob.id, courseId, topicIds: topicIds.slice(2, 3), perTopic: 1 })).rejects.toMatchObject({ code: "limit_reached" });
    };
    await blocked({ MANAGED_AI_USER_DAILY_REQUESTS: String(used) }, /today's \d+ free AI requests/);
    await blocked({ MANAGED_AI_USER_MONTHLY_TOKENS: "100" }, /this month's free AI allowance/);
    await blocked({ MANAGED_AI_GLOBAL_DAILY_REQUESTS: "1" }, /shared free AI allowance for today/);
    await blocked({ MANAGED_AI_GLOBAL_MONTHLY_USD: "0.000001" }, /shared free AI budget/);
    expect((await usage()).length).toBe(used); // refused requests never reached the provider
    configure();
    expect((await aiStatus(bob.id)).available).toBe(true);
  });

  it("counts failed provider calls against the quota and reports them honestly", async () => {
    configure({ MANAGED_AI_API_KEY: SECRET }); // the mock rejects this key
    const before = (await usage()).length;
    await expect(generateQuestions({ userId: bob.id, courseId, topicIds: topicIds.slice(2, 3), perTopic: 1 })).rejects.toMatchObject({ code: "auth_failed" });
    const rows = await usage();
    expect(rows.length).toBe(before + 1);
    expect(rows.filter((r) => !r.ok)).toHaveLength(1);
    configure();
  });

  it("suggests study topics for review, dropping labels, inventions and uncited ones; supersedes heading guesses", async () => {
    const course = await makeCourse(bob.id, "Topic organiser");
    await waitForDocument((await upload(bob.id, course.id, "module2-multiple-regression.docx")).documentId);
    const before = await db.select().from(schema.proposals).where(and(eq(schema.proposals.courseId, course.id), eq(schema.proposals.kind, "topic")));
    expect(before.length).toBeGreaterThan(0); // heading-based guesses exist
    const r = await proposeTopics({ userId: bob.id, courseId: course.id });
    expect(r).toMatchObject({ ok: true, dropped: 3 });
    const after = await db.select().from(schema.proposals).where(and(eq(schema.proposals.courseId, course.id), eq(schema.proposals.kind, "topic")));
    const pending = after.filter((p) => p.status === "pending");
    expect(pending.length).toBe(r.ok ? r.proposed : -1);
    expect(pending.length).toBeGreaterThanOrEqual(3);
    expect(pending.every((p) => p.payload.kind === "topic" && p.payload.via === "ai" && p.evidenceChunkId)).toBe(true);
    const names = pending.map((p) => (p.payload.kind === "topic" ? p.payload.name : ""));
    expect(names).not.toContain("Plan");
    expect(names.join(" ")).not.toMatch(/zebras|again/);
    expect(before.every((b) => after.find((a) => a.id === b.id)!.status !== "pending" || pending.some((p) => p.id === b.id))).toBe(true);
    expect(await db.select().from(schema.topics).where(eq(schema.topics.courseId, course.id))).toHaveLength(0); // nothing applied without review
    await resolveProposals(bob.id, course.id, "all", "accept", ["topic"]);
    const made = await topicStates(bob.id, course.id);
    expect(made.length).toBe(pending.length);
    expect(made.every((t) => t.hasSources)).toBe(true);
  }, 60_000);

  it("a student's own key takes precedence over the managed provider", async () => {
    await db.insert(schema.providerSettings).values({ userId: bob.id, baseUrl: `http://127.0.0.1:${LLM_PORT}/v1`, model: "mock-1", apiKeyEnc: encryptSecret(MOCK_KEY), keyHint: "…-key", dailyRequestLimit: 60, disclosureAckAt: new Date() });
    resetRateLimits();
    expect(await aiStatus(bob.id)).toMatchObject({ kind: "byok", available: true, model: "mock-1" });
    const managedBefore = (await usage()).filter((r) => r.provider === "managed").length;
    await generateLearnNote({ userId: bob.id, courseId, topicId: topicIds[0] });
    const rows = await usage();
    expect(rows.filter((r) => r.provider === "managed").length).toBe(managedBefore);
    expect(rows.filter((r) => r.provider === "byok" && r.costMicroUsd === 0).length).toBe(1);
  });
});

describe("deletion", () => {
  it("deleting a course or an account removes all rows and files", async () => {
    const carol = await makeUser("carol");
    const id = await loadSampleCourse(carol.id);
    const dir = path.join(env.uploadDir, carol.id);
    expect((await fs.readdir(dir)).length).toBe(8);
    expect(await deleteCourse(carol.id, id)).toBe(true);
    expect(await fs.readdir(dir)).toHaveLength(0);
    for (const t of ["source_documents", "source_chunks", "questions", "topics", "modules", "import_jobs", "proposals", "learn_notes", "learning_objectives", "course_dates"]) {
      const r = await db.execute(sql`select count(*)::int as n from ${sql.identifier(t)} where course_id = ${id}`);
      expect(r.rows[0].n, t).toBe(0);
    }
    const id2 = await loadSampleCourse(carol.id);
    const s = await startSession({ userId: carol.id, courseId: id2, mode: "drill", count: 2, seed: 1 });
    expect(s.ok).toBe(true);
    await deleteAccount(carol.id);
    await expect(fs.access(dir)).rejects.toThrow();
    for (const t of ["courses", "source_chunks", "questions", "practice_sessions", "answers", "topic_mastery", "sessions", "provider_settings", "ai_usage"]) {
      const r = await db.execute(sql`select count(*)::int as n from ${sql.identifier(t)} where user_id = ${carol.id}`);
      expect(r.rows[0].n, t).toBe(0);
    }
    expect(await ownsCourse(alice.id, sampleId)).toBe(true); // other users untouched
  }, 120_000);
});
