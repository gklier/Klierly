import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { decryptSecret, sha256 } from "@/lib/crypto";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/ratelimit";

export class AiError extends Error {
  constructor(public code: "no_provider" | "limit_reached" | "rate_limited" | "blocked_endpoint" | "auth_failed" | "provider_error" | "bad_output" | "course_disallows_ai", message: string) {
    super(message);
  }
}

export type ProviderConfig = { baseUrl: string; model: string; apiKey: string };

const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.0\.0\.0|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)|\.local$|\.internal$/i;

/** Validate a user-supplied endpoint before the server ever calls it. */
export function checkBaseUrl(raw: string): { ok: true; url: string } | { ok: false; message: string } {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return { ok: false, message: "Enter a full URL such as https://api.example.com/v1." }; }
  if (u.username || u.password) return { ok: false, message: "Do not put credentials in the URL." };
  const isPrivate = PRIVATE_HOST.test(u.hostname);
  if (isPrivate && !env.allowPrivateAiEndpoints) return { ok: false, message: "Endpoints on localhost or private networks are disabled on this server." };
  if (u.protocol !== "https:" && !(u.protocol === "http:" && isPrivate)) return { ok: false, message: "Use an https:// endpoint (http:// is only allowed for localhost or private networks)." };
  return { ok: true, url: u.toString().replace(/\/+$/, "") };
}

export async function getProvider(userId: string) {
  const [row] = await db.select().from(schema.providerSettings).where(eq(schema.providerSettings.userId, userId)).limit(1);
  return row ?? null;
}

export async function usageToday(userId: string): Promise<number> {
  const since = new Date(); since.setHours(0, 0, 0, 0);
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.aiUsage)
    .where(and(eq(schema.aiUsage.userId, userId), gte(schema.aiUsage.createdAt, since), eq(schema.aiUsage.cached, false)));
  return r?.n ?? 0;
}

export function extractJson(content: string): unknown {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  try { return JSON.parse(trimmed); } catch { /* fall through */ }
  const start = trimmed.indexOf("{"), end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try { return JSON.parse(trimmed.slice(start, end + 1)); } catch { /* fall through */ }
  }
  throw new AiError("bad_output", "The AI provider did not return valid JSON.");
}

type ChatResult = { content: string; promptTokens: number | null; completionTokens: number | null };

/** One OpenAI-compatible chat completion. Never logs prompts, outputs or keys. */
export async function rawChat(cfg: ProviderConfig, messages: { role: "system" | "user"; content: string }[], opts: { json?: boolean; maxTokens?: number; timeoutMs?: number } = {}): Promise<ChatResult> {
  const checked = checkBaseUrl(cfg.baseUrl);
  if (!checked.ok) throw new AiError("blocked_endpoint", checked.message);
  const send = async (withFormat: boolean) => fetch(`${checked.url}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify({
      model: cfg.model, messages, temperature: 0.4, max_tokens: opts.maxTokens ?? 4000,
      ...(withFormat ? { response_format: { type: "json_object" } } : {}),
    }),
    redirect: "error",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
  });
  let res: Response;
  try {
    res = await send(Boolean(opts.json));
    // Some compatible servers reject response_format; retry once without it.
    if (res.status === 400 && opts.json) res = await send(false);
  } catch (e) {
    const timeout = e instanceof Error && e.name === "TimeoutError";
    throw new AiError("provider_error", timeout ? "The AI provider took too long to respond." : "Could not reach the AI provider. Check the base URL.");
  }
  if (res.status === 401 || res.status === 403) throw new AiError("auth_failed", "The AI provider rejected the API key.");
  if (res.status === 404) throw new AiError("provider_error", "The AI provider did not recognise the endpoint or model (404). Check the base URL and model ID.");
  if (res.status === 429) throw new AiError("rate_limited", "The AI provider is rate-limiting requests or the quota is used up. Try again later.");
  if (!res.ok) throw new AiError("provider_error", `The AI provider returned an error (${res.status}).`);
  const body = (await res.json().catch(() => null)) as { choices?: { message?: { content?: unknown } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } } | null;
  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new AiError("bad_output", "The AI provider returned an empty response.");
  return { content, promptTokens: body?.usage?.prompt_tokens ?? null, completionTokens: body?.usage?.completion_tokens ?? null };
}

/**
 * Chat call for a signed-in user: enforces the daily limit and a per-minute
 * limit, serves identical requests from cache, records usage (counts only).
 */
export async function chatJson(userId: string, purpose: string, system: string, user: string, opts: { cache?: boolean; maxTokens?: number } = {}): Promise<unknown> {
  const settings = await getProvider(userId);
  if (!settings) throw new AiError("no_provider", "No AI provider is connected. Add one in Settings to generate new material.");
  const cacheKey = sha256(JSON.stringify([userId, settings.baseUrl, settings.model, purpose, system, user]));
  if (opts.cache) {
    const [hit] = await db.select({ response: schema.aiCache.response }).from(schema.aiCache)
      .where(and(eq(schema.aiCache.key, cacheKey), eq(schema.aiCache.userId, userId))).limit(1);
    if (hit) {
      await db.insert(schema.aiUsage).values({ userId, purpose, model: settings.model, cached: true, ok: true });
      return hit.response;
    }
  }
  if ((await usageToday(userId)) >= settings.dailyRequestLimit) {
    throw new AiError("limit_reached", `Today's AI request limit (${settings.dailyRequestLimit}) is used up. Raise it in Settings or continue tomorrow.`);
  }
  const rl = rateLimit(`ai:${userId}`, 12, 60_000);
  if (!rl.ok) throw new AiError("rate_limited", `Too many AI requests at once. Try again in ${rl.retryAfterSec}s.`);
  const cfg = { baseUrl: settings.baseUrl, model: settings.model, apiKey: decryptSecret(settings.apiKeyEnc) };
  try {
    const out = await rawChat(cfg, [{ role: "system", content: system }, { role: "user", content: user }], { json: true, maxTokens: opts.maxTokens });
    const parsed = extractJson(out.content);
    await db.insert(schema.aiUsage).values({ userId, purpose, model: settings.model, promptTokens: out.promptTokens, completionTokens: out.completionTokens, ok: true });
    if (opts.cache) await db.insert(schema.aiCache).values({ key: cacheKey, userId, response: parsed as object }).onConflictDoNothing();
    return parsed;
  } catch (e) {
    await db.insert(schema.aiUsage).values({ userId, purpose, model: settings.model, ok: false });
    log("warn", "ai.call_failed", { purpose, code: e instanceof AiError ? e.code : "unexpected" });
    throw e;
  }
}
