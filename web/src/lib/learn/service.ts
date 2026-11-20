import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LmCursor, LmItem } from "@/db/schema";
import { logActivity } from "@/lib/activity";
import { buildNumericItems } from "./items";
import { afterPractice, applyAnswer, gradeNumeric, isDone, mastery, newQuestionState, nextHintLevel, revisitChoice, scoreOf, type ConceptState, type MissEntry } from "./engine";
import { runBuild } from "./pipeline";

type Concept = typeof schema.lmConcepts.$inferSelect;
type Progress = typeof schema.lmProgress.$inferSelect;

export class LearnError extends Error { constructor(public code: string, message: string) { super(message); } }

// ------------------------------------------------------------------ guide status and building

export async function guideStatus(userId: string, courseId: string) {
  const [build] = await db.select().from(schema.lmBuilds).where(and(eq(schema.lmBuilds.courseId, courseId), eq(schema.lmBuilds.userId, userId))).orderBy(desc(schema.lmBuilds.createdAt)).limit(1);
  const counts = await db.execute<{ kind: string; n: number }>(sql`select i.kind, count(*)::int as n from lm_items i join lm_concepts c on c.id = i.concept_id
    where i.course_id = ${courseId} and i.user_id = ${userId} and not i.retired and c.status = 'ready' group by i.kind`);
  const by = Object.fromEntries(counts.rows.map((r) => [r.kind, r.n])) as Record<string, number>;
  const [{ n: concepts }] = (await db.execute<{ n: number }>(sql`select count(*)::int as n from lm_concepts where course_id = ${courseId} and user_id = ${userId} and status = 'ready'`)).rows;
  const questions = (by.numeric ?? 0) + (by.mcq ?? 0) + (by.scenario ?? 0);
  return { build: build ?? null, concepts, questions, numeric: by.numeric ?? 0, mcq: by.mcq ?? 0, scenario: by.scenario ?? 0, ready: concepts > 0 && questions > 0 };
}

/** One click: record the build and run it in the background. Only the chosen modules are touched. */
export async function startBuild(userId: string, courseId: string, moduleIds: string[]) {
  const owned = moduleIds.length ? await db.select({ id: schema.modules.id }).from(schema.modules).where(and(eq(schema.modules.courseId, courseId), eq(schema.modules.userId, userId), inArray(schema.modules.id, moduleIds))) : [];
  if (!owned.length) throw new LearnError("no_modules", "Choose at least one module to study.");
  const [running] = await db.select({ id: schema.lmBuilds.id }).from(schema.lmBuilds).where(and(eq(schema.lmBuilds.courseId, courseId), inArray(schema.lmBuilds.status, ["queued", "running"]))).limit(1);
  if (running) throw new LearnError("busy", "A study guide is already being built for this course.");
  const [b] = await db.insert(schema.lmBuilds).values({ userId, courseId, moduleIds: owned.map((o) => o.id) }).returning();
  await logActivity(userId, "learn.build.started", { courseId, details: { modules: owned.length } });
  void runBuild(b.id); // background; progress is read from the row
  return b.id;
}

// ------------------------------------------------------------------ progress state

async function loadProgress(userId: string, courseId: string): Promise<Progress> {
  await db.insert(schema.lmProgress).values({ userId, courseId }).onConflictDoNothing();
  return (await db.select().from(schema.lmProgress).where(and(eq(schema.lmProgress.userId, userId), eq(schema.lmProgress.courseId, courseId))).limit(1))[0];
}
const saveProgress = (p: Progress) => db.update(schema.lmProgress).set({ cursor: p.cursor, miss: p.miss, seen: p.seen, seenStems: p.seenStems, answered: p.answered, correctUnaided: p.correctUnaided, updatedAt: new Date() }).where(and(eq(schema.lmProgress.userId, p.userId), eq(schema.lmProgress.courseId, p.courseId)));

