import { z } from "zod";

const ids = z.array(z.string().max(40)).max(40).default([]);
const str = (n: number) => z.string().trim().max(n);

export const analysisSchema = z.object({
  exams: z.array(z.object({
    name: str(120), covered_modules: z.array(str(160)).max(60).default([]), cumulative: z.union([z.boolean(), z.literal("unknown")]).default("unknown"),
    format_note: str(600).default(""), evidence: ids, explicit_topic_list: z.array(z.object({ text: str(300), evidence: ids })).max(60).default([]),
  })).max(10).default([]),
  modules: z.array(z.object({ id: str(80), title: str(200), key_terms: z.array(str(80)).max(30).default([]) })).max(80).default([]),
  instructor_expectations: z.array(z.object({ text: str(400), evidence: ids })).max(30).default([]),
  missing_or_unavailable_materials: z.array(z.object({ what: str(300), why: str(300) })).max(30).default([]),
  conflicts: z.array(z.object({ issue: str(400), sources: ids })).max(20).default([]),
  uncertainties: z.array(str(400)).max(30).default([]),
  transcript_warnings: z.array(str(300)).max(30).default([]),
});
export type Analysis = z.infer<typeof analysisSchema>;

export const graphSchema = z.object({
  concepts: z.array(z.object({
    id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,40}$/), title: str(160), module_id: str(80).default(""), prerequisites: z.array(z.string()).max(8).default([]),
    exam_relevance: z.object({ level: z.enum(["explicit", "likely", "background"]).default("likely"), evidence: ids }).default({ level: "likely", evidence: [] }),
    formulas: z.array(z.object({ name: str(120), text: str(300), instructor_form_note: str(300).default("") })).max(8).default([]),
    instructor_specific_rules: z.array(z.object({ rule: str(400), evidence: ids })).max(8).default([]),
    common_mistakes: z.array(str(300)).max(8).default([]), decision_cues: z.array(str(300)).max(8).default([]),
    estimated_minutes: z.number().int().min(3).max(60).default(10), source_refs: ids,
  })).min(1).max(24),
});
export type Graph = z.infer<typeof graphSchema>;

export const lessonSchema = z.object({
  why_it_matters: str(400), short: str(300),
  cards: z.array(z.object({ heading: str(80), body_html: str(900) })).length(4),
  alt_explanation: str(900), background_flags: z.array(str(300)).max(10).default([]),
});

export const numericGenSchema = z.object({
  params: z.array(z.object({
    name: z.string().regex(/^[a-z][a-z0-9_]{0,20}$/), type: z.enum(["int", "float", "choice", "list"]),
    range: z.tuple([z.number(), z.number()]).optional(), values: z.array(z.union([z.number(), z.string().max(40)])).max(20).optional(),
    decimals: z.number().int().min(0).max(4).optional(), length: z.tuple([z.number().int().min(1), z.number().int().max(30)]).optional(),
  })).min(1).max(10),
  solver_code: z.string().min(20).max(6000),
  stem_template: str(1500), steps_templates: z.array(str(800)).min(2).max(8), traps: z.array(z.object({ message: str(400) })).max(5).default([]),
  assumptions_stated_in_stem: z.array(str(300)).max(6).default([]), difficulty: z.number().int().min(1).max(3).default(2), source_refs: ids,
});
export type NumericGen = z.infer<typeof numericGenSchema>;

export const mcqSchema = z.object({
  items: z.array(z.object({
    stem: str(900), options: z.array(z.object({ text: str(400), why: str(500) })).length(4), correct_index: z.number().int().min(0).max(3),
    skill: z.enum(["recall", "scenario", "contrast", "application"]).default("recall"), source_refs: ids,
  })).min(1).max(24),
});

export const scenarioSchema = z.object({
  items: z.array(z.object({
    scenario: str(700), correct_method: str(120), tempting_alternative: str(120), why_correct: str(600), why_alternative_wrong: str(600), clues: z.array(str(200)).max(6).default([]),
  })).min(1).max(40),
});

export const e1Schema = z.object({ solver_code: z.string().min(10).max(6000) });
export const e2Schema = z.object({ answers: z.array(z.object({ n: z.number().int(), chosen_index: z.number().int().min(0).max(3), justification: str(600).default(""), cited_chunk: z.string().max(40).nullable().default(null) })).max(40) });
export const e3Schema = z.object({ verdicts: z.array(z.object({ n: z.number().int(), clear: z.boolean(), one_defensible_answer: z.boolean(), matches_course_convention: z.boolean(), issues: z.array(str(300)).max(10).default([]) })).max(40) });
