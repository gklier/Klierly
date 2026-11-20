import type { NumericSpec } from "@/db/schema";
import { buildNumericItems, readSolverOut, sampleParams } from "./items";
import { runSolver } from "@/lib/worker";

export const VALIDATION_SEEDS = 60;
export const seedsFor = (n = VALIDATION_SEEDS) => Array.from({ length: n }, (_, i) => 1000 + i);

export type NumericReport = { seeds: number; ok: boolean; failures: string[]; uniqueStems: number; checked: string[]; failingSeeds: number[] };

const agrees = (a: number, b: number, tol: number) => Math.abs(a - b) <= Math.max(tol, Math.abs(a) * 1e-6, 1e-9);

/**
 * Stage 7 for one numeric generator, over >= 50 seeds. Every check must pass:
 *  a) the solver runs and returns finite numbers;  b) the last step shows the computed answer;
 *  c) no trap equals the true answer;  d) an INDEPENDENT second solver, written without seeing the first, agrees on every seed;
 *  e) stems are not near-duplicates (at least 50 unique);  f) values are sane (bounded, not degenerate).
 */
export async function validateNumericGenerator(gen: { spec: NumericSpec; solverCode: string; sourceRefs: string[] }, independentCode: string | null, seedCount = VALIDATION_SEEDS): Promise<NumericReport> {
  const seeds = seedsFor(seedCount);
  const failures: string[] = [], failing = new Set<number>(), checked: string[] = [];
  const fail = (seed: number | null, msg: string) => { if (failures.length < 12) failures.push(seed === null ? msg : `seed ${seed}: ${msg}`); if (seed !== null) failing.add(seed); };

  const built = await buildNumericItems(gen, seeds);
  checked.push("a:runs-and-finite");
  const good = built.flatMap((b) => ("item" in b ? [b] : (fail(b.seed, b.error), [])));

  checked.push("b:last-step-shows-answer");
  if (!/\{answer(:\d)?\}/.test(gen.spec.stepsTemplates[gen.spec.stepsTemplates.length - 1] ?? "")) fail(null, "The last step must show the answer with {answer:2}.");

  checked.push("c:traps-differ-from-answer");
  if (gen.spec.traps.length && !/^def\s+traps\s*\(/m.test(gen.solverCode)) fail(null, "Traps were described but there is no def traps(p).");
  // Items already drop a trap that equals the true answer on a seed; a generator where that (or a failing traps function) is common is not trusted.
  const lacking = good.filter((b) => b.item.traps.length < gen.spec.traps.length);
  if (gen.spec.traps.length && lacking.length > good.length * 0.1) fail(lacking[0].seed, `a trap equals the true answer or could not be computed on ${lacking.length} of ${good.length} seeds`);

  checked.push("f:sane-values");
  const answers = good.map((b) => b.item.answer!);
  for (const b of good) if (Math.abs(b.item.answer!) > 1e6) fail(b.seed, `implausible magnitude ${b.item.answer}`);
  if (answers.length > 5 && new Set(answers.map((a) => a.toFixed(6))).size < Math.min(5, answers.length)) fail(null, "The answer barely varies across seeds (degenerate generator).");

  checked.push("e:no-near-duplicate-stems");
  const uniqueStems = new Set(good.map((b) => b.stemHash)).size;
  if (uniqueStems < Math.min(50, seedCount)) fail(null, `only ${uniqueStems} unique stems in ${seedCount} seeds`);

  checked.push("d:independent-solver");
  if (!independentCode) fail(null, "No independent solver was available, so the answers are unverified.");
  else {
    const params = seeds.map((s) => sampleParams(gen.spec, s));
    let second;
    try { second = await runSolver(independentCode, params, "solve"); } catch (e) { fail(null, `The independent solver could not run: ${e instanceof Error ? e.message : "error"}`); second = null; }
    if (second) for (const b of good) {
      const r = second[seeds.indexOf(b.seed)], o = r?.ok ? readSolverOut(r.value) : null;
      if (!o) fail(b.seed, "the independent solver returned no usable answer");
      else if (!agrees(b.item.answer!, o.answer, b.item.tolerance)) fail(b.seed, `independent solver says ${o.answer}, stored answer ${b.item.answer}`);
    }
  }
  return { seeds: seedCount, ok: failures.length === 0, failures, uniqueStems, checked, failingSeeds: [...failing] };
}
