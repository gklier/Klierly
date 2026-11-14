import { and, eq, gte, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { decryptSecret, sha256 } from "@/lib/crypto";
import { env } from "@/lib/env";
import { log } from "@/lib/log";
import { rateLimit } from "@/lib/ratelimit";
import { logActivity } from "@/lib/activity";

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

const startOfDay = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const startOfMonth = () => { const d = startOfDay(); d.setDate(1); return d; };

export type AiKind = "managed" | "byok";

/** Billable (non-cached) requests today, per provider kind. */
export async function usageToday(userId: string, kind: AiKind = "byok"): Promise<number> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.aiUsage)
    .where(and(eq(schema.aiUsage.userId, userId), gte(schema.aiUsage.createdAt, startOfDay()), eq(schema.aiUsage.cached, false), eq(schema.aiUsage.provider, kind)));
  return r?.n ?? 0;
}

async function managedUsage(userId: string) {
  const tokens = sql<number>`coalesce(sum(coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0)), 0)::int`;
  const managed = and(eq(schema.aiUsage.provider, "managed"), eq(schema.aiUsage.cached, false));
  const [[userMonth], [globalDay], [globalMonth]] = await Promise.all([
    db.select({ tokens }).from(schema.aiUsage).where(and(managed, eq(schema.aiUsage.userId, userId), gte(schema.aiUsage.createdAt, startOfMonth()))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.aiUsage).where(and(managed, gte(schema.aiUsage.createdAt, startOfDay()))),
    db.select({ micro: sql<number>`coalesce(sum(cost_micro_usd), 0)::bigint` }).from(schema.aiUsage).where(and(managed, gte(schema.aiUsage.createdAt, startOfMonth()))),
  ]);
  return { userDay: await usageToday(userId, "managed"), userMonthTokens: userMonth?.tokens ?? 0, globalDay: globalDay?.n ?? 0, globalMonthUsd: Number(globalMonth?.micro ?? 0) / 1e6 };
}

export type AiStatus =
  | { available: false; kind: null; reason: string }
  | { available: boolean; kind: "byok"; label: string; host: string; model: string; usedToday: number; dailyLimit: number; reason?: string }
  | { available: boolean; kind: "managed"; label: string; host: string; usedToday: number; dailyLimit: number; tokensThisMonth: number; monthlyTokenLimit: number; reason?: string };

/**
 * Which AI a user gets, and whether a request would go through right now.
 * A user's own key (BYOK) takes precedence; otherwise the Klierly-managed
 * provider is used if the operator configured one. Safe to send to the browser:
 * contains no credentials.
 */
