import fs from "node:fs";
import path from "node:path";
import { sanitizeExcerpt } from "@/lib/ai/prompt";

/** Bump a stage's number here when its file changes (add a new file; never edit an old version in place). */
export const PROMPT_VERSIONS = {
  A_analyze_course: 1, B_concept_graph: 1, C_lesson: 1, D_numeric: 1, D_mcq: 1, D_scenario: 1,
  E1_independent_solver: 1, E2_independent_mcq: 1, E3_quality_critic: 1, G_tutor: 1,
} as const;
export type Stage = keyof typeof PROMPT_VERSIONS;

const dir = () => {
  for (const base of [process.cwd(), path.resolve(process.cwd(), "web")]) {
    const d = path.join(base, "prompts", "learn-mode");
    if (fs.existsSync(d)) return d;
  }
  throw new Error("Learn Mode prompt files were not found (expected web/prompts/learn-mode).");
};
const cache = new Map<string, string>();
const read = (file: string) => { let t = cache.get(file); if (t === undefined) { t = fs.readFileSync(path.join(dir(), file), "utf8").trim(); cache.set(file, t); } return t; };

export const promptVersion = (stage: Stage) => `${stage}.v${PROMPT_VERSIONS[stage]}`;

/** System prompt = shared preamble + the stage's task. The recorded version identifies exactly this text. */
export function systemPrompt(stage: Stage): { text: string; version: string } {
  const v = PROMPT_VERSIONS[stage];
  const body = read(`${stage}.v${v}.md`);
  return { text: stage === "G_tutor" ? body : `${read("_preamble.v1.md")}\n\n${body}`, version: promptVersion(stage) };
}

export type PromptChunk = { id: string; from: string; text: string };

/** Course text goes inside <course_material> as labelled chunks. Delimiter look-alikes inside it are neutralised. */
export function courseMaterial(chunks: PromptChunk[]): string {
  const body = chunks.map((c) => `<chunk id="${c.id}" from="${c.from.replace(/["<>]/g, "")}">\n${sanitizeExcerpt(c.text).replace(/<\/?\s*course_material\b[^>]*>/gi, "[tag removed]").replace(/<\/?\s*chunk\b[^>]*>/gi, "[tag removed]")}\n</chunk>`).join("\n");
  return `<course_material>\n${body}\n</course_material>`;
}
