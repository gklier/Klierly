import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { eq } from "drizzle-orm";
import { db, getPool, schema } from "@/db";
import { kickJobs } from "@/lib/ingest/jobs";

export const FIXTURES = path.resolve(__dirname, "../../fixtures");
let migrated = false;

export async function prepareDb() {
  if (!migrated) { await migrate(drizzle(getPool()), { migrationsFolder: path.resolve(__dirname, "../drizzle") }); migrated = true; }
}

export async function makeUser(tag: string) {
  const email = `${tag}-${crypto.randomUUID().slice(0, 8)}@test.local`;
  const [u] = await db.insert(schema.users).values({ email, name: tag, passwordHash: "x" }).returning();
  return u;
}

export async function makeCourse(userId: string, name = "Test course") {
  const [c] = await db.insert(schema.courses).values({ userId, name, term: "Fall 2026" }).returning();
  return c;
}

export async function waitForDocument(documentId: string, timeoutMs = 30_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const [d] = await db.select().from(schema.sourceDocuments).where(eq(schema.sourceDocuments.id, documentId));
    if (!d) throw new Error("document disappeared");
    if (d.status === "ready" || d.status === "failed") return d;
    if (Date.now() > end) throw new Error(`timeout waiting for document (${d.status})`);
    kickJobs();
    await new Promise((r) => setTimeout(r, 100));
  }
}
