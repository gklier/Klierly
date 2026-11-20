import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { numericSolversEnabled } from "@/lib/learn/pipeline";
import { runSolver } from "@/lib/worker";

const KEYS = ["WORKER_SOLVER_URL", "WORKER_SOLVER_TOKEN", "LEARN_TEST_NUMERIC_SOLVERS", "APP_URL", "WORKER_URL", "WORKER_TOKEN"] as const;
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } });
const set = (v: Partial<Record<(typeof KEYS)[number], string | undefined>>) => { for (const k of KEYS) delete process.env[k]; for (const [k, x] of Object.entries(v)) if (x !== undefined) process.env[k] = x; };

describe("when calculation questions are allowed to be built", () => {
  it("never on a public site by default, even with the test flag", () => {
    set({ APP_URL: "https://klierly.example.com", LEARN_TEST_NUMERIC_SOLVERS: "true" });
    expect(numericSolversEnabled()).toBe(false);
    set({});
    expect(numericSolversEnabled()).toBe(false);
  });
  it("on a local development machine with the explicit flag", () => {
    set({ APP_URL: "http://localhost:3000", LEARN_TEST_NUMERIC_SOLVERS: "true" });
    expect(numericSolversEnabled()).toBe(true);
    set({ APP_URL: "http://localhost:3000" });
    expect(numericSolversEnabled()).toBe(false); // the flag is required
  });
  it("on a public site once an isolated solver container is configured", () => {
    set({ APP_URL: "https://klierly.example.com", WORKER_SOLVER_URL: "http://solver:8001" });
    expect(numericSolversEnabled()).toBe(true);
    set({ APP_URL: "https://klierly.example.com", WORKER_SOLVER_URL: "   " });
    expect(numericSolversEnabled()).toBe(false); // blank is not configured
  });
});

describe("solver calls go to the solver container with its own token", () => {
  const stub = (replies: (req: http.IncomingMessage) => unknown) => new Promise<{ server: http.Server; url: string; seen: { path: string; token: string | undefined; body: string }[] }>((resolve) => {
    const seen: { path: string; token: string | undefined; body: string }[] = [];
    const server = http.createServer((req, res) => {
      let body = ""; req.on("data", (c) => { body += c; });
      req.on("end", () => { seen.push({ path: req.url ?? "", token: req.headers["x-worker-token"] as string | undefined, body }); res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(replies(req))); });
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen }));
  });

  it("uses the solver URL and solver token, not the parsing worker's", async () => {
    const s = await stub(() => ({ results: [{ ok: true, value: { answer: 4 } }] }));
    set({ WORKER_URL: "http://127.0.0.1:1", WORKER_TOKEN: "parser-token", WORKER_SOLVER_URL: s.url, WORKER_SOLVER_TOKEN: "solver-token" });
    try {
      const r = await runSolver("def solve(p):\n    return {'answer': 4}\n", [{}]);
      expect(r).toEqual([{ ok: true, value: { answer: 4 } }]);
      expect(s.seen).toHaveLength(1);
      expect(s.seen[0]).toMatchObject({ path: "/sandbox/run", token: "solver-token" });
    } finally { s.server.close(); }
  });

  it("falls back to the local worker only when no solver is configured", async () => {
    const s = await stub(() => ({ results: [{ ok: true, value: { answer: 1 } }] }));
    set({ WORKER_URL: s.url, WORKER_TOKEN: "parser-token" });
    try {
      await runSolver("def solve(p):\n    return {'answer': 1}\n", [{}]);
      expect(s.seen[0]).toMatchObject({ path: "/sandbox/run", token: "parser-token" });
    } finally { s.server.close(); }
  });
});
