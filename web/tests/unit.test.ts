import { describe, expect, it } from "vitest";
import { chunkSegments, splitText } from "@/lib/ingest/chunk";
import { parseDateInLine, parseModulesCovered, proposeFromChunks, moduleNumberOf } from "@/lib/ingest/proposals";
import { assessAssessment } from "@/lib/ingest/guard";
import { evaluate, formatNumber } from "@/lib/calc";
import { grade, mulberry32, nextMastery, parseNumericInput, pickByQuota, pickQuestions, readiness, type PoolQuestion, type TopicState } from "@/lib/practice/core";
import { allocate } from "@/lib/practice/blueprint";
import { buildSchedule, type PlanTopic } from "@/lib/plan/schedule";
import { addDays } from "@/lib/dates";
import { redact } from "@/lib/log";
import { toOrQuery } from "@/lib/retrieval";
import type { Segment } from "@/lib/worker";

const seg = (text: string, o: Partial<Segment> = {}): Segment => ({ kind: "text", text, heading: null, page: null, slide: null, t_start_ms: null, t_end_ms: null, ...o });

describe("chunking", () => {
  it("keeps provenance and contiguous offsets", () => {
    const chunks = chunkSegments([seg("Intro text.", { page: 1, heading: "A" }), seg("More on page one.", { page: 1, heading: "A" }), seg("Page two.", { page: 2, heading: "B" }), seg("x | y\n1 | 2", { kind: "table", page: 2 }), seg("Cue text", { t_start_ms: 0, t_end_ms: 45000 })]);
    expect(chunks.map((c) => c.page)).toEqual([1, 2, 2, null]);
    expect(chunks[0].text).toBe("Intro text.\n\nMore on page one.");
    expect(chunks[2].kind).toBe("table");
    expect(chunks[3].tEndMs).toBe(45000);
    chunks.forEach((c, i) => { expect(c.ordinal).toBe(i); expect(c.charEnd - c.charStart).toBe(c.text.length); if (i) expect(c.charStart).toBe(chunks[i - 1].charEnd + 2); });
  });
  it("splits long text without losing content", () => {
    const para = Array.from({ length: 80 }, (_, i) => `Sentence number ${i} explains regression clearly.`).join(" ");
    const parts = splitText(`${para}\n\n${para}`);
    expect(parts.length).toBeGreaterThan(4);
    expect(parts.every((p) => p.length <= 1400)).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ")).toBe(`${para} ${para}`);
    expect(splitText("a".repeat(5000)).every((p) => p.length <= 1400)).toBe(true);
  });
  it("drops empty segments", () => expect(chunkSegments([seg("   ")])).toEqual([]));
});

describe("suggestions from materials", () => {
  it("parses dates and module coverage", () => {
    expect(parseDateInLine("Exam 1: December 4, 2026 — covers Modules 1–3.", null)).toEqual({ date: "2026-12-04", yearAssumed: false });
    expect(parseDateInLine("Quiz due Nov 3", 2026)).toEqual({ date: "2026-11-03", yearAssumed: true });
    expect(parseDateInLine("Quiz due Nov 3", null)).toBeNull();
    expect(parseDateInLine("Final 12/15/2026", null)?.date).toBe("2026-12-15");
    expect(parseDateInLine("Exam on February 30, 2026", null)).toBeNull();
    expect(parseModulesCovered("covers Modules 1–3")).toEqual([1, 2, 3]);
    expect(parseModulesCovered("covers modules 2, 4 and 5")).toEqual([2, 4, 5]);
    expect(parseModulesCovered("bring a calculator")).toBeUndefined();
    expect(moduleNumberOf("module3-indicators.pptx")).toBe(3);
  });
  it("proposes only what the text supports", () => {
    const drafts = proposeFromChunks({ id: "d", title: "Syllabus" }, [
      { ordinal: 0, kind: "text", heading: "Modules", text: "Module 1: Simple Linear Regression\nModule 2: Multiple Regression" },
      { ordinal: 1, kind: "text", heading: "Module 2: Multiple Regression", text: "Learning objectives:\n- Interpret a partial slope while holding others fixed.\n- Compare models using adjusted R-squared.\n\nNot an objective line." },
      { ordinal: 2, kind: "table", heading: "Schedule", text: "Date | Item\nDecember 4, 2026 | Exam 1 — covers Modules 1–2\nNovember 9, 2026 | Module 2 opens" },
    ], { termYear: 2026 });
    const kinds = (k: string) => drafts.filter((d) => d.payload.kind === k).map((d) => d.payload);
    expect(kinds("module")).toHaveLength(2);
    expect(kinds("objective")).toEqual([
      { kind: "objective", text: "Interpret a partial slope while holding others fixed.", moduleNumber: 2 },
      { kind: "objective", text: "Compare models using adjusted R-squared.", moduleNumber: 2 }]);
    expect(kinds("date")).toEqual([{ kind: "date", label: "December 4, 2026 — Exam 1 — covers Modules 1–2", date: "2026-12-04", dateKind: "exam", modulesCovered: [1, 2] }]);
    expect(kinds("topic")).toHaveLength(0); // syllabus headings are not topics
  });
  it("turns note headings into topics, skipping generic ones", () => {
    const drafts = proposeFromChunks({ id: "d", title: "Module 1 notes" }, [
      { ordinal: 0, kind: "text", heading: "Introduction", text: "x" }, { ordinal: 1, kind: "text", heading: "Testing the slope", text: "x" },
      { ordinal: 2, kind: "text", heading: "Testing the slope (speaker notes)", text: "x" }, { ordinal: 3, kind: "text", heading: "Summary", text: "x" },
    ], { termYear: null });
    expect(drafts.map((d) => d.payload)).toEqual([{ kind: "topic", name: "Testing the slope", documentId: "d" }]);
    expect(proposeFromChunks({ id: "d", title: "n" }, [{ ordinal: 0, kind: "text", heading: null, text: "Plain text with no structure." }], { termYear: null })).toEqual([]);
  });
});

