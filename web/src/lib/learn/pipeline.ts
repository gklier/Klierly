import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { ZodType } from "zod";
import { db, schema } from "@/db";
import type { LmItem, McqSpec, NumericSpec } from "@/db/schema";
import { AiError, chatJson } from "@/lib/ai/provider";
import { logActivity } from "@/lib/activity";
import { sha256 } from "@/lib/crypto";
import { log } from "@/lib/log";
import { searchChunks } from "@/lib/retrieval";
import { sanitizeHtml } from "./html";
import { buildNumericItems } from "./items";
import { courseMaterial, promptVersion, systemPrompt, type PromptChunk, type Stage } from "./prompts";
import { hashStr, makeRng } from "./rng";
import { analysisSchema, e1Schema, e2Schema, e3Schema, graphSchema, lessonSchema, mcqSchema, numericGenSchema, scenarioSchema } from "./schemas";
import { seedsFor, validateNumericGenerator } from "./validate";

const num = (k: string, d: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? Math.floor(v) : d; };
/** Bank targets from the spec; lowered only through the environment (for tests or small budgets). */
export const targets = () => ({ numeric: num("LEARN_NUMERIC_GENERATORS", 6), mcq: num("LEARN_MCQ_ITEMS", 8), scenarios: num("LEARN_SCENARIOS", 15), attempts: num("LEARN_GENERATOR_ATTEMPTS", 2), seeds: num("LEARN_VALIDATION_SEEDS", 60) });

type ChunkMap = { chunks: PromptChunk[]; byLabel: Map<string, string> };
const toPrompt = (rows: { id: string; title: string; text: string }[], cap = 700): ChunkMap => {
  const byLabel = new Map<string, string>();
  const chunks = rows.map((r, i) => { const id = `c${i + 1}`; byLabel.set(id, r.id); return { id, from: r.title, text: r.text.slice(0, cap) }; });
  return { chunks, byLabel };
};
const refs = (labels: string[] | undefined, m: ChunkMap) => [...new Set((labels ?? []).map((l) => m.byLabel.get(l)).filter((x): x is string => Boolean(x)))];

/** A build is a background job that makes many calls: when the per-minute burst limit is hit it waits, rather than failing the guide. */
async function withPacing<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); } catch (e) {
      if (!(e instanceof AiError) || e.code !== "rate_limited" || i >= 6) throw e;
      const secs = Number(/in (\d+)s/.exec(e.message)?.[1] ?? 20);
      await new Promise((r) => setTimeout(r, Math.min(65, Math.max(1, secs)) * 1000));
    }
  }
}

/** One structured call: schema-validated, one retry that shows the validator's message, then a visible failure. */
async function callJson<T>(userId: string, stage: Stage, user: string, schemaZ: ZodType<T>, opts: { maxTokens?: number; temperature?: number; tier?: "routine" | "strong" } = {}): Promise<{ data: T; version: string }> {
  const sys = systemPrompt(stage);
  let prompt = user, lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await withPacing(() => chatJson(userId, `learn.${stage}`, sys.text, prompt, { cache: true, maxTokens: opts.maxTokens ?? 3000, temperature: opts.temperature ?? 0, tier: opts.tier }));
    const parsed = schemaZ.safeParse(out);
    if (parsed.success) return { data: parsed.data, version: sys.version };
    lastErr = parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    prompt = `${user}\n\nYour previous answer did not match the schema (${lastErr}). Return corrected JSON only.`;
  }
  throw new AiError("bad_output", `The AI's ${stage} output did not match the expected format (${lastErr}).`);
}

async function modelName(userId: string) {
  const { aiStatus } = await import("@/lib/ai/provider");
  const st = await aiStatus(userId);
  return st.kind === "byok" ? st.model : st.kind === "managed" ? (await import("@/lib/env")).env.managedAi?.model ?? "managed" : "none";
}

