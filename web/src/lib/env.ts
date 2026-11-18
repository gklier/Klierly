import path from "node:path";

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}. See .env.example.`);
  return v;
}

export const env = {
  get databaseUrl() { return required("DATABASE_URL"); },
  get appSecret() {
    const s = required("APP_SECRET");
    if (s.length < 32 || s.startsWith("change-me")) throw new Error("APP_SECRET must be a random string of at least 32 characters.");
    return s;
  },
  get appUrl() { return (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, ""); },
  get workerUrl() { return (process.env.WORKER_URL ?? "http://127.0.0.1:8001").replace(/\/$/, ""); },
  get workerToken() { return required("WORKER_TOKEN"); },
  get uploadDir() { return path.resolve(process.env.UPLOAD_DIR ?? "./data/uploads"); },
  get maxUploadBytes() { return Number(process.env.MAX_UPLOAD_MB ?? 25) * 1024 * 1024; },
  get inviteCode() { return process.env.INVITE_CODE?.trim() || null; },
  get allowPrivateAiEndpoints() { return (process.env.ALLOW_PRIVATE_AI_ENDPOINTS ?? "true") === "true"; },
  get adminEmails() { return (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean); },
  /**
   * Klierly-managed AI provider. Active only when base URL, key and model are all set on the server.
   * Credentials stay in the server environment: never in the database, the browser or the extension.
   */
  get managedAi() {
    const baseUrl = process.env.MANAGED_AI_BASE_URL?.trim(), apiKey = process.env.MANAGED_AI_API_KEY?.trim(), model = process.env.MANAGED_AI_MODEL?.trim();
    if (!baseUrl || !apiKey || !model) return null;
    const num = (name: string, fallback: number) => { const v = Number(process.env[name]); return Number.isFinite(v) && v >= 0 && process.env[name] !== undefined && process.env[name] !== "" ? v : fallback; };
    return {
      baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, model,
      strongModel: process.env.MANAGED_AI_MODEL_STRONG?.trim() || null,
      label: process.env.MANAGED_AI_LABEL?.trim() || "Klierly AI",
      userDailyRequests: num("MANAGED_AI_USER_DAILY_REQUESTS", 40),
      userMonthlyTokens: num("MANAGED_AI_USER_MONTHLY_TOKENS", 400_000),
      globalDailyRequests: num("MANAGED_AI_GLOBAL_DAILY_REQUESTS", 500),
      globalMonthlyUsd: num("MANAGED_AI_GLOBAL_MONTHLY_USD", 10),
      // US dollars per million tokens, used only to estimate spend. 0 = unknown.
      price: {
        routine: { in: num("MANAGED_AI_PRICE_IN_PER_MTOK", 0), out: num("MANAGED_AI_PRICE_OUT_PER_MTOK", 0) },
        strong: { in: num("MANAGED_AI_STRONG_PRICE_IN_PER_MTOK", 0), out: num("MANAGED_AI_STRONG_PRICE_OUT_PER_MTOK", 0) },
      },
    };
  },
  get secureCookies() { return (process.env.APP_URL ?? "").startsWith("https://"); },
};
