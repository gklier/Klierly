/** Fresh database and upload folder for an E2E run. Runs before the test server starts. */
import path from "node:path";
import fs from "node:fs";
import { Client, Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/\/klierly_e2e(\?|$)/.test(url)) throw new Error("reset-db only runs against the klierly_e2e database.");
  const admin = new Client({ connectionString: url.replace(/\/klierly_e2e/, "/postgres") });
  await admin.connect();
  await admin.query("drop database if exists klierly_e2e with (force)");
  await admin.query("create database klierly_e2e");
  await admin.end();
  const pool = new Pool({ connectionString: url });
  await migrate(drizzle(pool), { migrationsFolder: path.resolve(__dirname, "../drizzle") });
  await pool.end();
  if (process.env.UPLOAD_DIR?.includes("klierly-e2e")) fs.rmSync(process.env.UPLOAD_DIR, { recursive: true, force: true });
}

main().catch((e) => { console.error(e); process.exit(1); });
