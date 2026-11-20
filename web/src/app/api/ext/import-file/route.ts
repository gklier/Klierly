import { boundedRequest } from "@/lib/request-body";
import { NextResponse } from "next/server";
import { userFromExtensionToken } from "@/lib/auth";
import { env } from "@/lib/env";
import { corsHeaders, extError, externalIdOf, preflight } from "@/lib/ext";
import { assessAssessment } from "@/lib/ingest/guard";
import { createSource, IngestError } from "@/lib/ingest/pipeline";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** A course file the student chose to import through the extension. Same pipeline as a manual upload. */
export async function POST(req: Request) {
  const user = await userFromExtensionToken(req.headers.get("authorization"));
  if (!user) return extError(req, 401, "invalid_token", "The pairing token is missing or no longer valid.");
  if (!rateLimit(`ext-import:${user.id}`, 400, 600_000).ok) return extError(req, 429, "rate_limited", "Too many imports in a short time. Try again in a few minutes.");
  const limitMb = Math.round(env.maxUploadBytes / 1048576);
  if (Number(req.headers.get("content-length") ?? 0) > env.maxUploadBytes + 1048576) return extError(req, 413, "too_large", `Files can be at most ${limitMb} MB.`);
  let form: FormData;
  try { form = await (await boundedRequest(req, env.maxUploadBytes + 1048576)).formData(); } catch { return extError(req, 413, "too_large", "The upload is too large or malformed."); }
  const file = form.get("file");
  const field = (k: string) => { const v = form.get(k); return typeof v === "string" ? v.trim() : ""; };
  if (!(file instanceof File)) return extError(req, 400, "invalid_request", "No file was sent.");
  if (field("permissionConfirmed") !== "true") return extError(req, 400, "permission_required", "Confirm that you are allowed to use this material before importing.");
  if (file.size > env.maxUploadBytes) return extError(req, 413, "too_large", `“${file.name}” is larger than the ${limitMb} MB limit.`);
  const courseId = field("courseId");
  if (!/^[0-9a-f-]{36}$/.test(courseId)) return extError(req, 404, "course_not_found", "That course does not exist.");
  const url = /^https?:\/\//i.test(field("url")) ? field("url").slice(0, 500) : null;
  const title = field("title").slice(0, 200) || file.name;
  if (assessAssessment({ url, title, text: "" }).blocked) return extError(req, 422, "assessment_blocked", "This address looks like an assessment or a restricted page. Klierly does not import those.");
  try {
    const r = await createSource({
      userId: user.id, courseId, moduleId: null, kind: "file", title, filename: file.name.replace(/[\\/\u0000-\u001f]/g, "_"), mime: file.type || null,
      data: Buffer.from(await file.arrayBuffer()), originUrl: url, via: "extension", externalId: externalIdOf(field("externalId")), moduleName: field("moduleName") || null,
    });
    return NextResponse.json({ documentId: r.documentId, jobId: r.jobId, duplicate: r.duplicate, outcome: r.outcome, viewUrl: `${env.appUrl}/courses/${courseId}/materials/${r.documentId}` }, { status: r.duplicate ? 200 : 201, headers: corsHeaders(req) });
  } catch (e) {
    if (e instanceof IngestError) return extError(req, e.status, e.code, e.message);
    return extError(req, 500, "internal_error", "The import failed unexpectedly.");
  }
}
