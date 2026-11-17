import { and, eq, lt } from "drizzle-orm";
import { db, schema } from "@/db";
import { redact } from "./log";

export type ActivitySource = "web" | "extension" | "server";
const RETENTION_DAYS = 180;
const MAX_DETAILS_BYTES = 6000;

/**
 * Record something the user did, or the system did for them. Events and
 * counts only: values pass through the same redaction as server logs (keys
 * named like text / content / prompt / quote / token / key are dropped, long
 * strings truncated). Never throws: logging must not be able to break a feature.
 * Name token counts `inTok` / `outTok`: a key containing "token" is redacted.
 */
export async function logActivity(userId: string, event: string, opts: { courseId?: string | null; source?: ActivitySource; details?: Record<string, unknown> } = {}): Promise<void> {
  try {
    let details = redact(opts.details ?? {}) as Record<string, unknown>;
    if (JSON.stringify(details).length > MAX_DETAILS_BYTES) details = { truncated: true };
    await db.insert(schema.activityLog).values({ userId, courseId: opts.courseId ?? null, source: opts.source ?? "server", event: event.slice(0, 80), details });
    if (Math.random() < 0.02) await db.delete(schema.activityLog).where(and(eq(schema.activityLog.userId, userId), lt(schema.activityLog.at, new Date(Date.now() - RETENTION_DAYS * 86400_000))));
  } catch {
    /* intentionally silent */
  }
}

/** Extension events the server will accept from `/api/ext/log`, with the fields each may carry (counts and fixed labels only). */
export const EXTENSION_EVENTS = new Set(["discovery.scan", "discovery.run", "captions.read", "capture.blocked", "class.join"]);