describe("assessment guard", () => {
  it("blocks active assessments and sensitive pages", () => {
    expect(assessAssessment({ url: "https://lms.example.edu/courses/1/quizzes/7/take", text: "x" }).blocked).toBe(true);
    expect(assessAssessment({ url: "https://lms.example.edu/courses/1/grades", text: "x" }).blocked).toBe(true);
    expect(assessAssessment({ url: "https://lms.example.edu/courses/1/pages/a", text: "Question 3 of 20\nTime Remaining 12:44\nSubmit Quiz" }).blocked).toBe(true);
  });
  it("does not block ordinary course pages", () => {
    expect(assessAssessment({ url: "https://lms.example.edu/courses/1/pages/syllabus", text: "Exam 1 is on December 4. Submit quiz 2 by Friday." }).blocked).toBe(false);
    expect(assessAssessment({ url: null, text: "Regression notes about time remaining in a series." }).blocked).toBe(false);
  });
});

describe("calculator", () => {
  it("evaluates arithmetic with precedence and functions", () => {
    expect(evaluate("2+3*4")).toBe(14);
    expect(evaluate("(2+3)*4")).toBe(20);
    expect(evaluate("-2^2")).toBe(-4);
    expect(evaluate("2^3^2")).toBe(512);
    expect(evaluate("sqrt(16)+ln(e)+log(100)")).toBeCloseTo(7);
    expect(evaluate("39.863 + 2.479*20 - 2.998*10")).toBeCloseTo(59.463);
    expect(evaluate("1,000 × 5%")).toBe(50);
    expect(formatNumber(0.1 + 0.2)).toBe("0.3");
  });
  it("rejects anything else", () => {
    for (const bad of ["", "2+", "alert(1)", "1/0", "a.b", "2**3", "constructor", "(1"]) expect(() => evaluate(bad)).toThrow();
  });
});

describe("grading", () => {
  const num = { type: "numeric" as const, correctIndex: null, numericValue: "59.463", tolerance: "0.297" };
  it("accepts numeric answers inside the tolerance only", () => {
    expect(grade(num, { value: "59.46" })).toBe(true);
    expect(grade(num, { value: "$59.5" })).toBe(true);
    expect(grade(num, { value: "59.76" })).toBe(true);
    expect(grade(num, { value: "59.77" })).toBe(false);
    expect(grade(num, { value: "59" })).toBe(false);
    expect(grade(num, { value: "abc" })).toBe(false);
    expect(grade(num, {})).toBe(false);
  });
  it("grades multiple choice by index", () => {
    const mcq = { type: "mcq" as const, correctIndex: 2, numericValue: null, tolerance: null };
    expect(grade(mcq, { choice: 2 })).toBe(true);
    expect(grade(mcq, { choice: 0 })).toBe(false);
    expect(grade(mcq, { value: "2" })).toBe(false);
  });
  it("parses numeric input formats", () => {
    expect(parseNumericInput("1,234.5")).toBe(1234.5);
    expect(parseNumericInput(" −3.2 ")).toBe(-3.2);
    expect(parseNumericInput("12.5%")).toBe(12.5);
    expect(parseNumericInput("1e3")).toBe(1000);
    expect(parseNumericInput("1.2.3")).toBeNull();
    expect(parseNumericInput("12 units")).toBeNull();
  });
});