async function readyConcepts(userId: string, courseId: string): Promise<Concept[]> {
  return db.select().from(schema.lmConcepts).where(and(eq(schema.lmConcepts.courseId, courseId), eq(schema.lmConcepts.userId, userId), eq(schema.lmConcepts.status, "ready"))).orderBy(asc(schema.lmConcepts.position));
}
async function stateMap(userId: string, concepts: Concept[]): Promise<Map<string, ConceptState>> {
  const rows = concepts.length ? await db.select().from(schema.lmConceptState).where(and(eq(schema.lmConceptState.userId, userId), inArray(schema.lmConceptState.conceptId, concepts.map((c) => c.id)))) : [];
  const m = new Map<string, ConceptState>();
  for (const c of concepts) { const r = rows.find((x) => x.conceptId === c.id); m.set(c.id, r ? { status: r.status, log: r.log, baseIndex: r.baseIndex } : { status: "new", log: [], baseIndex: 0 }); }
  return m;
}
const saveState = (userId: string, conceptId: string, st: ConceptState) => db.insert(schema.lmConceptState).values({ userId, conceptId, ...st }).onConflictDoUpdate({ target: [schema.lmConceptState.userId, schema.lmConceptState.conceptId], set: { status: st.status, log: st.log, baseIndex: st.baseIndex, updatedAt: new Date() } });

// ------------------------------------------------------------------ choosing questions

const itemOf = async (key: string, userId: string) => (await db.select().from(schema.lmItems).where(and(eq(schema.lmItems.key, key), eq(schema.lmItems.userId, userId))).limit(1))[0] ?? null;

/** More validated seeds for a numeric generator, with no AI call: the solver already passed validation. */
export async function topUp(userId: string, conceptId: string, count = 40) {
  const gens = await db.select().from(schema.lmGenerators).where(and(eq(schema.lmGenerators.conceptId, conceptId), eq(schema.lmGenerators.kind, "numeric"), eq(schema.lmGenerators.userId, userId)));
  let added = 0;
  for (const g of gens) {
    if (!g.solverCode) continue;
    const top = (await db.execute<{ m: number | null }>(sql`select max(split_part(key, ':', 2)::int) as m from lm_items where generator_id = ${g.id}`)).rows[0]?.m ?? 1000;
    const seeds = Array.from({ length: count }, (_, i) => top + 1 + i);
    const built = await buildNumericItems({ spec: g.spec as never, solverCode: g.solverCode, sourceRefs: g.sourceRefs }, seeds);
    const rows = built.flatMap((b) => ("item" in b ? [{ key: `${g.id}:${b.seed}`, userId, courseId: g.courseId, conceptId, generatorId: g.id, kind: "numeric" as const, stemHash: b.stemHash, body: b.item }] : []));
    if (rows.length) { const r = await db.insert(schema.lmItems).values(rows).onConflictDoNothing().returning({ key: schema.lmItems.key }); added += r.length; }
  }
  return added;
}

/** An unseen, unretired question for the concept whose wording the student has not met. Numeric top-up happens here, silently. */
export async function pickItem(userId: string, p: Pick<Progress, "seen" | "seenStems">, conceptId: string, prefer?: "numeric" | "mcq"): Promise<{ key: string; item: LmItem; stemHash: string } | null> {
  const seenKeys = Object.keys(p.seen), seenHashes = Object.keys(p.seenStems);
  const query = async (kinds?: string[]) => {
    const conds = [eq(schema.lmItems.conceptId, conceptId), eq(schema.lmItems.userId, userId), eq(schema.lmItems.retired, false)];
    if (kinds) conds.push(inArray(schema.lmItems.kind, kinds as never));
    if (seenKeys.length) conds.push(notInArray(schema.lmItems.key, seenKeys));
    if (seenHashes.length) conds.push(notInArray(schema.lmItems.stemHash, seenHashes));
    return (await db.select().from(schema.lmItems).where(and(...conds)).orderBy(sql`random()`).limit(1))[0];
  };
  const order = prefer === "mcq" ? [["mcq", "scenario"], ["numeric"]] : prefer === "numeric" ? [["numeric"], ["mcq", "scenario"]] : [undefined];
  for (const kinds of order) { const r = await query(kinds); if (r) return { key: r.key, item: r.body, stemHash: r.stemHash }; }
  if ((await topUp(userId, conceptId)) > 0) { const r = await query(["numeric"]); if (r) return { key: r.key, item: r.body, stemHash: r.stemHash }; }
  return null;
}

