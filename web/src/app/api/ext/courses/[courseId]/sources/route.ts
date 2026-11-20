import { NextResponse } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { userFromExtensionToken } from "@/lib/auth";
import { ownsCourse } from "@/lib/courses";
import { corsHeaders, extError, preflight } from "@/lib/ext";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

/** Sources that came from an external course site, so the extension can show what is new and report processing status. */
export async function GET(req: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const user = await userFromExtensionToken(req.headers.get("authorization"));
  if (!user) return extError(req, 401, "invalid_token", "The pairing token is missing or no longer valid.");
  const { courseId } = await params;
  if (!(await ownsCourse(user.id, courseId))) return extError(req, 404, "course_not_found", "That course does not exist.");
  const rows = await db.select({
    documentId: schema.sourceDocuments.id, externalId: schema.sourceDocuments.externalId, title: schema.sourceDocuments.title, status: schema.sourceDocuments.status,
    error: schema.sourceDocuments.error, importedAt: schema.sourceDocuments.createdAt,
  }).from(schema.sourceDocuments).where(and(eq(schema.sourceDocuments.courseId, courseId), eq(schema.sourceDocuments.userId, user.id), isNotNull(schema.sourceDocuments.externalId)));
  return NextResponse.json({ sources: rows }, { headers: corsHeaders(req) });
}
