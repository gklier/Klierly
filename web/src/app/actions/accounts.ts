"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { env } from "@/lib/env";
import { randomToken, sha256 } from "@/lib/crypto";
import { consumeLimit, requireAdmin } from "@/lib/security";
import type { ActionState } from "@/components/forms";

export type AccountState = ActionState & { enrollmentUrl?: string };
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function approveAccount(_state: AccountState, form: FormData): Promise<AccountState> {
  const operator = await requireAdmin();
  await consumeLimit(`account-approval:${operator.id}`, 30, 3600);
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim();
  if (email.length > 200 || !emailPattern.test(email) || !name || name.length > 80) return { error: "Enter a valid email and name." };
  const token = randomToken(32);
  const user = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${email}))`);
    const [existing] = await tx.select().from(schema.users).where(eq(schema.users.email, email));
    if (existing) throw new Error("That account already exists. Use its enrollment or recovery control below.");
    const [created] = await tx.insert(schema.users).values({ email, name, passwordHash: "disabled" }).returning();
    await tx.insert(schema.accountInvitations).values({ id: sha256(token), userId: created.id, expiresAt: new Date(Date.now() + 86400_000) });
    return created;
  });
  revalidatePath("/admin");
  return { ok: `Account approved for ${user.email}. Reply to their request with this private link.`, enrollmentUrl: `${env.appUrl}/enroll#token=${token}` };
}

export async function recoverAccount(_state: AccountState, form: FormData): Promise<AccountState> {
  const operator = await requireAdmin();
  const id = String(form.get("userId") ?? "");
  if (id === operator.id) return { error: "Add a second passkey in Settings. Ask the server operator for recovery if you lose all passkeys." };
  if (form.get("verified") !== "on") return { error: "Confirm that you verified the requester's identity through their approved email address." };
  await consumeLimit(`account-recovery:${operator.id}`, 10, 3600);
  const token = randomToken(32);
  await db.transaction(async (tx) => {
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, id)).for("update");
    if (!user || user.isAdmin || user.disabled) throw new Error("This account cannot be recovered here.");
    await tx.delete(schema.accountInvitations).where(eq(schema.accountInvitations.userId, id));
    await tx.delete(schema.passkeys).where(eq(schema.passkeys.userId, id));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, id));
    await tx.delete(schema.extensionTokens).where(eq(schema.extensionTokens.userId, id));
    await tx.delete(schema.webauthnChallenges).where(eq(schema.webauthnChallenges.userId, id));
    await tx.insert(schema.accountInvitations).values({ id: sha256(token), userId: id, expiresAt: new Date(Date.now() + 86400_000) });
  });
  revalidatePath("/admin");
  return { ok: "Previous passkeys and sessions revoked. Send this private link to the verified account address.", enrollmentUrl: `${env.appUrl}/enroll#token=${token}` };
}

export async function setAccountDisabled(_state: ActionState, form: FormData): Promise<ActionState> {
  const operator = await requireAdmin();
  const id = String(form.get("userId") ?? "");
  const disabled = form.get("disabled") === "true";
  if (id === operator.id) return { error: "You cannot disable your own account." };
  await db.transaction(async (tx) => {
    const [user] = await tx.select().from(schema.users).where(and(eq(schema.users.id, id), eq(schema.users.isAdmin, false))).for("update");
    if (!user) throw new Error("Account not found.");
    await tx.update(schema.users).set({ disabled }).where(eq(schema.users.id, id));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, id));
    await tx.delete(schema.extensionTokens).where(eq(schema.extensionTokens.userId, id));
    await tx.delete(schema.accountInvitations).where(eq(schema.accountInvitations.userId, id));
    await tx.delete(schema.webauthnChallenges).where(eq(schema.webauthnChallenges.userId, id));
  });
  revalidatePath("/admin");
  return { ok: disabled ? "Account disabled and access revoked." : "Account enabled. Existing passkeys can sign in." };
}

export async function approveClassMember(_state: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  await db.update(schema.classMembers).set({ approved: form.get("approved") === "true" }).where(and(
    eq(schema.classMembers.userId, String(form.get("userId") ?? "")),
    eq(schema.classMembers.classId, String(form.get("classId") ?? "")),
  ));
  revalidatePath("/admin");
  return { ok: "Class membership updated." };
}