// ------------------------------------------------------------------ flow

const cursorFor = (conceptId: string, phase: LmCursor["phase"]): LmCursor => ({ conceptId, phase, i: 0, round: 0, pcount: 0, check: false, checkLog: [], qs: null });

async function firstNumericKey(conceptId: string, userId: string): Promise<string | null> {
  const r = (await db.select({ key: schema.lmItems.key }).from(schema.lmItems).where(and(eq(schema.lmItems.conceptId, conceptId), eq(schema.lmItems.userId, userId), eq(schema.lmItems.kind, "numeric"), eq(schema.lmItems.retired, false))).orderBy(asc(schema.lmItems.key)).limit(1))[0];
  return r?.key ?? null;
}

async function nextQuestion(userId: string, p: Progress, c: Concept, states: Map<string, ConceptState>) {
  const cur = p.cursor!;
  cur.pcount += 1;
  let key: string | null = null, review = false;
  if (cur.phase === "practice") {
    const all = await readyConcepts(userId, c.courseId);
    const weak = all.filter((x) => x.id !== c.id && states.get(x.id)!.log.length).sort((a, b) => mastery(states.get(a.id)!) - mastery(states.get(b.id)!))[0];
    const choice = revisitChoice({ practiceCount: cur.pcount, check: cur.check, currentConceptId: c.id, miss: p.miss as MissEntry[], answered: p.answered, weakest: weak ? { key: weak.id } : null });
    if (choice.kind === "miss") { const it = await itemOf(choice.key, userId); if (it && !it.retired) { key = it.key; review = true; } }
    else if (choice.kind === "weak" && weak) { const pk = await pickItem(userId, p, weak.id); if (pk) { key = pk.key; review = true; } }
  }
  if (!key) {
    const prefer = cur.phase === "guided" ? "numeric" : undefined;
    const pk = await pickItem(userId, p, c.id, prefer);
    if (!pk) throw new LearnError("empty", "This concept has no unseen questions left.");
    key = pk.key;
  }
  cur.qs = { ...newQuestionState(key, cur.phase === "guided" ? "guided" : cur.check ? "check" : "practice"), review };
}

export async function startStudying(userId: string, courseId: string) {
  const concepts = await readyConcepts(userId, courseId);
  if (!concepts.length) throw new LearnError("not_ready", "The study guide is not ready yet.");
  const p = await loadProgress(userId, courseId);
  const states = await stateMap(userId, concepts);
  if (p.cursor && concepts.some((c) => c.id === p.cursor!.conceptId)) return; // resume exactly where they were
  const next = concepts.find((c) => !isDone(states.get(c.id)!.status)) ?? concepts[0];
  await enterConcept(userId, p, next, states);
}

async function enterConcept(userId: string, p: Progress, c: Concept, states: Map<string, ConceptState>) {
  const st = states.get(c.id)!;
  if (st.status === "new") { st.status = "learning"; await saveState(userId, c.id, st); }
  p.cursor = cursorFor(c.id, "learn");
  await saveProgress(p);
}

export type Phase = LmCursor["phase"];

