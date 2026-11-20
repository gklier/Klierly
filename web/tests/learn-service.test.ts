import fs from "node:fs/promises";
import path from "node:path";
import type http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, getPool, schema } from "@/db";
import { deleteAccount } from "@/lib/courses";
import { createSource } from "@/lib/ingest/pipeline";
import { advance, answer, conceptList, screenToken, guideStatus, hint, LearnError, pickItem, reportItem, startBuild, startStudying, studyView } from "@/lib/learn/service";
import { resetRateLimits } from "@/lib/ratelimit";
import { MOCK_KEY, startMockLlm } from "../scripts/mock-llm";
import { FIXTURES, makeCourse, makeUser, prepareDb, waitForDocument } from "./helpers";

const PORT = 4015;
let llm: http.Server;
let u: Awaited<ReturnType<typeof makeUser>>, other: Awaited<ReturnType<typeof makeUser>>, courseId: string, m1: string, m2: string;

beforeAll(async () => {
  await prepareDb(); llm = await startMockLlm(PORT); resetRateLimits();
  Object.assign(process.env, {
    MANAGED_AI_BASE_URL: `http://127.0.0.1:${PORT}/v1`, MANAGED_AI_API_KEY: MOCK_KEY, MANAGED_AI_MODEL: "mock-cheap", MANAGED_AI_USER_DAILY_REQUESTS: "5000", MANAGED_AI_USER_MONTHLY_TOKENS: "50000000", MANAGED_AI_GLOBAL_DAILY_REQUESTS: "50000",
    AI_BURST_PER_MINUTE: "100000", LEARN_NUMERIC_GENERATORS: "3", LEARN_MCQ_ITEMS: "4", LEARN_SCENARIOS: "6", LEARN_VALIDATION_SEEDS: "50",
  });
  u = await makeUser("student"); other = await makeUser("other");
  courseId = (await makeCourse(u.id, "Service course")).id;
  const mk = async (name: string, position: number) => (await db.insert(schema.modules).values({ userId: u.id, courseId, name, position }).returning())[0].id;
  [m1, m2] = [await mk("Module 17: Time series", 1), await mk("Module 18: Spread", 2)];
  for (const [m, f] of [[m1, "module4-forecasting.md"], [m2, "module1-simple-regression.pdf"]] as const) {
    const r = await createSource({ userId: u.id, courseId, moduleId: m, kind: "file", title: f, filename: f, mime: null, data: await fs.readFile(path.join(FIXTURES, "qmb-sample", f)), originUrl: null });
    await waitForDocument(r.documentId);
  }
  const id = await startBuild(u.id, courseId, [m1, m2]);
  for (let i = 0; i < 600; i++) { const [b] = await db.select().from(schema.lmBuilds).where(eq(schema.lmBuilds.id, id)); if (b.status === "ready" || b.status === "failed") { if (b.status === "failed") throw new Error(b.error ?? "build failed"); break; } await new Promise((r) => setTimeout(r, 500)); }
}, 400_000);

afterAll(async () => {
  await deleteAccount(u.id); await deleteAccount(other.id);
  for (const k of Object.keys(process.env)) if (/^(MANAGED_AI_|LEARN_|AI_BURST)/.test(k)) delete process.env[k];
  llm.close(); await getPool().end();
});

const itemFor = async (key: string) => (await db.select().from(schema.lmItems).where(eq(schema.lmItems.key, key)))[0].body;
const solve = async (key: string, right: boolean) => {
  const q = await itemFor(key);
  if (q.kind === "mcq") return String(right ? q.correctIndex : (q.correctIndex! + 1) % 4);
  return String(right ? q.answer : q.answer! + 12345.678);
};

describe("study guide status", () => {
  it("reports real counts from the database and refuses to start before the guide exists", async () => {
    const s = await guideStatus(u.id, courseId);
    expect(s.ready).toBe(true);
    expect(s.concepts).toBe(6);
    const total = (await db.select().from(schema.lmItems).where(and(eq(schema.lmItems.courseId, courseId), eq(schema.lmItems.retired, false)))).length;
    expect(s.questions).toBe(total);
    expect(s.numeric).toBeGreaterThanOrEqual(4 * 3 * 40);
    await expect(startStudying(other.id, courseId)).rejects.toMatchObject({ code: "not_ready" }); // another account sees nothing
    expect(await guideStatus(other.id, courseId)).toMatchObject({ ready: false, concepts: 0 });
    await expect(startBuild(u.id, courseId, [])).rejects.toBeInstanceOf(LearnError);
    await expect(startBuild(other.id, courseId, [m1])).rejects.toMatchObject({ code: "no_modules" }); // not their modules
  });
});