async function moduleChunks(userId: string, courseId: string, moduleId: string, cap = 36): Promise<{ id: string; title: string; text: string }[]> {
  const rows = await db.select({ id: schema.sourceChunks.id, title: schema.sourceDocuments.title, text: schema.sourceChunks.text, ord: schema.sourceChunks.ordinal })
    .from(schema.sourceChunks).innerJoin(schema.sourceDocuments, eq(schema.sourceDocuments.id, schema.sourceChunks.documentId))
    .where(and(eq(schema.sourceDocuments.courseId, courseId), eq(schema.sourceDocuments.userId, userId), eq(schema.sourceDocuments.moduleId, moduleId), eq(schema.sourceDocuments.status, "ready")))
    .orderBy(asc(schema.sourceDocuments.title), asc(schema.sourceChunks.ordinal));
  const step = rows.length > cap ? rows.length / cap : 1;
  return (rows.length > cap ? Array.from({ length: cap }, (_, i) => rows[Math.floor(i * step)]) : rows).map(({ id, title, text }) => ({ id, title, text }));
}

const setBuild = (id: string, v: Partial<typeof schema.lmBuilds.$inferInsert>) => db.update(schema.lmBuilds).set(v).where(eq(schema.lmBuilds.id, id));

// ------------------------------------------------------------------ module scope (deterministic, no AI)

/** Pre-select the modules an exam-information page names ("Exam 3 covers Modules 17-23"). Unclear scope selects nothing and says so. */
export async function suggestModules(userId: string, courseId: string): Promise<{ moduleIds: string[]; why: Record<string, string>; note: string | null }> {
  const mods = await db.select().from(schema.modules).where(eq(schema.modules.courseId, courseId)).orderBy(asc(schema.modules.position));
  const hits = await searchChunks({ userId, courseId, query: "exam covers modules study guide review", limit: 30 });
  const why: Record<string, string> = {};
  const numOf = (name: string) => { const m = /\b(?:module|week|unit|chapter)[\s_-]*(\d{1,2})\b/i.exec(name); return m ? Number(m[1]) : null; };
  for (const h of hits) {
    const re = /exam\s*#?(\d)?[^.\n]{0,60}?\bmodules?\s*(\d{1,2})\s*(?:[-–—]|through|to|and)\s*(\d{1,2})/gi;
    for (const m of h.text.matchAll(re)) {
      const lo = Number(m[2]), hi = Number(m[3]);
      if (!(lo <= hi && hi - lo < 30)) continue;
      for (const mod of mods) { const n = numOf(mod.name); if (n !== null && n >= lo && n <= hi && !why[mod.id]) why[mod.id] = `“${h.documentTitle}” says ${m[0].replace(/\s+/g, " ").trim()}`; }
    }
  }
  const ids = Object.keys(why);
  return { moduleIds: ids, why, note: ids.length ? null : "No exam page in your imports names the modules it covers, so nothing is pre-selected. Choose the modules you want to study." };
}

// ------------------------------------------------------------------ stages

async function stageAnalyze(build: typeof schema.lmBuilds.$inferSelect) {
  const mods = (await db.select().from(schema.modules).where(inArray(schema.modules.id, build.moduleIds))).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const docs = await db.select({ title: schema.sourceDocuments.title, moduleId: schema.sourceDocuments.moduleId }).from(schema.sourceDocuments).where(and(eq(schema.sourceDocuments.courseId, build.courseId), eq(schema.sourceDocuments.status, "ready"))).orderBy(asc(schema.sourceDocuments.title), asc(schema.sourceDocuments.id));
  const exam = await searchChunks({ userId: build.userId, courseId: build.courseId, query: "exam covers format points minutes allowed formula", limit: 10 });
  // Search ties can come back in any order; sort so identical input always builds the identical prompt (and hits the cache).
  const cm = toPrompt(exam.map((c) => ({ id: c.id, title: c.documentTitle, text: c.text })).sort((a, b) => a.title.localeCompare(b.title) || a.id.localeCompare(b.id)));
  const user = `Modules selected by the student:\n${mods.map((m) => `- id=${m.id} title=${m.name}`).join("\n")}\n\nSource titles in the course:\n${docs.map((d) => `- ${d.title}`).join("\n").slice(0, 3000)}\n\nExam-information excerpts:\n${courseMaterial(cm.chunks)}`;
  const { data } = await callJson(build.userId, "A_analyze_course", user, analysisSchema, { maxTokens: 2800 });
  // Keep only evidence that points at chunks we actually sent: nothing cited that was not provided.
  const clean = (e: string[]) => refs(e, cm);
  const analysis = { ...data, exams: data.exams.map((x) => ({ ...x, evidence: clean(x.evidence), explicit_topic_list: x.explicit_topic_list.map((t) => ({ ...t, evidence: clean(t.evidence) })) })), conflicts: data.conflicts.map((c) => ({ ...c, sources: clean(c.sources) })), instructor_expectations: data.instructor_expectations.map((c) => ({ ...c, evidence: clean(c.evidence) })), promptVersion: promptVersion("A_analyze_course") };
  await setBuild(build.id, { analysis });
  return analysis;
}

