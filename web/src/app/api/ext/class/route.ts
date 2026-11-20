import { boundedRequest } from "@/lib/request-body";
import { NextResponse } from "next/server";
import { userFromExtensionToken } from "@/lib/auth";
import { joinClass } from "@/lib/classes";
import { ownsCourse } from "@/lib/courses";
import { corsHeaders, extError, preflight } from "@/lib/ext";
import { rateLimit } from "@/lib/ratelimit";
import { courseNameFromTitle, parseClassIdentity } from "@/lib/sharing-rules";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/**
 * The student opened this LMS course in their browser and asked to join its class library.
 * The server cannot confirm enrolment; this records the claim and optionally links one of their courses.
 */
export async function POST(req: Request) {
  const user = await userFromExtensionToken(req.headers.get("authorization"));
  if (!user) return extError(req, 401, "invalid_token", "The pairing token is missing or no longer valid. Create a new one in Klierly → Settings → Browser extension.");
  if (!rateLimit(`extclass:${user.id}`, 30, 600_000).ok) return extError(req, 429, "rate_limited", "Too many requests. Try again in a few minutes.");
  const body = (await (await boundedRequest(req, 1_610_000)).json().catch(() => null)) as Record<string, unknown> | null;
  const ident = parseClassIdentity({ ...body, label: typeof body?.label === "string" ? courseNameFromTitle(body.label) : undefined });
  if (!ident) return extError(req, 400, "bad_class", "That does not look like a Canvas course page.");
  if (body?.termsAccepted !== true) return extError(req, 400, "terms_required", "Accept the sharing terms before joining a class library.");
  const courseId = typeof body?.courseId === "string" ? body.courseId : null;
  if (courseId && !(await ownsCourse(user.id, courseId))) return extError(req, 404, "course_not_found", "That Klierly course was not found.");
  const res = await joinClass(user.id, ident, courseId);
  return NextResponse.json(res, { status: 200, headers: corsHeaders(req) });
}
