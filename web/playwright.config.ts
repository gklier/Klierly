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
      env: { ...env, DATABASE_URL: E2E_DATABASE_URL, APP_URL: `http://localhost:${PORT}`, INVITE_CODE: "e2e-invite", UPLOAD_DIR: path.join(os.tmpdir(), "klierly-e2e-uploads"), ALLOW_PRIVATE_AI_ENDPOINTS: "true" },
    },
  ],
});
