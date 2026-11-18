"use server";

import { cookies } from "next/headers";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import {
  generateAuthenticationOptions, generateRegistrationOptions,
  verifyAuthenticationResponse, verifyRegistrationResponse,
  type AuthenticationResponseJSON, type RegistrationResponseJSON, type AuthenticatorTransport,
} from "@simplewebauthn/server";
import { confirmationScope, validConfirmationScope } from "@/lib/approval-scope";
import { db, schema, type Tx } from "@/db";
import { issueSession, setSessionCookie, requireUser, sameOrigin } from "@/lib/auth";
import { randomToken, sha256 } from "@/lib/crypto";
import { env } from "@/lib/env";
import { clientIdentity, consumeLimit, currentSessionId, passkeySite, requireRecentUser } from "@/lib/security";

const CHALLENGE_COOKIE = env.secureCookies ? "__Host-cl_webauthn" : "cl_webauthn";
const invalid = () => new Error("The passkey request expired or could not be verified. Please start again.");

async function begin() {
  if (!(await sameOrigin())) throw invalid();
  await consumeLimit(`passkey:${sha256(await clientIdentity())}`, 30, 60);
  await db.delete(schema.webauthnChallenges).where(lt(schema.webauthnChallenges.expiresAt, new Date()));
}

async function saveChallenge(challenge: string, purpose: "login" | "enroll" | "add" | "stepup", userId?: string, invitationId?: string, scope?: string) {
  const jar = await cookies();
  const previous = jar.get(CHALLENGE_COOKIE)?.value;
  if (previous) await db.delete(schema.webauthnChallenges).where(eq(schema.webauthnChallenges.id, sha256(previous)));
  const token = randomToken();
  await db.insert(schema.webauthnChallenges).values({ id: sha256(token), challenge, purpose, userId, invitationId, sessionId: purpose === "add" || purpose === "stepup" ? await currentSessionId() : null, scope, expiresAt: new Date(Date.now() + (purpose === "add" ? 30_000 : 300_000)) });
  jar.set(CHALLENGE_COOKIE, token, { httpOnly: true, secure: env.secureCookies, sameSite: "strict", path: "/", maxAge: 300 });
}

async function consumeChallenge(purposes: string[]) {
  if (!(await sameOrigin())) throw invalid();
  const jar = await cookies();
  const token = jar.get(CHALLENGE_COOKIE)?.value;
  jar.delete(CHALLENGE_COOKIE);
  if (!token || token.length > 100) throw invalid();
  const [row] = await db.delete(schema.webauthnChallenges).where(and(
    eq(schema.webauthnChallenges.id, sha256(token)), gt(schema.webauthnChallenges.expiresAt, new Date()),
  )).returning();
  if (!row || !purposes.includes(row.purpose)) throw invalid();
  return row;
}

export async function authenticationOptions(scope?: string) {
  await begin();
  const options = await generateAuthenticationOptions({ rpID: passkeySite().rpID, userVerification: "required" });
  if (scope) {
    if (!validConfirmationScope(scope)) throw invalid();
    const user = await requireUser();
    await saveChallenge(options.challenge, "stepup", user.id, undefined, scope);
  } else {
    await saveChallenge(options.challenge, "login");
  }
  return options;
}

export async function authenticate(response: AuthenticationResponseJSON) {
  const challenge = await consumeChallenge(["login", "stepup"]);
  if (typeof response?.id !== "string" || response.id.length > 2048) throw invalid();
  const [credential] = await db.select().from(schema.passkeys).where(eq(schema.passkeys.id, response.id)).limit(1);
  if (!credential) throw invalid();
  const site = passkeySite();
  const result = await verifyAuthenticationResponse({
    response, expectedChallenge: challenge.challenge, expectedOrigin: site.origin, expectedRPID: site.rpID,
    requireUserVerification: true,
    credential: { id: credential.id, publicKey: new Uint8Array(Buffer.from(credential.publicKey, "base64url")), counter: credential.counter, transports: credential.transports },
  });
  if (!result.verified) throw invalid();
  if (response.response.userHandle && response.response.userHandle !== Buffer.from(credential.userId).toString("base64url")) throw invalid();
  const session = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, credential.userId)).for("update");
    if (!user || user.disabled) throw invalid();
    const updated = await tx.update(schema.passkeys).set({ counter: result.authenticationInfo.newCounter })
      .where(and(eq(schema.passkeys.id, credential.id), eq(schema.passkeys.counter, credential.counter))).returning({ id: schema.passkeys.id });
    if (!updated.length) throw invalid();
    if (challenge.purpose === "stepup") {
      if (challenge.userId !== user.id || challenge.sessionId !== await currentSessionId()) throw invalid();
      const approved = await tx.update(schema.sessions).set({ reauthScope: challenge.scope, reauthExpiresAt: new Date(Date.now() + 30_000) })
        .where(and(eq(schema.sessions.id, challenge.sessionId!), eq(schema.sessions.userId, user.id), gt(schema.sessions.expiresAt, new Date()))).returning();
      if (!approved.length) throw invalid();
      return null;
    }
    const existingSession = await currentSessionId();
    await tx.delete(schema.sessions).where(eq(schema.sessions.id, existingSession));
    return issueSession(tx, user.id);
  });
  if (session) await setSessionCookie(session);
  return { ok: true };
}