export async function stageConcepts(build: typeof schema.lmBuilds.$inferSelect, analysisJson: unknown) {
  const mods = await db.select().from(schema.modules).where(inArray(schema.modules.id, build.moduleIds)).orderBy(asc(schema.modules.position));
  const model = await modelName(build.userId);
  const existing = await db.select().from(schema.lmConcepts).where(eq(schema.lmConcepts.courseId, build.courseId));
  let position = existing.reduce((m, c) => Math.max(m, c.position + 1), 0);
  const created: string[] = [];
  for (const mod of mods) {
    if (existing.some((c) => c.moduleId === mod.id)) continue; // incremental: a module already analysed is not redone
    const rows = await moduleChunks(build.userId, build.courseId, mod.id);
    if (!rows.length) continue;
    const cm = toPrompt(rows);
    const user = `Module: id=${mod.id} title=${mod.name}\nCourse analysis (exam scope and expectations):\n${JSON.stringify(analysisJson).slice(0, 2500)}\n\n${courseMaterial(cm.chunks)}`;
    const { data, version } = await callJson(build.userId, "B_concept_graph", user, graphSchema, { maxTokens: 2900 });
    const slugs = new Set([...existing.map((c) => c.slug)]);
    const accepted: typeof data.concepts = [];
    for (const c of data.concepts) {
      let slug = c.id; if (slugs.has(slug)) slug = `${slug}-m${mod.position}`;
      if (slugs.has(slug)) continue;
      slugs.add(slug); accepted.push({ ...c, id: slug });
    }
    const known = new Map<string, number>(); // acyclic by construction: a prerequisite must be an EARLIER concept
    for (const c of existing) known.set(c.slug, c.position);
    for (const c of accepted) {
      const pos = position++;
      const prereq = c.prerequisites.filter((p) => known.has(p) && known.get(p)! < pos);
      known.set(c.id, pos);
      await db.insert(schema.lmConcepts).values({
        userId: build.userId, courseId: build.courseId, moduleId: mod.id, slug: c.id, title: c.title, position: pos, prerequisites: prereq, minutes: c.estimated_minutes,
        formulas: c.formulas.map((f) => ({ name: f.name, text: f.text, note: f.instructor_form_note || undefined })),
        instructorRules: c.instructor_specific_rules.map((r) => ({ rule: r.rule, evidence: refs(r.evidence, cm) })), sourceRefs: refs(c.source_refs, cm),
        status: "draft", promptVersion: version, model, inputHash: sha256(JSON.stringify([version, model, user])),
      }).onConflictDoNothing();
      created.push(c.id);
    }
  }
  return created;
}

const conceptChunks = async (userId: string, courseId: string, c: typeof schema.lmConcepts.$inferSelect, n = 8) => {
  const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id); // fixed order: identical input must build the identical prompt
  const direct = (c.sourceRefs.length ? await db.select({ id: schema.sourceChunks.id, title: schema.sourceDocuments.title, text: schema.sourceChunks.text }).from(schema.sourceChunks).innerJoin(schema.sourceDocuments, eq(schema.sourceDocuments.id, schema.sourceChunks.documentId)).where(and(inArray(schema.sourceChunks.id, c.sourceRefs), eq(schema.sourceDocuments.userId, userId))) : []).sort(byId);
  if (direct.length >= 3) return toPrompt(direct.slice(0, n));
  const found = (await searchChunks({ userId, courseId, query: c.title, moduleIds: c.moduleId ? [c.moduleId] : undefined, limit: n })).map((f) => ({ id: f.id, title: f.documentTitle, text: f.text })).filter((f) => !direct.some((d) => d.id === f.id)).sort(byId);
  return toPrompt([...direct, ...found].slice(0, n));
};

