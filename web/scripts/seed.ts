/**
 * Create a local development account with the synthetic sample course.
 *   SEED_EMAIL=you@example.com SEED_PASSWORD='a long password' npm run db:seed
 * No default password exists: one must be supplied.
 */
import { eq } from "drizzle-orm";
import { loadEnv } from "./load-env";

loadEnv();

async function main() {
  const { db, getPool, schema } = await import("../src/db");
  const { hashPassword } = await import("../src/lib/crypto");
  const { hasSampleCourse, loadSampleCourse } = await import("../src/lib/sample");
  const email = (process.env.SEED_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.SEED_PASSWORD ?? "";
  if (!email || password.length < 10) throw new Error("Set SEED_EMAIL and SEED_PASSWORD (at least 10 characters).");
  let [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (!user) [user] = await db.insert(schema.users).values({ email, name: process.env.SEED_NAME ?? "Local owner", passwordHash: await hashPassword(password) }).returning();
  if (await hasSampleCourse(user.id)) console.log("Sample course already present.");
  else console.log(`Sample course created: ${await loadSampleCourse(user.id)}`);
  await getPool().end();
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
