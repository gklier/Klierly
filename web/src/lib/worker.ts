import { env } from "./env";

export type Segment = {
  kind: "text" | "table"; text: string; heading: string | null; page: number | null; slide: number | null;
  t_start_ms: number | null; t_end_ms: number | null;
};
export type ParseResult = { parser: string; confidence: number; warnings: string[]; title: string | null; segments: Segment[] };
export type NumericFunction = { name: string; description: string; args: Record<string, string>; returns: string };

export class WorkerError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
  /** Client errors are permanent: retrying the same input cannot succeed. */
  get permanent() { return this.status >= 400 && this.status < 500 && this.status !== 408 && this.status !== 429; }
}

async function call<T>(path: string, init: RequestInit, timeoutMs = 120_000): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${env.workerUrl}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), "X-Worker-Token": env.workerToken },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new WorkerError(503, "worker_unreachable", "The parsing service is not reachable. Check that the worker is running.");
  }
  const body = (await res.json().catch(() => null)) as { detail?: { code?: string; message?: string } } | null;
  if (!res.ok) {
    throw new WorkerError(res.status, body?.detail?.code ?? "worker_error", body?.detail?.message ?? `The parsing service returned an error (${res.status}).`);
  }
  return body as T;
}

const json = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function parseFile(filename: string, data: Buffer): Promise<ParseResult> {
  const form = new FormData();
  form.set("file", new Blob([new Uint8Array(data)]), filename);
  form.set("filename", filename);
  return call<ParseResult>("/parse", { method: "POST", body: form });
}

export const parseText = (text: string, format: "plain" | "markdown" | "html", title?: string) =>
  call<ParseResult>("/parse-text", json({ text, format, title }));

export const compute = (fn: string, args: Record<string, unknown>) =>
  call<{ value: number; detail: Record<string, unknown> }>("/numeric/compute", json({ fn, args }), 15_000);

let fnCache: { at: number; fns: NumericFunction[] } | null = null;
export async function numericFunctions(): Promise<NumericFunction[]> {
  if (fnCache && Date.now() - fnCache.at < 600_000) return fnCache.fns;
  const { functions } = await call<{ functions: NumericFunction[] }>("/numeric/functions", { method: "GET" }, 10_000);
  fnCache = { at: Date.now(), fns: functions };
  return functions;
}

export async function workerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${env.workerUrl}/health`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}