const conceptBrief = (c: typeof schema.lmConcepts.$inferSelect) => JSON.stringify({ title: c.title, formulas: c.formulas, instructor_rules: c.instructorRules.map((r) => r.rule) });

async function stageLesson(c: typeof schema.lmConcepts.$inferSelect) {
  const cm = await conceptChunks(c.userId, c.courseId, c);
  const { data, version } = await callJson(c.userId, "C_lesson", `Concept: ${conceptBrief(c)}\n\n${courseMaterial(cm.chunks)}`, lessonSchema, { maxTokens: 2200, temperature: 0.2 });
  await db.update(schema.lmConcepts).set({
    why: data.why_it_matters, short: data.short, altExplanation: data.alt_explanation, promptVersion: version,
    cards: data.cards.map((k) => ({ heading: k.heading, bodyHtml: sanitizeHtml(k.body_html) })), sourceRefs: c.sourceRefs.length ? c.sourceRefs : [...cm.byLabel.values()].slice(0, 6), status: "ready",
  }).where(eq(schema.lmConcepts.id, c.id));
}

async function saveItems(c: typeof schema.lmConcepts.$inferSelect, generatorId: string, kind: "numeric" | "mcq" | "scenario", items: { key: string; stemHash: string; body: LmItem }[]) {
  for (let i = 0; i < items.length; i += 100) {
    await db.insert(schema.lmItems).values(items.slice(i, i + 100).map((x) => ({ key: x.key, userId: c.userId, courseId: c.courseId, conceptId: c.id, generatorId, kind, stemHash: x.stemHash, body: x.body }))).onConflictDoNothing();
  }
}

/** Write and validate numeric generators until the target is met or attempts run out. Failed generators are repaired once, then discarded. */
async function stageNumeric(c: typeof schema.lmConcepts.$inferSelect, cm: ChunkMap) {
  const t = targets();
  const have = await db.select({ n: sql<number>`count(*)::int` }).from(schema.lmGenerators).where(and(eq(schema.lmGenerators.conceptId, c.id), eq(schema.lmGenerators.kind, "numeric")));
  let good = have[0]?.n ?? 0; const stems: string[] = []; const report: string[] = [];
  for (let attempt = 0; good < t.numeric && attempt < t.numeric * t.attempts; attempt++) {
    const user = `Concept: ${conceptBrief(c)}\nGenerator number ${good + 1} of ${t.numeric}. Make it test a DIFFERENT skill or context from these already written:\n${stems.map((s) => `- ${s.slice(0, 160)}`).join("\n") || "(none yet)"}\n\n${courseMaterial(cm.chunks)}`;
    let gen;
    try { gen = (await callJson(c.userId, "D_numeric", user, numericGenSchema, { maxTokens: 2800 })).data; } catch (e) { report.push(e instanceof Error ? e.message : "generation failed"); continue; }
    const spec: NumericSpec = { params: gen.params, stemTemplate: gen.stem_template, stepsTemplates: gen.steps_templates, traps: gen.traps, assumptions: gen.assumptions_stated_in_stem };
    const candidate = { spec, solverCode: gen.solver_code, sourceRefs: refs(gen.source_refs, cm) };
    // E1: an independent solver written from the question template alone, never from the author's code.
    let indep: string | null = null;
    try {
      const e1 = await callJson(c.userId, "E1_independent_solver", `Question template (placeholders are parameter names):\n${gen.stem_template}\n\nParameters:\n${JSON.stringify(gen.params)}\n\nSteps shown to the student use these conventions:\n${gen.assumptions_stated_in_stem.join("; ") || "(none)"}`, e1Schema, { maxTokens: 1500 });
      indep = e1.data.solver_code;
    } catch (e) { report.push(`E1 failed: ${e instanceof Error ? e.message : "error"}`); }
    let rep;
    try { rep = await validateNumericGenerator(candidate, indep, t.seeds); } catch (e) { report.push(`validation could not run: ${e instanceof Error ? e.message : "error"}`); continue; }
    if (!rep.ok) { report.push(`discarded: ${rep.failures.slice(0, 3).join(" | ")}`); continue; }
    const built = await buildNumericItems(candidate, seedsFor(t.seeds));
    // A generator whose questions mostly duplicate ones the course already has adds nothing: reject it instead of saving an empty shell.
    const hashes = built.flatMap((b) => ("item" in b ? [b.stemHash] : []));
    const dup = hashes.length ? (await db.select({ n: sql<number>`count(*)::int` }).from(schema.lmItems).where(and(eq(schema.lmItems.courseId, c.courseId), inArray(schema.lmItems.stemHash, hashes))))[0].n : 0;
    if (dup > hashes.length * 0.3) { report.push(`discarded: ${dup} of ${hashes.length} questions duplicate existing ones`); stems.push(gen.stem_template); continue; }
    const [row] = await db.insert(schema.lmGenerators).values({ userId: c.userId, courseId: c.courseId, conceptId: c.id, kind: "numeric", difficulty: gen.difficulty, spec, solverCode: gen.solver_code, solverHash: sha256(gen.solver_code), validatedAt: new Date(), validationReport: { ...rep, independentSolverHash: indep ? sha256(indep) : null }, sourceRefs: candidate.sourceRefs, promptVersion: promptVersion("D_numeric"), model: await modelName(c.userId) }).returning({ id: schema.lmGenerators.id });
    await saveItems(c, row.id, "numeric", built.flatMap((b) => ("item" in b ? [{ key: `${row.id}:${b.seed}`, stemHash: b.stemHash, body: b.item }] : [])));
    stems.push(gen.stem_template); good++;
  }
  return { good, report };
}

