import type { LmItem, NumericSpec } from "@/db/schema";
import { runSolver } from "@/lib/worker";
import { sanitizeHtml, stripHtml } from "./html";
import { hashStr, makeRng, type Rng } from "./rng";

type Vars = Record<string, unknown>;
const round = (x: number, d: number) => { const s = (Math.round(x * 10 ** d) / 10 ** d).toFixed(d); return s === `-${(0).toFixed(d)}` ? (0).toFixed(d) : s; };

/** Deterministic parameter values for one seed. */
export function sampleParams(spec: Pick<NumericSpec, "params">, seed: number): Vars {
  const r: Rng = makeRng(seed);
  const out: Vars = {};
  for (const p of spec.params) {
    if (p.type === "choice") { out[p.name] = r.pick(p.values ?? [0]); continue; }
    const [lo, hi] = p.range ?? [1, 10];
    const one = () => {
      if (p.type === "int" || p.type === "list") return r.int(Math.ceil(lo), Math.floor(hi));
      const d = p.decimals ?? 1; return Number((lo + r.f() * (hi - lo)).toFixed(d));
    };
    if (p.type === "list") { const [a, b] = p.length ?? [3, 6]; const n = r.int(a, b); out[p.name] = Array.from({ length: n }, one); }
    else out[p.name] = one();
  }
  return out;
}

export class TemplateError extends Error {}

/** `{name}` or `{name:2}`; numbers are formatted by code, lists joined. An unknown name is an error, never blank. */
export function renderTemplate(t: string, vars: Vars): string {
  return t.replace(/\{([a-z][a-z0-9_.]*)(?::(\d))?\}/gi, (_m, name: string, dec?: string) => {
    const v = name.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Vars)[k] : undefined), vars);
    if (v === undefined || v === null) throw new TemplateError(`Unknown placeholder {${name}}`);
    if (Array.isArray(v)) return v.map((x) => (typeof x === "number" && dec !== undefined ? round(x, Number(dec)) : String(x))).join(", ");
    if (typeof v === "number") return dec !== undefined ? round(v, Number(dec)) : Number.isInteger(v) ? String(v) : String(Number(v.toFixed(4)));
    return String(v);
  });
}

export type SolverOut = { answer: number; tolerance: number; intermediates: Record<string, number> };

export function readSolverOut(v: unknown): SolverOut | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (typeof o.answer !== "number" || !Number.isFinite(o.answer)) return null;
  const tol = typeof o.tolerance === "number" && o.tolerance > 0 ? o.tolerance : 0.02;
  const inter: Record<string, number> = {};
  if (o.intermediates && typeof o.intermediates === "object") for (const [k, x] of Object.entries(o.intermediates)) if (typeof x === "number" && Number.isFinite(x)) inter[k] = x;
  return { answer: o.answer, tolerance: tol, intermediates: inter };
}

export const hasTrapsFn = (code: string) => /^def\s+traps\s*\(/m.test(code);

export type BuiltItem = { seed: number; item: LmItem; stemHash: string } | { seed: number; error: string };

/**
 * Build the concrete questions for these seeds: the solver (in the sandbox) computes every number shown or graded.
 * A trap that happens to equal the true answer on a seed is dropped from that instance (it would mark a right answer as a "mistake").
 */
export async function buildNumericItems(gen: { spec: NumericSpec; solverCode: string; sourceRefs: string[] }, seeds: number[]): Promise<BuiltItem[]> {
  const params = seeds.map((s) => sampleParams(gen.spec, s));
  const results = await runSolver(gen.solverCode, params, "solve");
  const trapsRes = hasTrapsFn(gen.solverCode) && gen.spec.traps.length ? await runSolver(gen.solverCode, params, "traps") : null;
  return seeds.map((seed, i): BuiltItem => {
    const r = results[i];
    if (!r.ok) return { seed, error: r.error };
    const out = readSolverOut(r.value);
    if (!out) return { seed, error: "The solver did not return {answer, tolerance, intermediates} with a finite answer." };
    try {
      const vars: Vars = { ...params[i], ...out.intermediates, answer: out.answer };
      const stemHtml = sanitizeHtml(renderTemplate(gen.spec.stemTemplate, vars));
      const steps = gen.spec.stepsTemplates.map((t) => sanitizeHtml(renderTemplate(t, vars)));
      const traps: { value: number; message: string }[] = [];
      const tr = trapsRes?.[i];
      if (tr?.ok && Array.isArray(tr.value)) tr.value.forEach((v, k) => { if (typeof v === "number" && Number.isFinite(v) && gen.spec.traps[k] && Math.abs(v - out.answer) > Math.max(out.tolerance, Math.abs(out.answer) * 1e-6)) traps.push({ value: v, message: gen.spec.traps[k].message }); });
      const stemHash = String(hashStr(stripHtml(stemHtml).toLowerCase().replace(/\s+/g, " ")));
      return { seed, stemHash, item: { stemHtml, kind: "num", answer: out.answer, tolerance: out.tolerance, choices: null, correctIndex: null, whyEach: null, steps, traps, sourceRefs: gen.sourceRefs } };
    } catch (e) {
      return { seed, error: e instanceof TemplateError ? e.message : "Could not render the question." };
    }
  });
}
