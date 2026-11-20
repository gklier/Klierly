import { NextResponse } from "next/server";
import { asc, desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { userFromExtensionToken } from "@/lib/auth";
import { corsHeaders, extError, preflight } from "@/lib/ext";
import { rateLimit } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";
export const OPTIONS = preflight;

export async function GET(req: Request) {
  const user = await userFromExtensionToken(req.headers.get("authorization"));
  if (!user) return extError(req, 401, "invalid_token", "The pairing token is missing or no longer valid. Create a new one in Klierly → Settings → Browser extension.");
  if (!rateLimit(`ext:${user.id}`, 120, 600_000).ok) return extError(req, 429, "rate_limited", "Too many requests. Try again in a few minutes.");
  const courses = await db.select({ id: schema.courses.id, name: schema.courses.name }).from(schema.courses).where(eq(schema.courses.userId, user.id)).orderBy(desc(schema.courses.createdAt));
  const modules = await db.select({ id: schema.modules.id, name: schema.modules.name, courseId: schema.modules.courseId }).from(schema.modules).where(eq(schema.modules.userId, user.id)).orderBy(asc(schema.modules.position));
  return NextResponse.json({
    user: { email: user.email },
    courses: courses.map((c) => ({ ...c, modules: modules.filter((m) => m.courseId === c.id).map((m) => ({ id: m.id, name: m.name })) })),
  }, { headers: corsHeaders(req) });
}
