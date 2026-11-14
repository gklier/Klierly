"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { timingSafeEqual } from "node:crypto";
import { db, schema } from "@/db";
import { createSession, destroySession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/crypto";
import { env } from "@/lib/env";
import { rateLimit } from "@/lib/ratelimit";
import type { ActionState } from "@/components/forms";

const clientIp = async () => (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function registrationMode(): Promise<"first-user" | "invite" | "closed"> {
  if (env.inviteCode) return "invite";
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users);
  return (r?.n ?? 0) === 0 ? "first-user" : "closed";
}

export async function register(_: ActionState, fd: FormData): Promise<ActionState> {
  if (!rateLimit(`register:${await clientIp()}`, 8, 600_000).ok) return { error: "Too many attempts. Wait a few minutes and try again." };
  const name = String(fd.get("name") ?? "").trim().slice(0, 80);
  const email = String(fd.get("email") ?? "").trim().toLowerCase().slice(0, 200);
  const password = String(fd.get("password") ?? "");
  const invite = String(fd.get("invite") ?? "").trim();
  const mode = await registrationMode();
  if (mode === "closed") return { error: "Registration is closed on this server. Ask the owner for an invite code." };
  if (mode === "invite") {
    const a = Buffer.from(invite), b = Buffer.from(env.inviteCode!);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return { error: "That invite code is not valid." };
  }
  if (!name) return { error: "Enter your name." };
  if (!EMAIL.test(email)) return { error: "Enter a valid email address." };
  if (password.length < 10) return { error: "Use a password of at least 10 characters." };
  if (password.length > 200) return { error: "That password is too long." };
  const [existing] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (existing) return { error: "An account with that email already exists. Sign in instead." };
  const [user] = await db.insert(schema.users).values({ name, email, passwordHash: await hashPassword(password) }).returning({ id: schema.users.id });
  await createSession(user.id);
  redirect("/");
}

export async function login(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const ip = await clientIp();
  if (!rateLimit(`login:${ip}`, 20, 300_000).ok || !rateLimit(`login:${email}`, 8, 300_000).ok) return { error: "Too many sign-in attempts. Wait a few minutes and try again." };
  const [user] = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  // Always run a hash comparison so timing does not reveal whether the email exists.
  const ok = await verifyPassword(password, user?.passwordHash ?? "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==");
  if (!user || !ok) return { error: "Email or password is incorrect." };
  await createSession(user.id);
  redirect("/");
}

export async function logout() {
  await destroySession();
  redirect("/login");
}
