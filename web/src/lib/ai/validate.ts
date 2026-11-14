import { z } from "zod";
import type { Citation, NumericCheck } from "@/db/schema";
import type { RetrievedChunk } from "@/lib/retrieval";

const citationSchema = z.object({ source: z.string().min(1).max(12), quote: z.string().max(600).default("") });
const checkSchema = z.object({ fn: z.string().min(1).max(60), args: z.record(z.string(), z.unknown()) });

export const rawQuestionSchema = z.object({
  type: z.enum(["mcq", "numeric"]),
  stem: z.string().trim().min(15).max(1500),
  choices: z.array(z.string().trim().min(1).max(400)).optional(),
  correctIndex: z.number().int().optional(),
  answer: z.number().finite().optional(),
  unit: z.string().max(40).optional(),
  check: checkSchema.nullish(),
  hint: z.string().trim().max(600).optional(),
  explanation: z.string().trim().min(10).max(2500),
  citations: z.array(citationSchema).max(4).default([]),
  grounding: z.enum(["direct", "extrapolated"]).default("direct"),
  difficulty: z.number().int().min(1).max(3).default(2),
});
export type RawQuestion = z.infer<typeof rawQuestionSchema>;

export const generationSchema = z.object({
  insufficient: z.boolean().default(false),
  reason: z.string().max(600).default(""),
  questions: z.array(z.unknown()).max(30).default([]),
});

export const learnSchema = z.object({
  insufficient: z.boolean().default(false),
  reason: z.string().max(600).default(""),
  summary: z.string().trim().max(1500).default(""),
  keyPoints: z.array(z.object({ text: z.string().trim().min(5).max(700), citations: z.array(citationSchema).max(3).default([]) })).max(8).default([]),
});

export const topicsSchema = z.object({
  insufficient: z.boolean().default(false),
  reason: z.string().max(600).default(""),
  topics: z.array(z.object({ name: z.string().trim().min(3).max(90), module: z.number().int().min(0).max(99).nullish(), sources: z.array(z.string().max(12)).max(8).default([]) })).max(20).default([]),
});

export type ValidQuestion = {
  type: "mcq" | "numeric"; stem: string; choices: string[] | null; correctIndex: number | null;
  numericValue: number | null; tolerance: number | null; unit: string | null; hint: string | null; explanation: string;
  citations: Citation[]; grounding: "direct" | "extrapolated"; difficulty: number; check: NumericCheck | null;
  correctnessConfidence: "verified-numeric" | "model-asserted"; explanationConfidence: "quote-verified" | "source-linked";
  fingerprint: string;
};
export type Verdict = { ok: true; question: ValidQuestion } | { ok: false; reason: string };
export type Computer = (fn: string, args: Record<string, unknown>) => Promise<number>;

export const normalize = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[‐-―−]/g, "-").replace(/[“”„]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, " ").trim();
const tokens = (s: string) => normalize(s).replace(/[^a-z0-9. ]/g, " ").split(" ").filter((t) => t.length > 2);

export function fingerprint(stem: string): string {
  return [...new Set(tokens(stem))].sort().join(" ").slice(0, 600);
}