/** What the student is looking at. Forms send it back; an action built on an older screen (a double-click, a second tab) is ignored. */
export const screenToken = (c: LmCursor | null) => c ? `${c.conceptId}|${c.phase}|${c.i}|${c.round}|${c.qs?.key ?? ""}|${c.qs?.answered ? 1 : 0}|${c.qs?.tries ?? 0}|${c.qs?.hints ?? 0}` : "";

/** Move to the next phase. "worked" is skipped when the concept has no numeric example. */
export async function advance(userId: string, courseId: string, token?: string) {
  const concepts = await readyConcepts(userId, courseId);
  const p = await loadProgress(userId, courseId);
  const cur = p.cursor; if (!cur) throw new LearnError("no_cursor", "Start studying first.");
  if (token !== undefined && token !== screenToken(cur)) return; // a stale screen (double-click): do nothing
  const c = concepts.find((x) => x.id === cur.conceptId); if (!c) throw new LearnError("gone", "That concept is no longer available.");
  const states = await stateMap(userId, concepts);
  const hasWorked = Boolean(await firstNumericKey(c.id, userId));
  if (cur.phase === "learn") {
    if (cur.i < c.cards.length - 1) { cur.i += 1; await saveProgress(p); return; }
    cur.phase = hasWorked ? "worked" : "guided"; cur.i = 0;
  } else if (cur.phase === "worked") {
    const key = await firstNumericKey(c.id, userId); const it = key ? await itemOf(key, userId) : null;
    if (it && cur.i < it.body.steps.length - 1) { cur.i += 1; await saveProgress(p); return; }
    cur.phase = "guided"; cur.i = 0;
  } else if (cur.phase === "guided") {
    if (!cur.qs?.answered) throw new LearnError("unanswered", "Answer the question first.");
    cur.round += 1;
    if (cur.round >= 3) { cur.phase = "practice"; cur.round = 0; cur.pcount = 0; const st = states.get(c.id)!; st.baseIndex = Math.min(st.baseIndex, st.log.length); await saveState(userId, c.id, st); }
    cur.qs = null;
  } else if (cur.phase === "practice") {
    if (!cur.qs?.answered) throw new LearnError("unanswered", "Answer the question first.");
    cur.qs = null;
    if (isDone(states.get(c.id)!.status)) { cur.phase = "done"; cur.reteach = false; }
    else if (cur.reteach) { // eight attempts without mastery: teach it again, then a fresh run of practice
      const st = states.get(c.id)!; await saveState(userId, c.id, { ...st, baseIndex: st.log.length });
      cur.reteach = false; cur.phase = "worked"; cur.i = 0; cur.pcount = 0;
      await saveProgress(p); return;
    }
  } else if (cur.phase === "done") {
    const next = concepts.find((x) => !isDone(states.get(x.id)!.status));
    if (!next) { p.cursor = null; await saveProgress(p); return; }
    await enterConcept(userId, p, next, states); return;
  }
  if (cur.phase === "guided" || cur.phase === "practice") await nextQuestion(userId, p, c, states);
  await saveProgress(p);
}

/** Show a hint. Level 1 recaps the idea, 2 shows the first step, 3 everything but the final answer. The answer is never given. */
export async function hint(userId: string, courseId: string, token?: string) {
  const p = await loadProgress(userId, courseId);
  const cur = p.cursor; if (!cur?.qs || cur.qs.answered) return;
  if (token !== undefined && token !== screenToken(cur)) return;
  cur.qs.hints = nextHintLevel(cur.qs.hints);
  await saveProgress(p);
}

export type AnswerOutcome = { ok: boolean; bad?: boolean };