describe("mastery and adaptivity", () => {
  const now = new Date("2026-11-13T12:00:00Z");
  it("moves mastery toward outcomes and spaces reviews", () => {
    const a = nextMastery(null, true, false, now);
    expect(a.score).toBeCloseTo(0.58); expect(a.intervalDays).toBe(2); expect(a.streak).toBe(1);
    const b = nextMastery(a, true, false, now);
    expect(b.score).toBeGreaterThan(a.score); expect(b.intervalDays).toBe(4);
    const c = nextMastery(b, false, false, now);
    expect(c.score).toBeLessThan(b.score); expect(c.intervalDays).toBe(1); expect(c.streak).toBe(0);
    expect(c.nextReviewAt.getTime() - now.getTime()).toBe(86400_000);
    expect(nextMastery(null, true, true, now).score).toBeLessThan(a.score); // a hinted answer counts less
  });
  const pool: PoolQuestion[] = ["weak", "strong", "mid"].flatMap((t) => Array.from({ length: 40 }, (_, i) => ({ id: `${t}-${i}`, topicId: t, timesSeen: 0, lastAnsweredAt: null, lastCorrect: null })));
  const far = now.getTime() + 9e9;
  const topics = new Map<string, TopicState>([["weak", { score: 0.1, attempts: 6, nextReviewAt: far }], ["strong", { score: 0.95, attempts: 9, nextReviewAt: far }], ["mid", { score: 0.5, attempts: 5, nextReviewAt: far }]]);
  it("drill favors weak topics but keeps mixing in mastered ones", () => {
    const counts = { weak: 0, strong: 0, mid: 0 } as Record<string, number>;
    for (let seed = 1; seed <= 40; seed++) for (const id of pickQuestions(pool, topics, "drill", 12, mulberry32(seed), now.getTime())) counts[id.split("-")[0]]++;
    expect(counts.weak).toBeGreaterThan(counts.mid);
    expect(counts.mid).toBeGreaterThan(0);
    expect(counts.strong).toBeGreaterThanOrEqual(40 * 3); // every 4th slot
    expect(counts.weak).toBeGreaterThan(counts.strong);
  });
  it("never repeats a question and is deterministic per seed", () => {
    const a = pickQuestions(pool, topics, "drill", 30, mulberry32(5), now.getTime());
    expect(new Set(a).size).toBe(30);
    expect(pickQuestions(pool, topics, "drill", 30, mulberry32(5), now.getTime())).toEqual(a);
  });
  it("exam prefers unseen questions and spreads topics", () => {
    const seen = pool.map((q, i) => (i % 40 < 35 ? { ...q, timesSeen: 1, lastAnsweredAt: 1, lastCorrect: true } : q));
    const ids = pickQuestions(seen, topics, "exam", 15, mulberry32(1), now.getTime());
    expect(ids.every((id) => Number(id.split("-")[1]) >= 35)).toBe(true);
    expect(new Set(ids.map((i) => i.split("-")[0])).size).toBe(3);
    expect(pickQuestions(seen, topics, "exam", 20, mulberry32(1), now.getTime())).toHaveLength(20);
  });
  it("review returns missed questions first, then due topics, else nothing", () => {
    expect(pickQuestions(pool, topics, "review", 10, mulberry32(1), now.getTime())).toEqual([]);
    const p2 = pool.map((q) => (q.id === "strong-3" ? { ...q, timesSeen: 1, lastAnsweredAt: 5, lastCorrect: false } : q));
    const due = new Map(topics).set("mid", { score: 0.5, attempts: 5, nextReviewAt: now.getTime() - 1 });
    const ids = pickQuestions(p2, due, "review", 4, mulberry32(1), now.getTime());
    expect(ids[0]).toBe("strong-3");
    expect(ids.slice(1).every((i) => i.startsWith("mid-"))).toBe(true);
  });
  it("readiness is a cautious heuristic", () => {
    expect(readiness([{ score: null, attempts: 0 }]).value).toBeNull();
    const r = readiness([{ score: 1, attempts: 2 }, { score: null, attempts: 0 }]);
    expect(r.value).toBe(20); expect(r.enoughData).toBe(false);
    expect(readiness([{ score: 0.8, attempts: 10 }, { score: 0.6, attempts: 10 }])).toMatchObject({ value: 70, enoughData: true });
  });
});

