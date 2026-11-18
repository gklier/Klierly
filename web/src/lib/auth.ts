import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq, gt } from "drizzle-orm";
import { cache } from "react";
import { db, schema, type Tx } from "@/db";
import { env } from "./env";
import { randomToken, sha256 } from "./crypto";

export const SESSION_COOKIE = "cl_session";
const SESSION_DAYS = 7;

export type AuthUser = { id: string; email: string; name: string; isAdmin: boolean };

export async function issueSession(tx: Tx, userId: string) {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await tx.insert(schema.sessions).values({ id: sha256(token), userId, expiresAt });
  return { token, expiresAt };
}

export async function setSessionCookie(session: { token: string; expiresAt: Date }) {
  (await cookies()).set(SESSION_COOKIE, session.token, {
    httpOnly: true, sameSite: "lax", secure: env.secureCookies, path: "/", expires: session.expiresAt,
  });
}


export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(schema.sessions).where(eq(schema.sessions.id, sha256(token)));
  jar.delete(SESSION_COOKIE);
}

export async function userFromSessionToken(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null;
  const rows = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name, isAdmin: schema.users.isAdmin })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.id, sha256(token)), gt(schema.sessions.expiresAt, new Date()), eq(schema.users.disabled, false)))
    .limit(1);
  return rows[0] ?? null;
}

export const getUser = cache(async (): Promise<AuthUser | null> => {
  return userFromSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
});

export async function requireUser(): Promise<AuthUser> {
  const user = await getUser();
  if (!user) redirect("/login");
  return user;
}

/**
 * CSRF defense for cookie-authenticated route handlers (server actions get the
 * same check from Next.js): a state-changing request must carry an Origin that
 * matches the host it was sent to.
 */
export async function sameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(env.appUrl).origin;
  } catch {
    return false;
  }
}

export async function userFromExtensionToken(authorization: string | null): Promise<AuthUser | null> {
  const m = /^Bearer\s+(clx_[A-Za-z0-9_-]{20,})$/.exec(authorization ?? "");
  if (!m) return null;
  const rows = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name, isAdmin: schema.users.isAdmin, tokenId: schema.extensionTokens.id })
    .from(schema.extensionTokens)
    .innerJoin(schema.users, eq(schema.users.id, schema.extensionTokens.userId))
    .where(and(eq(schema.extensionTokens.tokenHash, sha256(m[1])), gt(schema.extensionTokens.expiresAt, new Date()), eq(schema.users.disabled, false)))
    .limit(1);
  if (!rows[0]) return null;
  await db.update(schema.extensionTokens).set({ lastUsedAt: new Date() }).where(eq(schema.extensionTokens.id, rows[0].tokenId));
  return { id: rows[0].id, email: rows[0].email, name: rows[0].name, isAdmin: rows[0].isAdmin };
}
