import path from "node:path";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { sha256 } from "@/lib/crypto";
import { log } from "@/lib/log";
import { parseFile, parseText, WorkerError } from "@/lib/worker";
import { chunkSegments } from "./chunk";
import { moduleNumberOf, proposeFromChunks, termYear } from "./proposals";
import { readFile, removeFile, saveFile, storagePathFor } from "./storage";
import { kickJobs } from "./jobs";

export const SUPPORTED_EXTENSIONS = [".pdf", ".docx", ".pptx", ".txt", ".md", ".markdown", ".html", ".htm", ".csv", ".xlsx", ".srt", ".vtt"];
export const MAX_PASTE_CHARS = 400_000;

export class IngestError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

type NewSource = {
  userId: string; courseId: string; moduleId: string | null; kind: "file" | "paste" | "web";
  title: string; filename: string; mime: string | null; data: Buffer; originUrl: string | null;
};

async function assertOwnership(userId: string, courseId: string, moduleId: string | null) {
  const [course] = await db.select({ id: schema.courses.id }).from(schema.courses)
    .where(and(eq(schema.courses.id, courseId), eq(schema.courses.userId, userId))).limit(1);
  if (!course) throw new IngestError("course_not_found", "That course does not exist.", 404);
  if (moduleId) {
    const [mod] = await db.select({ id: schema.modules.id }).from(schema.modules)
      .where(and(eq(schema.modules.id, moduleId), eq(schema.modules.courseId, courseId), eq(schema.modules.userId, userId))).limit(1);
    if (!mod) throw new IngestError("module_not_found", "That module does not belong to this course.", 404);
  }
}

/**
 * Single entry point for every import route (file upload, paste, browser
 * extension). Validates, stores the original privately, and queues an
 * ImportJob. Returns the existing document when the same content was already
 * imported into the course.
 */
export async function createSource(input: NewSource): Promise<{ documentId: string; jobId: string | null; duplicate: boolean }> {
  await assertOwnership(input.userId, input.courseId, input.moduleId);
  const ext = path.extname(input.filename).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    throw new IngestError("unsupported_type", `Files of type "${ext || "unknown"}" are not supported. Supported: ${SUPPORTED_EXTENSIONS.join(" ")}.`, 415);
  }
  if (input.data.length === 0) throw new IngestError("empty_document", "The file is empty.", 422);
  const digest = sha256(input.data);
  const [existing] = await db.select({ id: schema.sourceDocuments.id }).from(schema.sourceDocuments)
    .where(and(eq(schema.sourceDocuments.courseId, input.courseId), eq(schema.sourceDocuments.sha256, digest))).limit(1);
  if (existing) return { documentId: existing.id, jobId: null, duplicate: true };

  const documentId = crypto.randomUUID();
  const storagePath = storagePathFor(input.userId, documentId, ext);
  await saveFile(storagePath, input.data);
  try {
    const jobId = await db.transaction(async (tx) => {
      await tx.insert(schema.sourceDocuments).values({
        id: documentId, userId: input.userId, courseId: input.courseId, moduleId: input.moduleId,
        title: input.title.trim().slice(0, 200) || input.filename, kind: input.kind, filename: input.filename.slice(0, 200),
        mime: input.mime, sizeBytes: input.data.length, sha256: digest, storagePath, originUrl: input.originUrl,
        permissionDeclaredAt: new Date(),
      });
      const [job] = await tx.insert(schema.importJobs).values({
        userId: input.userId, courseId: input.courseId, documentId,
        log: [{ at: new Date().toISOString(), msg: "Queued" }],
      }).returning({ id: schema.importJobs.id });
      return job.id;
    });
    kickJobs();
    return { documentId, jobId, duplicate: false };
  } catch (e) {
    await removeFile(storagePath);
    if ((e as { code?: string }).code === "23505") {
      const [dup] = await db.select({ id: schema.sourceDocuments.id }).from(schema.sourceDocuments)
        .where(and(eq(schema.sourceDocuments.courseId, input.courseId), eq(schema.sourceDocuments.sha256, digest))).limit(1);
      if (dup) return { documentId: dup.id, jobId: null, duplicate: true };
    }
    throw e;
  }
}

