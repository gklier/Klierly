import { NextResponse } from "next/server";
import { userFromExtensionToken } from "@/lib/auth";
import { env } from "@/lib/env";
import { corsHeaders, extError, preflight } from "@/lib/ext";
import { assessAssessment } from "@/lib/ingest/guard";
import { createSource, IngestError, MAX_PASTE_CHARS } from "@/lib/ingest/pipeline";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;
const uuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f-]{36}$/.test(v);

/** Browser-extension import. Same pipeline as upload and paste (createSource → ImportJob → worker). */
export async function POST(req: Request) {
  const user = await userFromExtensionToken(req.headers.get("authorization"));
  if (!user) return extError(req, 401, "invalid_token", "The pairing token is missing or no longer valid.");
  if (!rateLimit(`import:${user.id}`, 60, 600_000).ok) return extError(req, 429, "rate_limited", "Too many imports in a short time. Try again in a few minutes.");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_PASTE_CHARS * 4 + 10_000) return extError(req, 413, "too_large", "The captured page is too long to import at once.");
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return extError(req, 400, "invalid_request", "The request was not valid JSON."); }
  if (body.permissionConfirmed !== true) return extError(req, 400, "permission_required", "Confirm that you are allowed to use this material before importing.");
  const text = typeof body.text === "string" ? body.text : "";
  if (text.trim().length < 20) return extError(req, 400, "empty_capture", "The page had no readable text to import.");
  if (text.length > MAX_PASTE_CHARS) return extError(req, 413, "too_large", "The captured page is too long to import at once. Select the part you need and import the selection.");
  if (!uuid(body.courseId)) return extError(req, 404, "course_not_found", "That course does not exist.");
  const url = typeof body.url === "string" && /^https?:\/\//i.test(body.url) ? body.url.slice(0, 500) : null;
  const title = (typeof body.title === "string" ? body.title.trim().slice(0, 200) : "") || "Captured page";
  const signals = body.signals as { assessmentSuspected?: unknown } | undefined;
  const check = assessAssessment({ url, title, text });
  if (check.blocked || signals?.assessmentSuspected === true) {
    return extError(req, 422, "assessment_blocked", `This page looks like an active assessment or a restricted page${check.reasons.length ? ` (${check.reasons.join("; ")})` : ""}. Klierly does not import those.`);
  }
  try {
    const r = await createSource({ userId: user.id, courseId: body.courseId, moduleId: uuid(body.moduleId) ? body.moduleId : null, kind: "web", title, filename: "capture.txt", mime: "text/plain", data: Buffer.from(text, "utf8"), originUrl: url });
    return NextResponse.json({ documentId: r.documentId, jobId: r.jobId, duplicate: r.duplicate, viewUrl: `${env.appUrl}/courses/${body.courseId}/materials/${r.documentId}` }, { status: r.duplicate ? 200 : 201, headers: corsHeaders(req) });
  } catch (e) {
    if (e instanceof IngestError) return extError(req, e.status, e.code, e.message);
    return extError(req, 500, "internal_error", "The import failed unexpectedly.");
  }
}
