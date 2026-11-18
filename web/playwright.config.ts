import { defineConfig } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const PORT = 3100;
const LLM_PORT = 4012;
const env = Object.fromEntries(fs.readFileSync(path.resolve(__dirname, ".env.local"), "utf8").split("\n").map((l) => /^([A-Z_]+)=(.*)$/.exec(l)).filter(Boolean).map((m) => [m![1], m![2]]));
const E2E_DATABASE_URL = (env.DATABASE_URL as string).replace(/\/klierly(\?|$)/, "/klierly_e2e$1");

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1280, height: 900 } },
  webServer: [
    { command: `npx tsx scripts/mock-llm.ts`, env: { MOCK_LLM_PORT: String(LLM_PORT) }, port: LLM_PORT, reuseExistingServer: false },
    {
      command: `npx tsx e2e/reset-db.ts && npx next start -p ${PORT}`, port: PORT, reuseExistingServer: false, timeout: 60_000,
      env: { ...env, DATABASE_URL: E2E_DATABASE_URL, APP_URL: `http://localhost:${PORT}`, INVITE_CODE: "e2e-invite", ADMIN_EMAILS: "founder@e2e.test,operator@e2e.test",
        // Managed AI points at the deterministic mock: the zero-configuration path is tested, real inference is not.
        MANAGED_AI_BASE_URL: `http://127.0.0.1:${LLM_PORT}/v1`, MANAGED_AI_API_KEY: "test-key", MANAGED_AI_MODEL: "mock-cheap", MANAGED_AI_MODEL_STRONG: "mock-strong",
        MANAGED_AI_USER_DAILY_REQUESTS: "150", MANAGED_AI_PRICE_IN_PER_MTOK: "0.5", MANAGED_AI_PRICE_OUT_PER_MTOK: "2", MANAGED_AI_STRONG_PRICE_IN_PER_MTOK: "5", MANAGED_AI_STRONG_PRICE_OUT_PER_MTOK: "20", UPLOAD_DIR: path.join(os.tmpdir(), "klierly-e2e-uploads"), ALLOW_PRIVATE_AI_ENDPOINTS: "true" },
    },
  ],
});