export async function aiStatus(userId: string): Promise<AiStatus> {
  const own = await getProvider(userId);
  if (own) {
    const usedToday = await usageToday(userId, "byok");
    const over = usedToday >= own.dailyRequestLimit;
    return { available: !over, kind: "byok", label: "Your AI provider", host: new URL(own.baseUrl).host, model: own.model, usedToday, dailyLimit: own.dailyRequestLimit,
      ...(over ? { reason: `Today's limit of ${own.dailyRequestLimit} requests on your own provider is used up. Raise it in Settings or continue tomorrow.` } : {}) };
  }
  const m = env.managedAi;
  if (!m) return { available: false, kind: null, reason: "No AI is set up on this server. Practice with existing questions still works; generating new ones needs an AI connection." };
  const u = await managedUsage(userId);
  const base = { kind: "managed" as const, label: m.label, host: new URL(m.baseUrl).host, usedToday: u.userDay, dailyLimit: m.userDailyRequests, tokensThisMonth: u.userMonthTokens, monthlyTokenLimit: m.userMonthlyTokens };
  const reason =
    u.userDay >= m.userDailyRequests ? `You have used today's ${m.userDailyRequests} free AI requests. They reset at midnight; you can also connect your own provider in Settings.`
    : u.userMonthTokens >= m.userMonthlyTokens ? "You have used this month's free AI allowance. It resets on the 1st; you can also connect your own provider in Settings."
    : u.globalDay >= m.globalDailyRequests ? "The shared free AI allowance for today is used up for everyone. Try again tomorrow or connect your own provider in Settings."
    : m.globalMonthlyUsd > 0 && u.globalMonthUsd >= m.globalMonthlyUsd ? "The shared free AI budget for this month is used up. Connect your own provider in Settings to keep generating."
    : null;
  return reason ? { ...base, available: false, reason } : { ...base, available: true };
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
export async function rawChat(cfg: ProviderConfig, messages: { role: "system" | "user"; content: string }[], opts: { json?: boolean; maxTokens?: number; timeoutMs?: number; trusted?: boolean } = {}): Promise<ChatResult> {
  // `trusted` is only for the operator-configured managed endpoint; user-supplied URLs are always checked.
  const checked = opts.trusted ? { ok: true as const, url: cfg.baseUrl.replace(/\/+$/, "") } : checkBaseUrl(cfg.baseUrl);
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

const estimateTokens = (text: string) => Math.ceil(text.length / 4);

/**
 * Chat call for a signed-in user. Resolves BYOK or the managed provider,
 * enforces quotas and a per-minute limit, serves identical requests from
 * cache, and records requests, tokens and estimated cost (never content).
 * `tier: "strong"` uses the stronger managed model when one is configured.
 */
export async function chatJson(userId: string, purpose: string, system: string, user: string, opts: { cache?: boolean; maxTokens?: number; tier?: "routine" | "strong" } = {}): Promise<unknown> {
  const status = await aiStatus(userId);
  if (!status.kind) throw new AiError("no_provider", status.reason);
  const m = env.managedAi;
  const own = status.kind === "byok" ? await getProvider(userId) : null;
  const tier = status.kind === "managed" && opts.tier === "strong" && m?.strongModel ? "strong" as const : "routine" as const;
  const cfg: ProviderConfig = own
    ? { baseUrl: own.baseUrl, model: own.model, apiKey: decryptSecret(own.apiKeyEnc) }
    : { baseUrl: m!.baseUrl, model: tier === "strong" ? m!.strongModel! : m!.model, apiKey: m!.apiKey };
  const usageBase = { userId, purpose, model: cfg.model, provider: status.kind, tier };

  const cacheKey = sha256(JSON.stringify([userId, cfg.baseUrl, cfg.model, purpose, system, user]));
  if (opts.cache) {
    const [hit] = await db.select({ response: schema.aiCache.response }).from(schema.aiCache)
      .where(and(eq(schema.aiCache.key, cacheKey), eq(schema.aiCache.userId, userId))).limit(1);
    if (hit) {
      await db.insert(schema.aiUsage).values({ ...usageBase, cached: true, ok: true });
      return hit.response;
    }
  }
  if (!status.available) throw new AiError("limit_reached", status.reason ?? "The AI allowance is used up.");
  // One Generate click over 8 topics makes up to 16 calls (first attempt + one retry each), so the burst limit leaves room for two such clicks a minute. Daily and monthly quotas do the real limiting.
  const rl = rateLimit(`ai:${userId}`, 40, 60_000);
  if (!rl.ok) throw new AiError("rate_limited", `Too many AI requests at once. Try again in ${rl.retryAfterSec}s.`);
  // Cap the response size on the managed provider so one request cannot burn the shared budget.
  const maxTokens = status.kind === "managed" ? Math.min(opts.maxTokens ?? 3000, 3000) : opts.maxTokens;
  try {
    const out = await rawChat(cfg, [{ role: "system", content: system }, { role: "user", content: user }], { json: true, maxTokens, trusted: status.kind === "managed" });
    const parsed = extractJson(out.content);
    const promptTokens = out.promptTokens ?? estimateTokens(system + user), completionTokens = out.completionTokens ?? estimateTokens(out.content);
    const price = m && status.kind === "managed" ? m.price[tier] : null;
    const costMicroUsd = price ? Math.round(promptTokens * price.in + completionTokens * price.out) : 0;
    await db.insert(schema.aiUsage).values({ ...usageBase, promptTokens, completionTokens, ok: true, costMicroUsd });
    await logActivity(userId, "ai.call", { details: { purpose, provider: status.kind, tier, model: cfg.model, ok: true, inTok: promptTokens, outTok: completionTokens, costMicro: costMicroUsd } });
    if (opts.cache) await db.insert(schema.aiCache).values({ key: cacheKey, userId, response: parsed as object }).onConflictDoNothing();
    return parsed;
  } catch (e) {
    // Failed calls still count as requests, so a broken loop cannot hammer the provider for free.
    await db.insert(schema.aiUsage).values({ ...usageBase, promptTokens: estimateTokens(system + user), completionTokens: 0, ok: false });
    log("warn", "ai.call_failed", { purpose, provider: status.kind, code: e instanceof AiError ? e.code : "unexpected" });
    await logActivity(userId, "ai.call", { details: { purpose, provider: status.kind, tier, model: cfg.model, ok: false, code: e instanceof AiError ? e.code : "unexpected" } });
    throw e;
  }
}
