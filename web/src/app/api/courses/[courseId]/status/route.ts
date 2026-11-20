import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import { getUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Polled by the Materials page while imports are in progress. */
export async function GET(_: Request, { params }: { params: Promise<{ courseId: string }> }) {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: { code: "unauthorized", message: "Sign in first." } }, { status: 401 });
  const rows = await db.select({ id: schema.sourceDocuments.id, status: schema.sourceDocuments.status }).from(schema.sourceDocuments)
    .where(and(eq(schema.sourceDocuments.courseId, (await params).courseId), eq(schema.sourceDocuments.userId, user.id), inArray(schema.sourceDocuments.status, ["queued", "processing"])));
  return NextResponse.json({ pending: rows.length });
}