describe("exam blueprint", () => {
  const sum = (m: Map<string, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  it("always allocates exactly the total, gives every topic at least one, and favours better-covered topics", () => {
    const topics = [{ id: "a", excerpts: 16 }, { id: "b", excerpts: 4 }, { id: "c", excerpts: 1 }, { id: "d", excerpts: 1 }];
    for (const total of [4, 7, 10, 20, 33, 50]) {
      const m = allocate(topics, total);
      expect(sum(m)).toBe(total);
      expect([...m.values()].every((n) => n >= 1)).toBe(true);
      expect(m.get("a")!).toBeGreaterThanOrEqual(m.get("b")!);
      expect(m.get("b")!).toBeGreaterThanOrEqual(m.get("c")!);
    }
    const m = allocate(topics, 20);
    expect(m.get("a")!).toBeLessThan(12); // damped: one long document does not take everything
    expect(m.get("c")).toBe(m.get("d"));
  });
  it("handles fewer questions than topics, equal coverage and empty input", () => {
    const few = allocate([{ id: "a", excerpts: 9 }, { id: "b", excerpts: 1 }, { id: "c", excerpts: 4 }], 2);
    expect(Object.fromEntries(few)).toEqual({ a: 1, b: 0, c: 1 });
    expect(Object.fromEntries(allocate([{ id: "a", excerpts: 3 }, { id: "b", excerpts: 3 }, { id: "c", excerpts: 3 }], 10))).toEqual({ a: 4, b: 3, c: 3 });
    expect(allocate([], 10).size).toBe(0);
    expect(sum(allocate([{ id: "a", excerpts: 1 }], 0))).toBe(0);
  });
  it("builds an exam to the quota, unseen first, and tops up when a topic's bank is short", () => {
    const q = (id: string, topicId: string, seen = false): PoolQuestion => ({ id, topicId, timesSeen: seen ? 1 : 0, lastAnsweredAt: seen ? 1 : null, lastCorrect: seen ? true : null });
    const pool = [q("a1", "a", true), q("a2", "a"), q("a3", "a"), q("b1", "b"), q("c1", "c"), q("c2", "c"), q("c3", "c")];
    const ids = pickByQuota(pool, new Map([["a", 2], ["b", 3], ["c", 1]]), 6, mulberry32(3));
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(ids).toEqual(expect.arrayContaining(["a2", "a3", "b1"])); // unseen a's, and all of b that exists
    expect(ids).not.toContain("a1"); // the seen question is the last resort
    expect(ids.filter((i) => i.startsWith("c"))).toHaveLength(3); // b was short by 2 → topped up from c
    expect(pickByQuota(pool, new Map([["a", 1]]), 3, mulberry32(1))).toHaveLength(3);
    expect(pickByQuota(pool, new Map(), 50, mulberry32(1))).toHaveLength(7);
  });
});

describe("study plan", () => {
  const topic = (id: string, o: Partial<PlanTopic> = {}): PlanTopic => ({ id, name: `Topic ${id}`, mastery: null, attempts: 0, hasSources: true, questionCount: 5, introduced: false, reviewDue: false, ...o });
  const base = { today: "2026-11-13", minutesPerDay: 40, mode: "practice-first" as const, examFormatConfirmed: true };
  const topics = ["a", "b", "c", "d", "e", "f"].map((id) => topic(id));
  it("fits inside the dates and daily minutes, with spaced reviews, a mock exam and a wrap-up", () => {
    const { sessions, warnings } = buildSchedule({ ...base, examDate: "2026-12-04", topics });
    expect(warnings).toEqual([]);
    expect(sessions.every((s) => s.date >= "2026-11-13" && s.date < "2026-12-04")).toBe(true);
    const perDay = new Map<string, number>();
    sessions.forEach((s) => perDay.set(s.date, (perDay.get(s.date) ?? 0) + s.minutes));
    expect([...perDay.values()].every((m) => m <= 40)).toBe(true);
    const learned = sessions.filter((s) => s.kind === "learn").flatMap((s) => s.topicIds);
    expect(learned.sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(sessions.filter((s) => s.kind === "mock").map((s) => s.date)).toEqual(["2026-12-02"]);
    expect(sessions.at(-1)).toMatchObject({ kind: "wrap", date: "2026-12-03" });
    for (const id of ["a", "b"]) {
      const intro = sessions.find((s) => s.kind === "learn" && s.topicIds.includes(id))!.date;
      const reviews = sessions.filter((s) => (s.kind === "review" || s.kind === "mixed") && s.topicIds.includes(id)).map((s) => s.date);
      expect(reviews.length).toBeGreaterThanOrEqual(3);
      expect(reviews[0] >= addDays(intro, 2)).toBe(true);
    }
  });
  it("gives weaker topics more time and respects self-assessment until there is data", () => {
    const { sessions } = buildSchedule({ ...base, minutesPerDay: 120, examDate: "2026-12-04", topics: [topic("weak", { strength: 1 }), topic("strong", { strength: 5 })] });
    const mins = (id: string) => sessions.find((s) => s.kind === "learn" && s.topicIds.includes(id))!.minutes;
    expect(mins("weak")).toBeGreaterThan(mins("strong"));
  });
  it("warns instead of overpromising", () => {
    const many = Array.from({ length: 12 }, (_, i) => topic(`t${i}`));
    const tight = buildSchedule({ ...base, minutesPerDay: 15, examDate: "2026-11-17", topics: many });
    expect(tight.warnings.join(" ")).toMatch(/not enough time/i);
    const perDay = new Map<string, number>();
    tight.sessions.forEach((s) => perDay.set(s.date, (perDay.get(s.date) ?? 0) + s.minutes));
    expect([...perDay.values()].every((m) => m <= 15)).toBe(true);
    expect(buildSchedule({ ...base, examDate: "2026-12-04", topics, examFormatConfirmed: false }).warnings.join(" ")).toMatch(/format .* not confirmed/i);
  });
  it("reports missing material and never plans from nothing", () => {
    const none = buildSchedule({ ...base, examDate: "2026-12-04", topics: [topic("a", { hasSources: false })] });
    expect(none.sessions).toEqual([]);
    expect(none.warnings.join(" ")).toMatch(/no imported material/i);
    const partial = buildSchedule({ ...base, examDate: "2026-12-04", topics: [topic("a"), topic("b", { hasSources: false, name: "Forecasting" })] });
    expect(partial.sessions.flatMap((s) => s.topicIds)).not.toContain("b");
    expect(partial.warnings[0]).toContain("Forecasting");
    expect(buildSchedule({ ...base, examDate: "2026-12-04", topics: [] }).sessions).toEqual([]);
  });
  it("handles past, same-day and next-day exams", () => {
    expect(buildSchedule({ ...base, examDate: "2026-11-01", topics }).warnings[0]).toMatch(/past/);
    expect(buildSchedule({ ...base, examDate: "2026-11-13", topics }).sessions).toEqual([]);
    const one = buildSchedule({ ...base, examDate: "2026-11-14", topics });
    expect(one.sessions).toHaveLength(1);
    expect(one.sessions[0]).toMatchObject({ date: "2026-11-13", kind: "mixed", minutes: 40 });
  });
  it("skips first exposure for practised topics and reviews them soon", () => {
    const { sessions } = buildSchedule({ ...base, examDate: "2026-12-04", topics: [topic("a", { introduced: true, attempts: 6, mastery: 0.3 }), topic("b")] });
    expect(sessions.filter((s) => s.kind === "learn").flatMap((s) => s.topicIds)).toEqual(["b"]);
    expect(sessions.find((s) => s.topicIds.includes("a"))!.date).toBe("2026-11-13");
  });
});

describe("log redaction and search query building", () => {
  it("removes secrets and content-bearing fields", () => {
    const out = JSON.stringify(redact({ apiKey: "sk-abcdefghijklmnop", note: "Bearer abcdefghijklmnop123", text: "private course notes", nested: { password: "x", count: 3 }, msg: "used sk-12345678901234567890" }));
    expect(out).not.toMatch(/abcdefghijklmnop|private course notes|12345678901234567890/);
    expect(out).toContain('"count":3');
  });
  it("builds safe tsqueries", () => {
    expect(toOrQuery("Interpreting the slope & intercept!")).toBe("interpreting | slope | intercept");
    expect(toOrQuery("a:* | ') drop table")).toBe("drop | table");
    expect(toOrQuery("!!! ??")).toBeNull();
  });
});