export async function answer(userId: string, courseId: string, resp: string, token?: string): Promise<AnswerOutcome> {
  const concepts = await readyConcepts(userId, courseId);
  const p = await loadProgress(userId, courseId);
  const cur = p.cursor; if (!cur?.qs || cur.qs.answered) throw new LearnError("no_question", "There is no open question.");
  if (token !== undefined && token !== screenToken(cur)) throw new LearnError("stale", "That question has moved on. Your answer was not counted; look at the question on screen.");
  const c = concepts.find((x) => x.id === cur.conceptId)!;
  const it = await itemOf(cur.qs.key, userId); if (!it) throw new LearnError("gone", "That question is no longer available.");
  const q = it.body, qs = cur.qs;
  let ok: boolean, trap: string | null = null;
  if (q.kind === "mcq") {
    const choice = Number(resp);
    if (!Number.isInteger(choice) || choice < 0 || choice >= (q.choices?.length ?? 0)) throw new LearnError("bad_choice", "Pick one of the options.");
    ok = choice === q.correctIndex; qs.resp = choice; if (!ok) qs.wrong = [...(qs.wrong ?? []), choice];
  } else {
    const g = gradeNumeric(resp, q.answer!, q.tolerance, q.traps);
    if (g.bad) return { ok: false, bad: true };
    ok = g.ok; trap = g.trap ?? null; qs.resp = resp;
  }
  qs.tries += 1; qs.trap = trap;
  const hinted = qs.hints > 0;
  const guided = qs.mode === "guided";
  // Guided questions can be retried until right; practice and check questions end on the first answer.
  const final = guided ? ok : true;
  await db.insert(schema.lmAnswers).values({ userId, itemKey: qs.key, conceptId: c.id, ok, hinted: hinted || qs.tries > 1, mode: qs.mode });
  if (guided && !ok && qs.tries >= 2 && qs.hints < 2) qs.hints = 2;
  if (final) {
    qs.answered = true; qs.ok = ok;
    const states = await stateMap(userId, concepts);
    p.answered += 1; if (ok && !hinted && qs.tries === 1) p.correctUnaided += 1;
    p.seen = { ...p.seen, [qs.key]: 1 }; p.seenStems = { ...p.seenStems, [it.stemHash]: 1 };
    const res = applyAnswer(states.get(c.id)!, p.miss as MissEntry[], { key: qs.key, conceptId: c.id, ok, hinted: hinted || (guided && qs.tries > 1), review: Boolean(qs.review), answerCount: p.answered });
    p.miss = res.miss; let st = res.st;
    if (!guided) {
      if (cur.check) cur.checkLog.push(ok && !hinted ? 1 : 0);
      const ap = afterPractice(st, cur); st = ap.st;
      if (ap.reteach) cur.reteach = true; // shown on the next press, so the student still sees why this answer was wrong
    }
    await saveState(userId, c.id, st);
  }
  await saveProgress(p);
  return { ok };
}

/** One tap, never interrupts studying: the question leaves everyone's pool at once so it cannot be shown again. */
export async function reportItem(userId: string, courseId: string, key: string, note: string) {
  const it = await itemOf(key, userId);
  if (!it || it.courseId !== courseId) return;
  await db.insert(schema.lmReports).values({ userId, itemKey: key, note: note.slice(0, 300) });
  await db.update(schema.lmItems).set({ retired: true }).where(eq(schema.lmItems.key, key));
}

// ------------------------------------------------------------------ the view the page renders

export type StudyView = {
  token: string;
  concept: { id: string; title: string; why: string; short: string; alt: string; cards: Concept["cards"]; formulas: Concept["formulas"]; index: number; total: number; minutes: number };
  phase: Phase; i: number; round: number;
  worked: { steps: string[]; stem: string } | null;
  question: null | {
    key: string; kind: "num" | "mcq"; stemHtml: string; choices: string[] | null; hints: number; hintTexts: string[]; scaffold: string[]; tries: number;
    answered: boolean; ok: boolean | null; review: boolean; wrong: number[]; resp: string | number | null;
    feedback: null | { whyEach: string[] | null; correctIndex: number | null; answer: number | null; steps: string[]; trap: string | null };
    sources: string[];
  };
  mastery: number; status: string;
  checkpoint: { recent: number[]; needed: number };
};