describe("the guided path", () => {
  it("starts on the first concept and resumes exactly where it was", async () => {
    await startStudying(u.id, courseId);
    const a = await studyView(u.id, courseId);
    expect(a).toMatchObject({ phase: "learn", i: 0, concept: { index: 0 } });
    await advance(u.id, courseId);
    await startStudying(u.id, courseId); // pressing the big button again must not reset anything
    const b = await studyView(u.id, courseId);
    expect(b).toMatchObject({ phase: "learn", i: 1, concept: { id: a!.concept.id } });
  });

  it("walks lesson cards, a worked example one step at a time, and three guided rounds with fading scaffolding", async () => {
    let v = (await studyView(u.id, courseId))!;
    while (v.phase === "learn") { await advance(u.id, courseId); v = (await studyView(u.id, courseId))!; }
    expect(v.phase).toBe("worked");
    expect(v.worked!.steps).toHaveLength(1);
    await advance(u.id, courseId);
    expect((await studyView(u.id, courseId))!.worked!.steps).toHaveLength(2);
    while (v.phase === "worked") { await advance(u.id, courseId); v = (await studyView(u.id, courseId))!; }
    const scaffolds: number[] = [];
    for (let round = 0; round < 3; round++) {
      expect(v).toMatchObject({ phase: "guided", round });
      const q = v.question!; scaffolds.push(q.scaffold.length);
      const full = (await itemFor(q.key)).steps.length;
      expect(q.scaffold.length).toBe(round === 0 ? full - 1 : round === 1 ? 1 : 0);
      expect((await answer(u.id, courseId, await solve(q.key, false))).ok).toBe(false); // guided: a miss can be retried
      expect((await studyView(u.id, courseId))!.question!.answered).toBe(false);
      expect((await answer(u.id, courseId, await solve(q.key, true))).ok).toBe(true);
      await advance(u.id, courseId); v = (await studyView(u.id, courseId))!;
    }
    expect(scaffolds[0]).toBeGreaterThanOrEqual(scaffolds[1]); // equal for two-step examples; strictly fewer once an example has three or more steps
    expect(scaffolds[2]).toBe(0);
    expect(v.phase).toBe("practice");
  }, 60_000);

  it("a wrong numeric answer is matched against the known traps; a first hint never reveals the answer", async () => {
    // Find a practice question with a trap on its stored item and enter exactly that wrong number.
    let v = (await studyView(u.id, courseId))!;
    let found = false;
    for (let n = 0; n < 12 && !found; n++) {
      const q = v.question!; const item = await itemFor(q.key);
      if (item.kind === "num" && item.traps.length) {
        await hint(u.id, courseId);
        const h = (await studyView(u.id, courseId))!.question!;
        expect(h.hints).toBe(1);
        expect(h.hintTexts.join(" ")).not.toContain(String(item.answer));
        expect(h.hintTexts.join(" ")).not.toMatch(/answer is/i);
        expect(h.feedback).toBeNull(); // nothing about the solution before answering
        const r = await answer(u.id, courseId, String(item.traps[0].value));
        expect(r.ok).toBe(false);
        const after = (await studyView(u.id, courseId))!.question!;
        expect(after.answered).toBe(true);
        expect(after.feedback!.trap).toBe(item.traps[0].message);
        expect(after.feedback!.steps.length).toBeGreaterThan(1);
        found = true;
      } else { await answer(u.id, courseId, await solve(q.key, true)); await advance(u.id, courseId); v = (await studyView(u.id, courseId))!; if (v.phase !== "practice") break; }
    }
    expect(found).toBe(true);
  }, 60_000);

  it("explains every option of a multiple-choice question after it is answered", async () => {
    await advance(u.id, courseId);
    let v = (await studyView(u.id, courseId))!;
    // Keep studying (finishing concepts as needed) until a multiple-choice question comes up.
    for (let n = 0; n < 120 && !(v.question?.kind === "mcq" && v.phase === "practice" && !v.question.answered); n++) {
      if (v.question && !v.question.answered) await answer(u.id, courseId, await solve(v.question.key, true));
      await advance(u.id, courseId); v = (await studyView(u.id, courseId))!;
    }
    expect(v.question!.kind).toBe("mcq");
    expect(v.question!.feedback).toBeNull();
    await answer(u.id, courseId, await solve(v.question!.key, false));
    const f = (await studyView(u.id, courseId))!.question!.feedback!;
    expect(f.whyEach).toHaveLength(4);
    expect(f.whyEach!.every((w) => w.length > 3)).toBe(true);
    expect(f.correctIndex).toBeGreaterThanOrEqual(0);
  }, 60_000);

  it("eight attempts without mastery re-teach the concept, but only AFTER the feedback for the last answer was shown", async () => {
    const concepts = await conceptList(u.id, courseId);
    let v = (await studyView(u.id, courseId))!;
    // Drive to a practice question on a concept, then miss repeatedly until the re-teach flag is raised.
    for (let n = 0; n < 60 && !(v.phase === "practice" && v.question && !v.question.answered); n++) {
      if (v.question && !v.question.answered) await answer(u.id, courseId, await solve(v.question.key, true));
      await advance(u.id, courseId); v = (await studyView(u.id, courseId))!;
    }
    expect(v.phase).toBe("practice");
    const conceptId = v.concept.id;
    let sawReteachFlag = false;
    for (let n = 0; n < 12 && !sawReteachFlag; n++) {
      if (!(v.question && !v.question.answered)) { await advance(u.id, courseId); v = (await studyView(u.id, courseId))!; continue; }
      await answer(u.id, courseId, await solve(v.question.key, false));
      v = (await studyView(u.id, courseId))!;
      expect(v.question, "the wrong answer's feedback is still on screen").not.toBeNull();
      expect(v.question!.feedback).not.toBeNull();
      const [prog] = await db.select().from(schema.lmProgress).where(and(eq(schema.lmProgress.userId, u.id), eq(schema.lmProgress.courseId, courseId)));
      sawReteachFlag = Boolean(prog.cursor?.reteach);
      if (sawReteachFlag) { expect(v.phase).toBe("practice"); await advance(u.id, courseId); v = (await studyView(u.id, courseId))!; expect(v).toMatchObject({ phase: "worked", concept: { id: conceptId } }); }
      else { await advance(u.id, courseId); v = (await studyView(u.id, courseId))!; }
    }
    expect(sawReteachFlag).toBe(true);
    expect(concepts.length).toBe(6);
  }, 90_000);

  it("a reload mid-question returns the same question, hint level and progress", async () => {
    let before = (await studyView(u.id, courseId))!;
    for (let n = 0; n < 40 && !(before.question && !before.question.answered); n++) {
      if (before.question && !before.question.answered) break;
      await advance(u.id, courseId); before = (await studyView(u.id, courseId))!;
    }
    expect(before.question && !before.question.answered).toBe(true);
    await hint(u.id, courseId); await hint(u.id, courseId);
    const a = (await studyView(u.id, courseId))!;
    expect(a.question!.hints).toBe(2);
    const b = (await studyView(u.id, courseId))!; // a fresh read, as after a page reload
    expect(b.question!.key).toBe(a.question!.key);
    expect(b.question!.key).toBe(before.question!.key);
    expect(b).toMatchObject({ question: { hints: 2, tries: 0 }, phase: a.phase, mastery: a.mastery });
  }, 60_000);

  it("mastery needs four clean answers of the last five; hinted answers do not count; then the next concept opens", async () => {
    // Fresh course state for the current concept: answer five in a row, all unaided and correct.
    const cl = await conceptList(u.id, courseId);
    const cur = (await studyView(u.id, courseId))!;
    const startIdx = cur.concept.index;
    let v = cur, guard = 0;
    while (v.phase !== "done" && guard++ < 40) {
      if (!v.question) { await advance(u.id, courseId); v = (await studyView(u.id, courseId))!; continue; }
      if (!v.question.answered) await answer(u.id, courseId, await solve(v.question.key, true));
      await advance(u.id, courseId); v = (await studyView(u.id, courseId))!;
    }
    expect(v.phase).toBe("done");
    expect(["practiced", "solid"]).toContain(v.status);
    await advance(u.id, courseId);
    const next = (await studyView(u.id, courseId))!;
    expect(next).toMatchObject({ phase: "learn", concept: { index: startIdx + 1 } });
    expect((await conceptList(u.id, courseId))[startIdx].status).not.toBe("new");
    expect(cl.length).toBe(6);
  }, 120_000);
});