type RawMcq = { stem: string; options: { text: string; why: string }[]; correct_index: number; skill: string; source_refs: string[] };

/** Blind answer + quality critic, batched. An item survives only if the blind answerer chose the stored answer AND the critic passed all three checks. */
async function verifyMcqs(userId: string, items: RawMcq[], cm: ChunkMap): Promise<{ kept: RawMcq[]; rejected: number }> {
  if (!items.length) return { kept: [], rejected: 0 };
  const blind = items.map((q, i) => `Question ${i + 1}: ${q.stem}\n${q.options.map((o, k) => `  ${k}. ${o.text}`).join("\n")}`).join("\n\n");
  const e2 = await callJson(userId, "E2_independent_mcq", `${blind}\n\n${courseMaterial(cm.chunks)}`, e2Schema, { maxTokens: 2500 });
  const shown = items.map((q, i) => `Question ${i + 1}: ${q.stem}\n${q.options.map((o, k) => `  ${k}. ${o.text}${k === q.correct_index ? "   <-- stated correct answer" : ""}`).join("\n")}`).join("\n\n");
  const e3 = await callJson(userId, "E3_quality_critic", `${shown}\n\n${courseMaterial(cm.chunks)}`, e3Schema, { maxTokens: 2500 });
  const kept = items.flatMap((q, i) => {
    const a = e2.data.answers.find((x) => x.n === i + 1), v = e3.data.verdicts.find((x) => x.n === i + 1);
    const ok = a && v && a.chosen_index === q.correct_index && a.cited_chunk !== null && cm.byLabel.has(a.cited_chunk) && v.clear && v.one_defensible_answer && v.matches_course_convention;
    // The chunk the blind answerer cited is real evidence for items that did not carry their own citation.
    return ok ? [{ ...q, source_refs: q.source_refs.length ? q.source_refs : [a.cited_chunk!] }] : [];
  });
  return { kept, rejected: items.length - kept.length };
}

const shuffleOptions = (q: RawMcq, seedKey: string) => {
  const order = makeRng(hashStr(seedKey)).shuffle([0, 1, 2, 3]);
  return { options: order.map((i) => q.options[i]), correct: order.indexOf(q.correct_index) };
};

