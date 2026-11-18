import { boundedRequest } from "@/lib/request-body";
import { NextResponse } from "next/server";
import { EXTENSION_EVENTS, logActivity } from "@/lib/activity";
import { userFromExtensionToken } from "@/lib/auth";
import { ownsCourse } from "@/lib/courses";
import { corsHeaders, extError, preflight } from "@/lib/ext";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/**
 * Run summaries from the extension (what a scan found, what an import did, why items failed).
 * Counts and fixed labels only: the extension never sends page text, and the server redacts
 * and size-limits whatever arrives, so this cannot become a side channel for course content.
 */
export async function POST(req: Request) {
  const user = await userFromExtensionToken(req.headers.get("authorization"));
  if (!user) return extError(req, 401, "invalid_token", "The pairing token is missing or no longer valid.");
  if (!rateLimit(`ext-log:${user.id}`, 200, 600_000).ok) return extError(req, 429, "rate_limited", "Too many log events.");
  if (Number(req.headers.get("content-length") ?? 0) > 20_000) return extError(req, 413, "too_large", "Log event too large.");
  let body: { event?: unknown; courseId?: unknown; details?: unknown };
  try { body = await (await boundedRequest(req, 1_610_000)).json(); } catch { return extError(req, 400, "invalid_request", "Not valid JSON."); }
  if (typeof body.event !== "string" || !EXTENSION_EVENTS.has(body.event)) return extError(req, 400, "invalid_event", "Unknown event.");
  const details = body.details && typeof body.details === "object" && !Array.isArray(body.details) ? (body.details as Record<string, unknown>) : {};
  const courseId = typeof body.courseId === "string" && (await ownsCourse(user.id, body.courseId)) ? body.courseId : null;
  await logActivity(user.id, `extension.${body.event}`, { courseId, source: "extension", details });
  return NextResponse.json({ ok: true }, { headers: corsHeaders(req) });
}