export function similarity(a: string, b: string): number {
  const A = new Set(a.split(" ")), B = new Set(b.split(" "));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export const isDuplicate = (fp: string, existing: string[]) => existing.some((e) => e === fp || similarity(fp, e) >= 0.8);

/** Does the quoted text really appear in the chunk (ignoring case, spacing, typographic quotes)? */
export function quoteAppears(quote: string, chunkText: string): boolean {
  const q = normalize(quote).replace(/^["'.… ]+|["'.… ]+$/g, "");
  if (q.split(" ").length < 3) return false;
  return normalize(chunkText).includes(q);
}

/**
 * Map model citations onto the chunks that were actually provided. A citation
 * to a source that was not in the prompt is dropped: the model cannot invent
 * references. Quotes that are not found verbatim are kept as source links
 * only, flagged unverified.
 */
export function resolveCitations(raw: { source: string; quote: string }[], provided: RetrievedChunk[]): Citation[] {
  const out: Citation[] = [];
  for (const c of raw) {
    const m = /^\[?S(\d{1,2})\]?$/i.exec(c.source.trim());
    const chunk = m ? provided[Number(m[1]) - 1] : undefined;
    if (!chunk || out.some((o) => o.chunkId === chunk.id)) continue;
    const verified = quoteAppears(c.quote, chunk.text);
    out.push({ chunkId: chunk.id, documentId: chunk.documentId, quote: verified ? c.quote.trim().slice(0, 400) : "", quoteVerified: verified });
  }
  return out;
}

const AMBIGUOUS_CHOICE = /\b(all|none|both|neither) of (the|these) (above|options|answers)\b|\ball of these\b|\bnone of these\b|\b(both )?[a-d] (and|&) [a-d]\b|\ball are correct\b|\bmore than one of\b/i;

/** First plain number in a choice, e.g. "$59.46 thousand" → 59.46, "12.5%" → 12.5 */
export function numberIn(text: string): number | null {
  const m = /-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d*\.?\d+(?:e-?\d+)?/i.exec(text.replace(/−/g, "-"));
  if (!m) return null;
  const n = Number(m[0].replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function defaultTolerance(answer: number): number {
  return Math.max(Math.abs(answer) * 0.005, 0.005);
}

export const within = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol + 1e-12;

/** Structural, citation and numerical checks for one model-written question. */
export async function validateQuestion(raw: unknown, provided: RetrievedChunk[], computeFn: Computer, allowedFns: Set<string>): Promise<Verdict> {
  const parsed = rawQuestionSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: `A question did not match the required format (${parsed.error.issues[0]?.path.join(".") || "shape"}).` };
  const q = parsed.data;
  const citations = resolveCitations(q.citations, provided);
  if (!citations.length) return { ok: false, reason: "A question cited no source from the provided list; every question must cite S-numbered sources." };
  const anyVerified = citations.some((c) => c.quoteVerified);
  const base = {
    stem: q.stem, hint: q.hint || null, explanation: q.explanation, citations, difficulty: q.difficulty,
    grounding: (anyVerified ? q.grounding : "extrapolated") as "direct" | "extrapolated",
    explanationConfidence: (anyVerified ? "quote-verified" : "source-linked") as "quote-verified" | "source-linked",
    fingerprint: fingerprint(q.stem),
  };

  let computed: number | null = null;
  if (q.check) {
    if (!allowedFns.has(q.check.fn)) return { ok: false, reason: `check.fn "${q.check.fn.slice(0, 40)}" is not one of the available functions.` };
    try { computed = await computeFn(q.check.fn, q.check.args); }
    catch { return { ok: false, reason: `check for "${q.check.fn}" could not be computed with the given args.` }; }
  }

  if (q.type === "numeric") {
    if (q.answer === undefined) return { ok: false, reason: "A numeric question had no answer." };
    if (computed === null) return { ok: false, reason: "A numeric question had no check; numeric answers must be verifiable." };
    const tol = defaultTolerance(computed);
    // The model's stated answer may be rounded; accept rounding to 2 significant decimals of slack, nothing more.
    if (!within(q.answer, computed, Math.max(tol, Math.abs(computed) * 0.01))) {
      return { ok: false, reason: `A numeric answer (${q.answer}) did not match the verified calculation (${Number(computed.toPrecision(6))}).` };
    }
    return { ok: true, question: { ...base, type: "numeric", choices: null, correctIndex: null, numericValue: computed, tolerance: tol, unit: q.unit?.trim() || null, check: q.check!, correctnessConfidence: "verified-numeric" } };
  }

  const choices = q.choices ?? [];
  if (choices.length !== 4) return { ok: false, reason: "A multiple-choice question did not have exactly 4 choices." };
  if (q.correctIndex === undefined || q.correctIndex < 0 || q.correctIndex > 3) return { ok: false, reason: "A multiple-choice question had an invalid correctIndex." };
  if (new Set(choices.map(normalize)).size !== 4) return { ok: false, reason: "A multiple-choice question had duplicate choices." };
  if (choices.some((c) => AMBIGUOUS_CHOICE.test(c))) return { ok: false, reason: 'Choices like "all of the above" or "both A and B" are not allowed.' };
  const nums = choices.map(numberIn);
  if (nums.every((n) => n !== null)) {
    // Numeric choices: two choices with the same value would both be correct.
    const tolEach = nums.map((n) => defaultTolerance(n!));
    for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) {
      if (within(nums[i]!, nums[j]!, Math.min(tolEach[i], tolEach[j])) && normalize(choices[i]).replace(/[^a-z%$]/g, "") === normalize(choices[j]).replace(/[^a-z%$]/g, "")) {
        return { ok: false, reason: "Two choices had the same numeric value." };
      }
    }
  }
  if (computed !== null) {
    const target = nums[q.correctIndex];
    if (target === null) return { ok: false, reason: "A check was given but the correct choice contains no number." };
    const tol = Math.max(defaultTolerance(computed), Math.abs(computed) * 0.01);
    if (!within(target, computed, tol)) return { ok: false, reason: `The marked choice (${target}) did not match the verified calculation (${Number(computed.toPrecision(6))}).` };
    if (nums.some((n, i) => i !== q.correctIndex && n !== null && within(n, computed!, tol))) return { ok: false, reason: "More than one choice matched the verified calculation." };
  }
  return { ok: true, question: { ...base, type: "mcq", choices, correctIndex: q.correctIndex, numericValue: null, tolerance: null, unit: null, check: q.check ?? null, correctnessConfidence: computed !== null ? "verified-numeric" : "model-asserted" } };
}

/** Deterministic shuffle of choices so the correct answer's position carries no pattern. */
export function shuffleChoices(choices: string[], correctIndex: number, seed: string): { choices: string[]; correctIndex: number } {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
  const idx = choices.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  return { choices: idx.map((i) => choices[i]), correctIndex: idx.indexOf(correctIndex) };
}