/** Parse → chunk → index → suggest. Called by the job runner. Idempotent. */
export async function processDocument(documentId: string): Promise<{ chunks: number; parser: string }> {
  const [doc] = await db.select().from(schema.sourceDocuments).where(eq(schema.sourceDocuments.id, documentId)).limit(1);
  if (!doc) throw new WorkerError(404, "document_gone", "The document was deleted before it could be processed.");
  await db.update(schema.sourceDocuments).set({ status: "processing", error: null }).where(eq(schema.sourceDocuments.id, documentId));

  const data = await readFile(doc.storagePath);
  const result = doc.kind === "file"
    ? await parseFile(doc.filename, data)
    : await parseText(data.toString("utf8"), doc.filename.endsWith(".html") ? "html" : "plain", doc.title);
  const chunks = chunkSegments(result.segments);
  if (chunks.length === 0) throw new WorkerError(422, "empty_document", "No readable text was found in this document.");

  const [course] = await db.select({ term: schema.courses.term }).from(schema.courses).where(eq(schema.courses.id, doc.courseId)).limit(1);
  const title = doc.kind === "file" && result.title && doc.title === doc.filename ? result.title.slice(0, 200) : doc.title;

  await db.transaction(async (tx) => {
    await tx.delete(schema.sourceChunks).where(eq(schema.sourceChunks.documentId, documentId));
    const rows = chunks.map((c) => ({ ...c, id: crypto.randomUUID(), userId: doc.userId, courseId: doc.courseId, documentId }));
    for (let i = 0; i < rows.length; i += 200) await tx.insert(schema.sourceChunks).values(rows.slice(i, i + 200));
    await tx.update(schema.sourceDocuments).set({
      status: "ready", title, parser: result.parser, parserConfidence: result.confidence, warnings: result.warnings.slice(0, 20),
      chunkCount: rows.length, charCount: chunks.reduce((n, c) => n + c.text.length, 0), error: null,
    }).where(eq(schema.sourceDocuments.id, documentId));

    const drafts = proposeFromChunks({ id: documentId, title }, chunks, { termYear: termYear(course?.term) });
    // A document that names exactly one module ("Module 2: …") most likely belongs to it; a syllabus names several.
    const named = new Set(drafts.flatMap((d) => (d.payload.kind === "module" && d.payload.number !== undefined ? [d.payload.number] : [])));
    await tx.update(schema.sourceDocuments).set({ moduleHint: named.size === 1 ? [...named][0] : null }).where(eq(schema.sourceDocuments.id, documentId));
    if (drafts.length) {
      await tx.insert(schema.proposals).values(drafts.map((d) => ({
        userId: doc.userId, courseId: doc.courseId, kind: d.payload.kind, payload: d.payload, dedupeKey: d.dedupeKey,
        evidenceChunkId: rows[d.chunkOrdinal]?.id ?? null,
      }))).onConflictDoNothing();
    }
  });
  await autoMapDocuments(doc.courseId);
  log("info", "import.processed", { documentId, parser: result.parser, chunks: chunks.length, confidence: result.confidence });
  return { chunks: chunks.length, parser: result.parser };
}

/** Assign unmapped documents to a module when their title names its number ("Module 2 …"). */
export async function autoMapDocuments(courseId: string) {
  const mods = await db.select({ id: schema.modules.id, name: schema.modules.name }).from(schema.modules).where(eq(schema.modules.courseId, courseId));
  if (!mods.length) return;
  const byNumber = new Map<number, string>();
  for (const m of mods) { const n = moduleNumberOf(m.name); if (n !== null && !byNumber.has(n)) byNumber.set(n, m.id); }
  const docs = await db.select({ id: schema.sourceDocuments.id, title: schema.sourceDocuments.title, filename: schema.sourceDocuments.filename, moduleHint: schema.sourceDocuments.moduleHint })
    .from(schema.sourceDocuments).where(and(eq(schema.sourceDocuments.courseId, courseId), isNull(schema.sourceDocuments.moduleId)));
  for (const d of docs) {
    const n = moduleNumberOf(d.title) ?? moduleNumberOf(d.filename) ?? d.moduleHint;
    const moduleId = n !== null ? byNumber.get(n) : undefined;
    if (moduleId) await db.update(schema.sourceDocuments).set({ moduleId }).where(eq(schema.sourceDocuments.id, d.id));
  }
}

export async function deleteDocument(userId: string, documentId: string): Promise<boolean> {
  const [doc] = await db.delete(schema.sourceDocuments)
    .where(and(eq(schema.sourceDocuments.id, documentId), eq(schema.sourceDocuments.userId, userId)))
    .returning({ storagePath: schema.sourceDocuments.storagePath, courseId: schema.sourceDocuments.courseId });
  if (!doc) return false;
  await removeFile(doc.storagePath);
  // Citations that pointed at the deleted document can no longer be opened; retire them.
  await db.execute(sql`
    update questions set citations = coalesce((
      select jsonb_agg(c) from jsonb_array_elements(citations) c where c->>'documentId' <> ${documentId}), '[]'::jsonb)
    where course_id = ${doc.courseId} and citations @> ${JSON.stringify([{ documentId }])}::jsonb`);
  await db.execute(sql`delete from questions where course_id = ${doc.courseId} and origin = 'ai' and citations = '[]'::jsonb`);
  await db.execute(sql`delete from proposals where course_id = ${doc.courseId} and status = 'pending' and evidence_chunk_id is null`);
  return true;
}