export async function registrationOptions(invitation: string | null) {
  await begin();
  let userId: string;
  let invitationId: string | undefined;
  if (invitation) {
    if (!/^[A-Za-z0-9_-]{40,100}$/.test(invitation)) throw invalid();
    invitationId = sha256(invitation);
    const [invite] = await db.select().from(schema.accountInvitations).where(and(eq(schema.accountInvitations.id, invitationId), gt(schema.accountInvitations.expiresAt, new Date()))).limit(1);
    if (!invite) throw invalid();
    userId = invite.userId;
  } else {
    userId = (await requireRecentUser("passkey-add")).id;
  }
  const [user] = await db.select().from(schema.users).where(and(eq(schema.users.id, userId), eq(schema.users.disabled, false))).limit(1);
  if (!user) throw invalid();
  const existing = await db.select().from(schema.passkeys).where(eq(schema.passkeys.userId, userId));
  if (existing.length >= 8) throw new Error("You already have eight passkeys.");
  const options = await generateRegistrationOptions({
    rpName: "Klierly", rpID: passkeySite().rpID, userID: new Uint8Array(Buffer.from(user.id)), userName: user.email, userDisplayName: user.name,
    attestationType: "none", authenticatorSelection: { residentKey: "required", userVerification: "required" },
    excludeCredentials: existing.map((key) => ({ id: key.id, transports: key.transports })),
  });
  await saveChallenge(options.challenge, invitationId ? "enroll" : "add", userId, invitationId);
  return options;
}

export async function registerPasskey(response: RegistrationResponseJSON, name: string) {
  const challenge = await consumeChallenge(["enroll", "add"]);
  if (!challenge.userId) throw invalid();
  if (challenge.purpose === "add" && (await requireUser()).id !== challenge.userId) throw invalid();
  const site = passkeySite();
  const result = await verifyRegistrationResponse({ response, expectedChallenge: challenge.challenge, expectedOrigin: site.origin, expectedRPID: site.rpID, requireUserVerification: true });
  if (!result.verified || !result.registrationInfo) throw invalid();
  const info = result.registrationInfo.credential;
  const session = await db.transaction(async (tx) => {
    const [user] = await tx.select().from(schema.users).where(eq(schema.users.id, challenge.userId!)).for("update");
    if (!user || user.disabled) throw invalid();
    if (challenge.purpose === "add") {
      if (challenge.sessionId !== await currentSessionId()) throw invalid();
      const [session] = await tx.select().from(schema.sessions).where(and(eq(schema.sessions.id, challenge.sessionId!), eq(schema.sessions.userId, user.id), gt(schema.sessions.expiresAt, new Date())));
      if (!session) throw invalid();
    }
    if (challenge.purpose === "enroll") {
      const claimed = await tx.delete(schema.accountInvitations).where(and(eq(schema.accountInvitations.id, challenge.invitationId!), eq(schema.accountInvitations.userId, user.id), gt(schema.accountInvitations.expiresAt, new Date()))).returning();
      if (!claimed.length) throw invalid();
    }
    const existing = await tx.select({ id: schema.passkeys.id }).from(schema.passkeys).where(eq(schema.passkeys.userId, user.id));
    if (existing.length >= 8) throw invalid();
    await tx.insert(schema.passkeys).values({ id: info.id, userId: user.id, publicKey: Buffer.from(info.publicKey).toString("base64url"), counter: info.counter, transports: (info.transports ?? []).filter((transport): transport is AuthenticatorTransport => ["ble", "cable", "hybrid", "internal", "nfc", "smart-card", "usb"].includes(transport)), name: name.trim().slice(0, 80) || "Passkey" });
    await tx.delete(schema.sessions).where(eq(schema.sessions.id, await currentSessionId()));
    return issueSession(tx, user.id);
  });
  await setSessionCookie(session);
  return { ok: true };
}

export async function removePasskey(id: string) {
  const form = new FormData(); form.set("passkeyId", id);
  const user = await requireRecentUser(await confirmationScope("passkey-remove", form));
  await db.transaction(async (tx: Tx) => {
    await tx.execute(sql`select id from users where id = ${user.id} for update`);
    const keys = await tx.select({ id: schema.passkeys.id }).from(schema.passkeys).where(eq(schema.passkeys.userId, user.id));
    if (keys.length <= 1) throw new Error("Keep at least one passkey on your account.");
    await tx.delete(schema.passkeys).where(and(eq(schema.passkeys.id, id), eq(schema.passkeys.userId, user.id)));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, user.id));
    await tx.delete(schema.extensionTokens).where(eq(schema.extensionTokens.userId, user.id));
  });
  return { ok: true };
}