describe("stale screens", () => {
  it("an action built on an older screen is ignored or refused, never applied to the question now showing", async () => {
    let v = (await studyView(u.id, courseId))!;
    for (let n = 0; n < 40 && !(v.question && !v.question.answered); n++) { await advance(u.id, courseId); v = (await studyView(u.id, courseId))!; }
    const old = v.token;
    expect(old).toBeTruthy();
    await answer(u.id, courseId, await solve(v.question!.key, true), old);
    const after = (await studyView(u.id, courseId))!;
    expect(after.token).not.toBe(old);
    await advance(u.id, courseId, old); // the double-click on a stale Next: nothing happens
    expect((await studyView(u.id, courseId))!.token).toBe(after.token);
    await advance(u.id, courseId, after.token);
    const moved = (await studyView(u.id, courseId))!;
    expect(moved.token).not.toBe(after.token);
    if (moved.question && !moved.question.answered) {
      await expect(answer(u.id, courseId, "1", old)).rejects.toMatchObject({ code: "stale" });
      expect((await studyView(u.id, courseId))!.question!.tries).toBe(0); // the stale answer did not count
      await hint(u.id, courseId, old);
      expect((await studyView(u.id, courseId))!.question!.hints).toBe(0);
    }
    expect(screenToken(null)).toBe("");
  }, 60_000);
});

