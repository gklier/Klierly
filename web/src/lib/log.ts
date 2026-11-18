/**
 * Structured server log. Never pass document contents, prompts, model output
 * or credentials here; values are additionally scrubbed as defense in depth.
 */
const SECRET_PATTERNS = [/sk-[A-Za-z0-9_-]{8,}/g, /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, /clx_[A-Za-z0-9_-]{8,}/g];
const SENSITIVE_KEYS = /key|token|secret|password|authorization|cookie|text|content|prompt|stem|quote/i;

export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") {
    let s = value.length > 300 ? `${value.slice(0, 300)}…[truncated]` : value;
    for (const p of SECRET_PATTERNS) s = s.replace(p, "[redacted]");
    return s;
  }
  if (value instanceof Error) return redact(value.message);
  if (Array.isArray(value)) return depth > 3 ? "[array]" : value.slice(0, 20).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    if (depth > 3) return "[object]";
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = SENSITIVE_KEYS.test(k) ? "[redacted]" : redact(v, depth + 1);
    return out;
  }
  return value;
}

export function log(level: "info" | "warn" | "error", event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, event, ...(redact(fields) as object) });
  if (level === "error") console.error(line);
  else console.log(line);
}