async function saveMcqs(c: typeof schema.lmConcepts.$inferSelect, kind: "mcq" | "scenario", kept: RawMcq[], cm: ChunkMap, spec: McqSpec | Record<string, unknown>) {
  if (!kept.length) return 0;
  const [row] = await db.insert(schema.lmGenerators).values({ userId: c.userId, courseId: c.courseId, conceptId: c.id, kind, spec: spec as McqSpec, validatedAt: new Date(), validationReport: { checked: ["e2:blind-answer", "e3:quality-critic"], kept: kept.length }, sourceRefs: [...new Set(kept.flatMap((k) => refs(k.source_refs, cm)))], promptVersion: promptVersion(kind === "mcq" ? "D_mcq" : "D_scenario"), model: await modelName(c.userId) }).returning({ id: schema.lmGenerators.id });
  const items = kept.map((q, i) => {
    const key = `${row.id}:${i}`, s = shuffleOptions(q, key);
    const stemHtml = sanitizeHtml(q.stem);
    return { key, stemHash: String(hashStr(q.stem.toLowerCase().replace(/\s+/g, " "))), body: { stemHtml, kind: "mcq" as const, answer: null, tolerance: 0, choices: s.options.map((o) => sanitizeHtml(o.text)), correctIndex: s.correct, whyEach: s.options.map((o) => sanitizeHtml(o.why)), steps: [], traps: [], sourceRefs: refs(q.source_refs, cm) } };
  });
  await saveItems(c, row.id, kind, items);
  return items.length;
}

async function stageMcq(c: typeof schema.lmConcepts.$inferSelect, cm: ChunkMap) {
  const t = targets();
  const { data } = await callJson(c.userId, "D_mcq", `Concept: ${conceptBrief(c)}\nWrite ${t.mcq + 2} questions.\n\n${courseMaterial(cm.chunks)}`, mcqSchema, { maxTokens: 2900 });
  const { kept, rejected } = await verifyMcqs(c.userId, data.items, cm);
  const n = await saveMcqs(c, "mcq", kept, cm, { items: kept.map((k) => ({ stem: k.stem, options: k.options, correctIndex: k.correct_index, skill: k.skill, sourceRefs: refs(k.source_refs, cm) })) });
  return { kept: n, rejected };
}

async function stageScenarios(c: typeof schema.lmConcepts.$inferSelect, all: (typeof schema.lmConcepts.$inferSelect)[], cm: ChunkMap) {
  const t = targets();
  const methods = [...new Set(all.filter((x) => x.id !== c.id).sort((a, b) => a.position - b.position).map((x) => x.title))].slice(0, 20);
  if (methods.length < 3) return { kept: 0, rejected: 0 };
  const { data } = await callJson(c.userId, "D_scenario", `Method list:\n${methods.map((m) => `- ${m}`).join("\n")}\nWrite ${t.scenarios} scenarios.\n\n${courseMaterial(cm.chunks)}`, scenarioSchema, { maxTokens: 2900 });
  const valid = data.items.filter((s) => methods.includes(s.correct_method) && methods.includes(s.tempting_alternative) && s.correct_method !== s.tempting_alternative);
  const raw: RawMcq[] = valid.map((s) => {
    const others = makeRng(hashStr(s.scenario)).shuffle(methods.filter((m) => m !== s.correct_method && m !== s.tempting_alternative)).slice(0, 2);
    const opts = [{ text: s.correct_method, why: `Correct. ${s.why_correct}` }, { text: s.tempting_alternative, why: s.why_alternative_wrong }, ...others.map((o) => ({ text: o, why: `${o} does not match the clues in this situation.` }))];
    return { stem: `<b>Which method fits?</b><br>${s.scenario}`, options: opts, correct_index: 0, skill: "scenario", source_refs: [] } as RawMcq;
  }).filter((q) => q.options.length === 4);
  const { kept, rejected } = await verifyMcqs(c.userId, raw, cm);
  const n = await saveMcqs(c, "scenario", kept, cm, { items: valid });
  return { kept: n, rejected };
}

// ------------------------------------------------------------------ orchestration

