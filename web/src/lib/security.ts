import { cookies, headers } from "next/headers";
import { and, eq, gt, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "./env";
import { requireUser, SESSION_COOKIE } from "./auth";
import { sha256 } from "./crypto";

export async function clientIdentity(): Promise<string> {
  const h = await headers();
  // Enable only for an origin reachable exclusively through a trusted Cloudflare ingress.
  return process.env.TRUST_CLOUDFLARE === "true" ? (h.get("cf-connecting-ip") ?? "unknown") : "local";
}

export async function consumeLimit(key: string, limit: number, windowSeconds: number) {

  const result = await db.execute<{ count: number }>(sql`
    insert into security_limits (key, count, expires_at) values (${key}, 1, now() + ${windowSeconds} * interval '1 second')
    on conflict (key) do update set
      count = case when security_limits.expires_at <= now() then 1 else security_limits.count + 1 end,
      expires_at = case when security_limits.expires_at <= now() then now() + ${windowSeconds} * interval '1 second' else security_limits.expires_at end
    returning count`);
  if ((result.rows[0]?.count ?? limit + 1) > limit) throw new Error("Too many attempts. Please wait before trying again.");
}

export async function currentSessionId() {
  return sha256((await cookies()).get(SESSION_COOKIE)?.value ?? "");
}

export async function requireRecentUser(scope: string) {
  const user = await requireUser();
  const [session] = await db.update(schema.sessions).set({ reauthScope: null, reauthExpiresAt: null }).where(and(
    eq(schema.sessions.id, await currentSessionId()), eq(schema.sessions.userId, user.id),
    eq(schema.sessions.reauthScope, scope), gt(schema.sessions.reauthExpiresAt, new Date()),
  )).returning({ id: schema.sessions.id });
  if (!session) throw new Error("Confirm this change with your passkey.");
  return user;
}

export async function requireAdmin(scope: string) {
  const user = await requireRecentUser(scope);
  if (!user.isAdmin) throw new Error("Access denied.");
  return user;
}

export function passkeySite() {
  const url = new URL(env.appUrl);
  if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) throw new Error("APP_URL must be a website origin.");
  if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) throw new Error("Passkeys require HTTPS or localhost.");
  return { origin: url.origin, rpID: url.hostname };
}
