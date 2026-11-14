import { sql } from "drizzle-orm";
import { db } from "@/db";

export type RetrievedChunk = {
  id: string; documentId: string; documentTitle: string; moduleId: string | null; ordinal: number; kind: "text" | "table";
  text: string; heading: string | null; page: number | null; slide: number | null; tStartMs: number | null; tEndMs: number | null; rank: number;
};

const STOP = new Set(["the", "and", "for", "with", "that", "this", "from", "are", "was", "what", "which", "when", "how", "why", "does", "into", "about", "your", "you", "can", "not", "but", "has", "have", "its", "their", "them", "then", "than", "also", "use", "using"]);

/** Build a safe OR tsquery from free text (never interpolate raw input into to_tsquery). */
export function toOrQuery(text: string): string | null {
  const tokens = [...new Set((text.toLowerCase().match(/[a-z][a-z0-9]{2,}|\d+(?:\.\d+)?/g) ?? []).filter((t) => !STOP.has(t)))].slice(0, 24);
  return tokens.length ? tokens.map((t) => t.replace(/[^a-z0-9.]/g, "")).filter(Boolean).join(" | ") : null;
}

type RowT = {
  id: string; document_id: string; document_title: string; module_id: string | null; ordinal: number; kind: "text" | "table"; text: string;
  heading: string | null; page: number | null; slide: number | null; t_start_ms: number | null; t_end_ms: number | null; rank: number;
};

/**
 * Keyword retrieval over the user's own chunks (PostgreSQL full-text search,
 * heading matches weighted above body). Always scoped by user and course.
 */
export async function searchChunks(opts: { userId: string; courseId: string; query: string; moduleIds?: string[]; limit?: number }): Promise<RetrievedChunk[]> {
  const q = toOrQuery(opts.query);
  if (!q) return [];
  const moduleFilter = opts.moduleIds?.length
    ? sql`and d.module_id in (${sql.join(opts.moduleIds.map((m) => sql`${m}::uuid`), sql`, `)})`
    : sql``;
  const res = await db.execute<RowT>(sql`
    select c.id, c.document_id, d.title as document_title, d.module_id, c.ordinal, c.kind, c.text, c.heading, c.page, c.slide,
           c.t_start_ms, c.t_end_ms, ts_rank_cd(c.tsv, query, 1) as rank
    from source_chunks c
    join source_documents d on d.id = c.document_id,
         to_tsquery('english', ${q}) query
    where c.user_id = ${opts.userId} and c.course_id = ${opts.courseId} and d.status = 'ready' and c.tsv @@ query ${moduleFilter}
    order by rank desc, c.document_id, c.ordinal
    limit ${opts.limit ?? 8}`);
  return res.rows.map((r) => ({
    id: r.id, documentId: r.document_id, documentTitle: r.document_title, moduleId: r.module_id, ordinal: r.ordinal, kind: r.kind, text: r.text,
    heading: r.heading, page: r.page, slide: r.slide, tStartMs: r.t_start_ms, tEndMs: r.t_end_ms, rank: Number(r.rank),
  }));
}

/** Chunks that support a topic: its module's documents first, then the rest of the course. */
export async function chunksForTopic(opts: { userId: string; courseId: string; topicName: string; moduleId: string | null; limit?: number }): Promise<RetrievedChunk[]> {
  const limit = opts.limit ?? 6;
  if (opts.moduleId) {
    const scoped = await searchChunks({ userId: opts.userId, courseId: opts.courseId, query: opts.topicName, moduleIds: [opts.moduleId], limit });
    if (scoped.length >= Math.min(3, limit)) return scoped;
    const rest = await searchChunks({ userId: opts.userId, courseId: opts.courseId, query: opts.topicName, limit });
    const seen = new Set(scoped.map((c) => c.id));
    return [...scoped, ...rest.filter((c) => !seen.has(c.id))].slice(0, limit);
  }
  return searchChunks({ userId: opts.userId, courseId: opts.courseId, query: opts.topicName, limit });
}

export function locationLabel(c: { page: number | null; slide: number | null; tStartMs: number | null; heading: string | null }): string {
  const parts: string[] = [];
  if (c.page != null) parts.push(`p. ${c.page}`);
  if (c.slide != null) parts.push(`slide ${c.slide}`);
  if (c.tStartMs != null) {
    const s = Math.floor(c.tStartMs / 1000);
    parts.push(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`);
  }
  if (!parts.length && c.heading) parts.push(`“${c.heading.length > 40 ? c.heading.slice(0, 40) + "…" : c.heading}”`);
  return parts.join(", ");
}
