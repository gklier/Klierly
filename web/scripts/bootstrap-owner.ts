/** Run once from the trusted server console after migrating. Never expose this operation over HTTP. */
import fs from "node:fs";
import path from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { Client } from "pg";
import { loadEnv } from "./load-env";

loadEnv();
async function main() {
  const userId = process.argv[2];
  const destination = process.argv[3];
  const origin = new URL(process.env.APP_URL ?? "");
  if (!/^[0-9a-f-]{36}$/.test(userId ?? "") || !destination || !path.isAbsolute(destination)) throw new Error("Usage: bootstrap-owner.ts <existing user UUID> <absolute private output file>");
  if (origin.protocol !== "https:" || origin.pathname !== "/" || origin.search || origin.hash || origin.username || origin.password) throw new Error("Set APP_URL to the final HTTPS origin first.");
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query("begin");
    const { rows } = await db.query("select id,email from users where id=$1 for update", [userId]);
    if (rows.length !== 1) throw new Error("Existing account was not found.");
    const keys = await db.query("select id from passkeys where user_id=$1", [userId]);
    if (keys.rows.length) throw new Error("This account already has passkeys. Manage it from Settings.");
    const token = randomBytes(32).toString("base64url");
    await db.query("update users set is_admin=true, disabled=false where id=$1", [userId]);
    await db.query("delete from account_invitations where user_id=$1", [userId]);
    await db.query("insert into account_invitations(id,user_id,expires_at) values($1,$2,now()+interval '24 hours')", [createHash("sha256").update(token).digest("hex"), userId]);
    fs.writeFileSync(destination, `${origin.origin}/enroll#token=${token}\n`, { mode: 0o600, flag: "wx" });
    await db.query("commit");
    console.log("Owner enrollment link written to the private output file. It expires in 24 hours.");
  } catch (error) {
    await db.query("rollback");
    throw error;
  } finally { await db.end(); }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : "Bootstrap failed"); process.exit(1); });
