"use server";

import { confirmationScope } from "@/lib/approval-scope";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ActionState } from "@/components/forms";
import { AiError, checkBaseUrl, getProvider, rawChat } from "@/lib/ai/provider";
import { destroySession, requireUser } from "@/lib/auth";
import { deleteAccount } from "@/lib/courses";
import { decryptSecret, encryptSecret, randomToken, sha256 } from "@/lib/crypto";
import { removePasskey } from "@/app/actions/passkeys";
import { requireRecentUser } from "@/lib/security";
import { rateLimit } from "@/lib/ratelimit";
import { logActivity } from "@/lib/activity";

export async function saveProvider(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireUser();
  const existing = await getProvider(user.id);
  const checked = checkBaseUrl(String(fd.get("baseUrl") ?? ""));
  if (!checked.ok) return { error: checked.message };
  const model = String(fd.get("model") ?? "").trim().slice(0, 120);
  if (!model) return { error: "Enter the model ID exactly as your provider lists it." };
  const key = String(fd.get("apiKey") ?? "").trim();
  if (!key && !existing) return { error: "Enter an API key." };
  if (key.length > 500) return { error: "That API key is too long." };
  if (fd.get("disclosure") !== "on") return { error: "Confirm that you understand what is sent to this provider." };
  const limit = Math.min(1000, Math.max(1, Math.round(Number(fd.get("dailyRequestLimit")) || 60)));
  const preset = fd.get("preset") === "navigator-experimental" ? "navigator-experimental" as const : fd.get("preset") === "google-ai-studio" ? "google-ai-studio" as const : "openai-compatible" as const;
  const secret = key ? { apiKeyEnc: encryptSecret(key), keyHint: `…${key.slice(-4)}` } : {};
  const values = { preset, baseUrl: checked.url, model, dailyRequestLimit: limit, disclosureAckAt: new Date(), updatedAt: new Date(), lastTestAt: null, lastTestOk: null, ...secret };
  if (existing) await db.update(schema.providerSettings).set(values).where(eq(schema.providerSettings.userId, user.id));
  else await db.insert(schema.providerSettings).values({ userId: user.id, ...values, apiKeyEnc: secret.apiKeyEnc!, keyHint: secret.keyHint! });
  revalidatePath("/settings");
  await logActivity(user.id, "settings.provider_saved", { source: "web", details: { host: new URL(checked.url).host, model, preset, dailyLimit: limit, keyChanged: Boolean(key) } });
  return { ok: "Saved. Use “Test connection” to check that it works." };
}

export async function testProvider(_: ActionState): Promise<ActionState> {
  const user = await requireUser();
  const p = await getProvider(user.id);
  if (!p) return { error: "Save a provider first." };
  if (!rateLimit(`aitest:${user.id}`, 6, 60_000).ok) return { error: "Too many tests in a row. Wait a minute." };
  let result: ActionState;
  try {
    await rawChat({ baseUrl: p.baseUrl, model: p.model, apiKey: decryptSecret(p.apiKeyEnc) }, [{ role: "user", content: "Reply with the single word: ok" }], { maxTokens: 16, timeoutMs: 30_000 });
    result = { ok: `Connected. ${new URL(p.baseUrl).host} answered with model “${p.model}”.` };
  } catch (e) {
    result = { error: e instanceof AiError ? e.message : "The saved API key could not be read. Enter it again." };
  }
  await db.update(schema.providerSettings).set({ lastTestAt: new Date(), lastTestOk: Boolean(result?.ok) }).where(eq(schema.providerSettings.userId, user.id));
  revalidatePath("/settings");
  await logActivity(user.id, "settings.provider_tested", { source: "web", details: { ok: Boolean(result?.ok), error: result?.error } });
  return result;
}

export async function removeProvider(_: ActionState): Promise<ActionState> {
  const user = await requireUser();
  await db.delete(schema.providerSettings).where(eq(schema.providerSettings.userId, user.id));
  await db.delete(schema.aiCache).where(eq(schema.aiCache.userId, user.id));
  revalidatePath("/settings");
  await logActivity(user.id, "settings.provider_removed", { source: "web" });
  return { ok: "The provider and its saved key were removed." };
}

/** The pairing token is shown exactly once; only its hash is stored. */
export async function createExtensionToken(_: ActionState, fd: FormData): Promise<ActionState & { token?: string }> {
  const user = await requireRecentUser(await confirmationScope("extension-token", fd));
  const token = `clx_${randomToken(30)}`;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select id from users where id = ${user.id} for update`);
    const existing = await tx.select({ id: schema.extensionTokens.id }).from(schema.extensionTokens).where(eq(schema.extensionTokens.userId, user.id));
    if (existing.length >= 5) throw new Error("You already have 5 pairing tokens. Revoke one first.");
    await tx.insert(schema.extensionTokens).values({ userId: user.id, tokenHash: sha256(token), label: String(fd.get("label") ?? "").trim().slice(0, 60) || "Browser extension" });
  });
  revalidatePath("/settings");
  await logActivity(user.id, "settings.token_created", { source: "web" });
  return { ok: "Token created.", token };
}

export async function revokeExtensionToken(fd: FormData) {
  const user = await requireUser();
  await db.delete(schema.extensionTokens).where(and(eq(schema.extensionTokens.id, String(fd.get("tokenId") ?? "")), eq(schema.extensionTokens.userId, user.id)));
  await logActivity(user.id, "settings.token_revoked", { source: "web" });
  revalidatePath("/settings");
}

export async function deleteAccountAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const user = await requireRecentUser("account-delete");
  if (fd.get("confirm") !== "DELETE") return { error: "Type DELETE to confirm." };
  await destroySession();
  await deleteAccount(user.id);
  redirect("/login");
}

export async function clearActivityAction(_: ActionState): Promise<ActionState> {
  const user = await requireUser();
  const gone = await db.delete(schema.activityLog).where(eq(schema.activityLog.userId, user.id)).returning({ id: schema.activityLog.id });
  revalidatePath("/activity");
  return { ok: `Deleted ${gone.length} ${gone.length === 1 ? "event" : "events"}.` };
}

export async function removePasskeyAction(_: ActionState, form: FormData): Promise<ActionState> {
  await removePasskey(String(form.get("passkeyId") ?? ""));
  redirect("/login");
}