export async function studyView(userId: string, courseId: string): Promise<StudyView | null> {
  const concepts = await readyConcepts(userId, courseId);
  const p = await loadProgress(userId, courseId);
  const cur = p.cursor; if (!cur) return null;
  const idx = concepts.findIndex((x) => x.id === cur.conceptId); if (idx < 0) return null;
  const c = concepts[idx], states = await stateMap(userId, concepts), st = states.get(c.id)!;
  let worked: StudyView["worked"] = null, question: StudyView["question"] = null;
  if (cur.phase === "worked") {
    const key = await firstNumericKey(c.id, userId), it = key ? await itemOf(key, userId) : null;
    if (it) worked = { stem: it.body.stemHtml, steps: it.body.steps.slice(0, cur.i + 1) };
  }
  if (cur.qs) {
    const qs = cur.qs, it = await itemOf(qs.key, userId);
    if (it) {
      const q = it.body, steps = q.steps;
      const scaffold = qs.mode === "guided" && q.kind === "num" ? (cur.round === 0 ? steps.slice(0, -1) : cur.round === 1 ? steps.slice(0, 1) : []) : [];
      // Hint ladder: level 1 recap, 2 first step (or one wrong option struck out), 3 all but the final step (or two struck out). Never the answer.
      const hintTexts: string[] = [];
      if (qs.hints >= 1) hintTexts.push(`Remember: ${c.short}`);
      if (qs.hints >= 2) hintTexts.push(q.kind === "num" ? (steps[0] ? `First step: ${steps[0]}` : "Work one step at a time.") : "One wrong option is crossed out below.");
      if (qs.hints >= 3) hintTexts.push(q.kind === "num" ? `Steps so far: ${steps.slice(0, Math.max(1, steps.length - 1)).join(" ")}` : "Two wrong options are crossed out below.");
      const struck = q.kind === "mcq" && q.choices ? q.choices.map((_, i) => i).filter((i) => i !== q.correctIndex).slice(0, qs.hints >= 3 ? 2 : qs.hints >= 2 ? 1 : 0) : [];
      const reveal = qs.answered;
      const srcTitles = reveal && q.sourceRefs.length ? (await db.select({ t: schema.sourceDocuments.title }).from(schema.sourceChunks).innerJoin(schema.sourceDocuments, eq(schema.sourceDocuments.id, schema.sourceChunks.documentId)).where(inArray(schema.sourceChunks.id, q.sourceRefs.slice(0, 3)))).map((r) => r.t) : [];
      question = {
        key: qs.key, kind: q.kind, stemHtml: q.stemHtml, choices: q.choices, hints: qs.hints, hintTexts, scaffold, tries: qs.tries, answered: qs.answered, ok: qs.ok, review: Boolean(qs.review),
        wrong: [...(qs.wrong ?? []), ...struck], resp: qs.resp,
        feedback: reveal ? { whyEach: q.whyEach, correctIndex: q.correctIndex, answer: q.answer, steps, trap: qs.trap ?? null } : null,
        sources: [...new Set(srcTitles)],
      };
    }
  }
  return {
    token: screenToken(cur),
    concept: { id: c.id, title: c.title, why: c.why, short: c.short, alt: c.altExplanation, cards: c.cards, formulas: c.formulas, index: idx, total: concepts.length, minutes: c.minutes },
    phase: cur.phase, i: cur.i, round: cur.round, worked, question, mastery: mastery(st), status: st.status,
    checkpoint: { recent: st.log.slice(st.baseIndex).slice(-5), needed: 4 },
  };
}

export async function conceptList(userId: string, courseId: string) {
  const concepts = await readyConcepts(userId, courseId);
  const states = await stateMap(userId, concepts);
  return concepts.map((c) => ({ id: c.id, title: c.title, status: states.get(c.id)!.status, mastery: mastery(states.get(c.id)!) }));
}

export { scoreOf };
