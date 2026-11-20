import { randomBytes, createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { expect, type Page } from "@playwright/test";

const config = Object.fromEntries(fs.readFileSync(path.resolve(__dirname, "../.env.local"), "utf8").split("\n").map((line) => line.split(/=(.*)/s).slice(0, 2)));
export async function testDatabase() {
  const url = config.DATABASE_URL.replace(/\/klierly(\?|$)/, "/klierly_e2e$1");
  if (!/\/klierly_e2e(\?|$)/.test(url)) throw new Error("Only the isolated E2E database is allowed.");
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

export async function virtualPasskey(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const result = await cdp.send("WebAuthn.addVirtualAuthenticator", { options: { protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
  return { cdp, authenticatorId: result.authenticatorId };
}

export async function enrollTestAccount(page: Page, name: string, email: string) {
  const db = await testDatabase();
  const token = randomBytes(32).toString("base64url");
  try {
    await db.query("delete from security_limits");
    const { rows } = await db.query("insert into users(email,name,password_hash,is_admin) values($1,$2,'disabled',$3) returning id", [email, name, email === "founder@e2e.test"]);
    await db.query("insert into account_invitations(id,user_id,expires_at) values($1,$2,now()+interval '1 hour')", [createHash("sha256").update(token).digest("hex"), rows[0].id]);
  } finally { await db.end(); }
  await virtualPasskey(page);
  await page.goto(`/enroll#token=${token}`);
  await page.getByRole("button", { name: "Create a passkey", exact: true }).click();
  await page.waitForURL("/");
  await expect(page.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
}

export async function approveTestMemberships() {
  const db = await testDatabase();
  try {
    await db.query("update class_members set approved=true");
    await db.query("update class_spaces set sharing_enabled=true");
  } finally { await db.end(); }
}
