import fs from "node:fs/promises";
import path from "node:path";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Citation } from "@/db/schema";
import { fingerprint, normalize, shuffleChoices, within, numberIn } from "@/lib/ai/validate";
import { resolveProposals } from "@/lib/courses";
import { createSource } from "@/lib/ingest/pipeline";
import { kickJobs } from "@/lib/ingest/jobs";
import { moduleNumberOf } from "@/lib/ingest/proposals";
import { compute } from "@/lib/worker";

type Cite = { file: string; quote: string };
type SampleFile = {
  course: { name: string; term: string; goal: string };
  files: string[];
  topics: { key: string; name: string; module: number; note: { summary: string; points: ({ text: string } & Cite)[] } }[];
  questions: {
    topic: string; type: "mcq" | "numeric"; difficulty: number; stem: string; choices?: string[]; correct?: number;
    check?: { fn: string; args: Record<string, unknown> }; unit?: string; hint: string; explanation: string; cite: Cite[];
  }[];
};

async function sampleDir(): Promise<string> {
  const candidates = [process.env.SAMPLE_DIR, path.resolve(process.cwd(), "../fixtures/qmb-sample"), path.resolve(process.cwd(), "fixtures/qmb-sample")].filter(Boolean) as string[];
  for (const c of candidates) {
    try { await fs.access(path.join(c, "sample-course.json")); return c; } catch { /* next */ }
  }
  throw new Error("Sample course files were not found (set SAMPLE_DIR).");
}

/**
 * Create the synthetic demo course for a user. The sample files go through
 * the real ingestion pipeline; the hand-written question bank is then linked
 * to the resulting chunks. Every quote must be found in the parsed text and
 * every numeric answer is recomputed by the worker — otherwise loading fails.
 */
export async function loadSampleCourse(userId: string): Promise<string> {
  const dir = await sampleDir();
  const sample = JSON.parse(await fs.readFile(path.join(dir, "sample-course.json"), "utf8")) as SampleFile;
  const [course] = await db.insert(schema.courses).values({ userId, name: sample.course.name, term: sample.course.term, goal: sample.course.goal, isSample: true }).returning();
  try {
    for (const file of sample.files) {
      const data = await fs.readFile(path.join(dir, file));
      await createSource({ userId, courseId: course.id, moduleId: null, kind: "file", title: file, filename: file, mime: null, data, originUrl: null });
    }
    const deadline = Date.now() + 90_000;
    for (;;) {
      const docs = await db.select({ status: schema.sourceDocuments.status, error: schema.sourceDocuments.error, filename: schema.sourceDocuments.filename })
        .from(schema.sourceDocuments).where(eq(schema.sourceDocuments.courseId, course.id));
      const failed = docs.find((d) => d.status === "failed");
      if (failed) throw new Error(`Sample file ${failed.filename} could not be processed: ${failed.error}`);
      if (docs.every((d) => d.status === "ready")) break;
      if (Date.now() > deadline) throw new Error("Timed out while processing the sample files. Is the worker running?");
      kickJobs();
      await new Promise((r) => setTimeout(r, 300));
    }
    await resolveProposals(userId, course.id, "all", "accept", ["module", "objective", "date"]);
    await resolveProposals(userId, course.id, "all", "dismiss", ["topic"]);

    const modules = await db.select().from(schema.modules).where(eq(schema.modules.courseId, course.id));
    const docs = await db.select({ id: schema.sourceDocuments.id, filename: schema.sourceDocuments.filename }).from(schema.sourceDocuments).where(eq(schema.sourceDocuments.courseId, course.id));
    const chunks = await db.select({ id: schema.sourceChunks.id, documentId: schema.sourceChunks.documentId, text: schema.sourceChunks.text })
      .from(schema.sourceChunks).where(inArray(schema.sourceChunks.documentId, docs.map((d) => d.id)));
    const cite = (c: Cite): Citation => {
      const doc = docs.find((d) => d.filename === c.file);
      const hit = doc && chunks.find((ch) => ch.documentId === doc.id && normalize(ch.text).includes(normalize(c.quote)));
      if (!doc || !hit) throw new Error(`Sample citation not found in ${c.file}: "${c.quote.slice(0, 60)}"`);
      return { chunkId: hit.id, documentId: doc.id, quote: c.quote, quoteVerified: true };
    };

    const topicIds = new Map<string, string>();
    for (const [i, t] of sample.topics.entries()) {
      const points = t.note.points.map((p) => ({ text: p.text, citations: [cite(p)] }));
      const [row] = await db.insert(schema.topics).values({
        userId, courseId: course.id, name: t.name, origin: "sample", position: i,
        moduleId: modules.find((m) => moduleNumberOf(m.name) === t.module)?.id ?? null, evidenceChunkId: points[0].citations[0].chunkId,
      }).returning({ id: schema.topics.id });
      topicIds.set(t.key, row.id);
      await db.insert(schema.learnNotes).values({ userId, courseId: course.id, topicId: row.id, origin: "sample", body: { summary: t.note.summary, keyPoints: points } });
    }

    for (const q of sample.questions) {
      const topicId = topicIds.get(q.topic);
      if (!topicId) throw new Error(`Sample question references unknown topic ${q.topic}`);
      const fp = fingerprint(q.stem);
      const computed = q.check ? (await compute(q.check.fn, q.check.args)).value : null;
      let choices: string[] | null = null, correctIndex: number | null = null;
      if (q.type === "mcq") {
        if (!q.choices || q.choices.length !== 4 || q.correct === undefined) throw new Error("Sample MCQ must have 4 choices and a correct index.");
        if (computed !== null) {
          const n = numberIn(q.choices[q.correct]);
          if (n === null || !within(n, computed, Math.abs(computed) * 0.01)) throw new Error(`Sample MCQ answer does not match its check: ${q.stem.slice(0, 50)}`);
        }
        ({ choices, correctIndex } = shuffleChoices(q.choices, q.correct, fp));
      } else if (computed === null) throw new Error("Sample numeric question needs a check.");
      await db.insert(schema.questions).values({
        userId, courseId: course.id, topicId, type: q.type, stem: q.stem, choices, correctIndex,
        numericValue: q.type === "numeric" ? String(computed) : null,
        tolerance: q.type === "numeric" ? String(Math.max(Math.abs(computed!) * 0.005, 0.005)) : null,
        unit: q.unit || null, hint: q.hint, explanation: q.explanation, citations: q.cite.map(cite), grounding: "direct",
        correctnessConfidence: computed !== null ? "verified-numeric" : "author-reviewed", explanationConfidence: "author-reviewed",
        check: q.check ?? null, difficulty: q.difficulty, origin: "sample", fingerprint: fp,
      });
    }
    return course.id;
  } catch (e) {
    const { deleteCourse } = await import("@/lib/courses");
    await deleteCourse(userId, course.id);
    throw e;
  }
}

export async function hasSampleCourse(userId: string): Promise<boolean> {
  const [c] = await db.select({ id: schema.courses.id }).from(schema.courses).where(and(eq(schema.courses.userId, userId), eq(schema.courses.isSample, true))).limit(1);
  return Boolean(c);
}
