import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { getUser } from "@/lib/auth";
import { readFile } from "@/lib/ingest/storage";

export const dynamic = "force-dynamic";

/** Download the original file. Always sent as an attachment so nothing uploaded is ever rendered as a page. */
export async function GET(_: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const user = await getUser();
  const id = (await params).documentId;
  if (!user || !/^[0-9a-f-]{36}$/.test(id)) return new NextResponse("Not found", { status: 404 });
  const [doc] = await db.select().from(schema.sourceDocuments).where(and(eq(schema.sourceDocuments.id, id), eq(schema.sourceDocuments.userId, user.id))).limit(1);
  if (!doc) return new NextResponse("Not found", { status: 404 });
  let data: Buffer;
  try { data = await readFile(doc.storagePath); } catch { return new NextResponse("The original file is no longer stored.", { status: 404 }); }
  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cache-Control": "private, no-store",
    },
  });
}