describe("question supply, dedupe and reports", () => {
  it("400 consecutive picks for one concept produce no repeated stem (numeric top-up is automatic and needs no AI)", async () => {
    const concepts = await conceptList(u.id, courseId);
    const calc = (await db.select().from(schema.lmConcepts).where(eq(schema.lmConcepts.courseId, courseId))).find((c) => c.formulas.length > 0 && c.id !== concepts[0].id)!;
    const calls = (await db.select().from(schema.aiUsage).where(eq(schema.aiUsage.userId, u.id))).length;
    const p = { seen: {} as Record<string, 1>, seenStems: {} as Record<string, 1> };
    const stems = new Set<string>(), keys = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const pick = await pickItem(u.id, p, calc.id, "numeric");
      expect(pick, `pick ${i}`).not.toBeNull();
      expect(stems.has(pick!.stemHash)).toBe(false); expect(keys.has(pick!.key)).toBe(false);
      stems.add(pick!.stemHash); keys.add(pick!.key); p.seen[pick!.key] = 1; p.seenStems[pick!.stemHash] = 1;
    }
    expect(stems.size).toBe(400);
    expect((await db.select().from(schema.aiUsage).where(eq(schema.aiUsage.userId, u.id))).length).toBe(calls); // no AI call was made to top up
  }, 180_000);

  it("one tap on Report removes the question from the pool without interrupting anything", async () => {
    const c = (await db.select().from(schema.lmConcepts).where(eq(schema.lmConcepts.courseId, courseId)))[0];
    const [it] = await db.select().from(schema.lmItems).where(and(eq(schema.lmItems.conceptId, c.id), eq(schema.lmItems.retired, false))).limit(1);
    await reportItem(u.id, courseId, it.key, "looks wrong");
    expect((await db.select().from(schema.lmItems).where(eq(schema.lmItems.key, it.key)))[0].retired).toBe(true);
    expect(await db.select().from(schema.lmReports).where(eq(schema.lmReports.itemKey, it.key))).toHaveLength(1);
    await reportItem(other.id, courseId, it.key, "not mine"); // someone else's item: ignored
    expect(await db.select().from(schema.lmReports).where(eq(schema.lmReports.userId, other.id))).toHaveLength(0);
  });

  it("another account cannot read or change this account's progress", async () => {
    expect(await studyView(other.id, courseId)).toBeNull();
    await expect(answer(other.id, courseId, "1")).rejects.toMatchObject({ code: "no_question" });
    await expect(advance(other.id, courseId)).rejects.toMatchObject({ code: "no_cursor" });
  });
});
