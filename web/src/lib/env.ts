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
  get secureCookies() { return (process.env.APP_URL ?? "").startsWith("https://"); },
};
