import { boundedRequest } from "@/lib/request-body";
import { NextResponse } from "next/server";
import { getUser, sameOrigin } from "@/lib/auth";
import { env } from "@/lib/env";
import { createSource, IngestError } from "@/lib/ingest/pipeline";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
const err = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

/** One file per request so the browser can show per-file progress and failures. */
export async function POST(req: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const user = await getUser();
  if (!user) return err(401, "unauthorized", "Sign in first.");
  if (!(await sameOrigin())) return err(403, "bad_origin", "Cross-site requests are not allowed.");
  if (!rateLimit(`import:${user.id}`, 60, 600_000).ok) return err(429, "rate_limited", "Too many imports in a short time. Try again in a few minutes.");
  const limitMb = Math.round(env.maxUploadBytes / 1048576);
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > env.maxUploadBytes + 1048576) return err(413, "too_large", `Files can be at most ${limitMb} MB.`);
  let form: FormData;
  try { form = await (await boundedRequest(req, env.maxUploadBytes + 1048576)).formData(); } catch { return err(413, "too_large", "The upload is too large or malformed."); }
  const file = form.get("file");
  if (!(file instanceof File)) return err(400, "invalid_request", "No file was sent.");
  if (form.get("permission") !== "yes") return err(400, "permission_required", "Confirm that you are allowed to use this material for your own study.");
  if (file.size > env.maxUploadBytes) return err(413, "too_large", `“${file.name}” is larger than the ${limitMb} MB limit.`);
  const moduleId = String(form.get("moduleId") ?? "");
  try {
    const r = await createSource({
      userId: user.id, courseId: (await params).courseId, moduleId: /^[0-9a-f-]{36}$/.test(moduleId) ? moduleId : null, kind: "file",
      title: file.name, filename: file.name.replace(/[\\/\u0000-\u001f]/g, "_"), mime: file.type || null, data: Buffer.from(await file.arrayBuffer()), originUrl: null,
    });
    return NextResponse.json(r, { status: r.duplicate ? 200 : 201 });
  } catch (e) {
    if (e instanceof IngestError) return err(e.status, e.code, e.message);
    return err(500, "internal_error", "The upload failed unexpectedly.");
  }
}