export async function runBuild(buildId: string): Promise<void> {
  const [build] = await db.select().from(schema.lmBuilds).where(eq(schema.lmBuilds.id, buildId)).limit(1);
  if (!build) return;
  const fail = async (msg: string) => { await setBuild(buildId, { status: "failed", error: msg.slice(0, 500), finishedAt: new Date() }); await logActivity(build.userId, "learn.build.failed", { courseId: build.courseId, details: { stage: build.stage, message: msg.slice(0, 200) } }); };
  try {
    await setBuild(buildId, { status: "running", stage: "analyze", done: 0, total: 0, error: null });
    const analysis = await stageAnalyze(build);
    await setBuild(buildId, { stage: "concepts" });
    await stageConcepts(build, analysis);
    const concepts = await db.select().from(schema.lmConcepts).where(and(eq(schema.lmConcepts.courseId, build.courseId), inArray(schema.lmConcepts.moduleId, build.moduleIds))).orderBy(asc(schema.lmConcepts.position));
    if (!concepts.length) return fail("No concepts could be built from the selected modules. Check that they contain imported material.");
    const total = concepts.length * 3; let done = 0;
    await setBuild(buildId, { stage: "lessons and questions", total });
    const allConcepts = await db.select().from(schema.lmConcepts).where(eq(schema.lmConcepts.courseId, build.courseId)).orderBy(asc(schema.lmConcepts.position));
    const methodConcept = concepts.find((c) => /which method|how to choose|choose the (right )?(method|test)/i.test(c.title));
    const t = targets();
    for (const c of concepts) {
      try {
        if (c.status !== "ready") await stageLesson(c);
        done++; await setBuild(buildId, { done });
        const cm = await conceptChunks(c.userId, c.courseId, c);
        if (c.formulas.length > 0) { const r = await stageNumeric(c, cm); if (r.report.length) log("info", "learn.numeric.notes", { conceptId: c.id, kept: r.good, notes: r.report.slice(0, 4).map((x) => x.slice(0, 120)) }); }
        done++; await setBuild(buildId, { done });
        const have = await db.select({ n: sql<number>`count(*)::int` }).from(schema.lmItems).where(and(eq(schema.lmItems.conceptId, c.id), eq(schema.lmItems.kind, "mcq")));
        if ((have[0]?.n ?? 0) < Math.min(t.mcq, 5)) await stageMcq(c, cm);
        if (methodConcept?.id === c.id) {
          const sc = await db.select({ n: sql<number>`count(*)::int` }).from(schema.lmItems).where(and(eq(schema.lmItems.conceptId, c.id), eq(schema.lmItems.kind, "scenario")));
          if ((sc[0]?.n ?? 0) === 0) await stageScenarios(c, allConcepts, cm);
        }
        done++; await setBuild(buildId, { done });
      } catch (e) {
        if (e instanceof AiError && ["rate_limited", "quota", "no_provider"].includes(e.code)) return fail(e.message); // out of budget: stop visibly, keep what exists
        await db.update(schema.lmConcepts).set({ status: "failed" }).where(eq(schema.lmConcepts.id, c.id));
        log("warn", "learn.concept.failed", { conceptId: c.id, message: e instanceof Error ? e.message.slice(0, 160) : "error" });
        done = Math.max(done, 0);
      }
    }
    const ready = await publishable(build.courseId, build.moduleIds);
    if (!ready) return fail("The guide could not be completed: no concept ended up with a lesson and validated questions. Try again, or check the AI connection.");
    await setBuild(buildId, { status: "ready", stage: "ready", done: total, finishedAt: new Date() });
    await logActivity(build.userId, "learn.build.ready", { courseId: build.courseId, details: { modules: build.moduleIds.length, concepts: concepts.length } });
  } catch (e) {
    await fail(e instanceof Error ? e.message : "The build stopped unexpectedly.");
  }
}

/** Only concepts with a lesson and at least some validated questions are offered; failed ones are never shown. */
export async function publishable(courseId: string, moduleIds: string[]): Promise<boolean> {
  const rows = await db.execute<{ n: number }>(sql`select count(*)::int as n from lm_concepts c where c.course_id = ${courseId} and c.status = 'ready'
    and exists (select 1 from lm_items i where i.concept_id = c.id and not i.retired) and c.module_id in (${sql.join(moduleIds.map((m) => sql`${m}::uuid`), sql`, `)})`);
  return (rows.rows[0]?.n ?? 0) > 0;
}
