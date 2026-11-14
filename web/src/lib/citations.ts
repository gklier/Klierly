import { eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { Citation } from "@/db/schema";
import { locationLabel } from "@/lib/retrieval";

export type CitationView = { chunkId: string; documentId: string; title: string; location: string; quote: string; quoteVerified: boolean; available: boolean };

/** Resolve stored citations against live chunks. A source that was deleted is shown as unavailable, never guessed. */
export async function expandCitations(lists: Citation[][]): Promise<CitationView[][]> {
  const ids = [...new Set(lists.flat().map((c) => c.chunkId))];
  const rows = ids.length
    ? await db.select({
        id: schema.sourceChunks.id, page: schema.sourceChunks.page, slide: schema.sourceChunks.slide, tStartMs: schema.sourceChunks.tStartMs,
        heading: schema.sourceChunks.heading, documentId: schema.sourceChunks.documentId, title: schema.sourceDocuments.title,
      }).from(schema.sourceChunks).innerJoin(schema.sourceDocuments, eq(schema.sourceDocuments.id, schema.sourceChunks.documentId)).where(inArray(schema.sourceChunks.id, ids))
    : [];
  const map = new Map(rows.map((r) => [r.id, r]));
  return lists.map((list) => list.map((c) => {
    const r = map.get(c.chunkId);
    return r
      ? { chunkId: c.chunkId, documentId: r.documentId, title: r.title, location: locationLabel(r), quote: c.quote, quoteVerified: c.quoteVerified, available: true }
      : { chunkId: c.chunkId, documentId: c.documentId, title: "Source removed", location: "", quote: c.quote, quoteVerified: false, available: false };
  }));
}
