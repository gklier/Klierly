import { describe, expect, it } from "vitest";
import { afterPractice, applyAnswer, gradeNumeric, isDone, mastery, nextHintLevel, revisitChoice, type ConceptState, type MissEntry } from "@/lib/learn/engine";
import { hashStr, makeRng } from "@/lib/learn/rng";

const fresh = (): ConceptState => ({ status: "learning", log: [], baseIndex: 0 });
const cur = (over = {}) => ({ conceptId: "c", phase: "practice" as const, i: 0, round: 0, pcount: 0, check: false, checkLog: [], qs: null, ...over });
const answer = (st: ConceptState, miss: MissEntry[], ok: boolean, hinted = false, review = false, n = 1) =>
  applyAnswer(st, miss, { key: `k${n}${ok}${hinted}`, conceptId: "c", ok, hinted, review, answerCount: n });

describe("mastery rules", () => {
  it("needs 4 of the last 5 correct WITHOUT hints; hinted answers count half", () => {
    let st = fresh(), miss: MissEntry[] = [];
    for (const [ok, hinted] of [[true, false], [true, false], [true, true], [true, true], [true, false]] as const) { ({ st, miss } = answer(st, miss, ok, hinted)); }
    expect(st.log).toEqual([1, 1, 0.5, 0.5, 1]);
    expect(afterPractice(st, cur()).st.status).toBe("learning"); // 4.0 summed, but only 3 unaided: hints never stand in for mastery
    for (let i = 0; i < 2; i++) ({ st, miss } = answer(st, miss, true, false, false, i + 10));
    expect(afterPractice(st, cur()).st.status).toBe("learning"); // last five: .5 .5 1 1 1 = 3 unaided
    ({ st, miss } = answer(st, miss, true, false, false, 20));
    expect(afterPractice(st, cur()).st.status).toBe("practiced"); // last five: .5 1 1 1 1 = 4 unaided
  });
  it("a lucky streak after a miss does not count; only the last five matter", () => {
    let st = fresh(), miss: MissEntry[] = [];
    for (const ok of [false, true, true, true, true]) ({ st, miss } = answer(st, miss, ok));
    expect(afterPractice(st, cur()).st.status).toBe("practiced"); // 4 of the last 5
    let bad = fresh(); for (const ok of [true, true, false, false, true]) ({ st: bad, miss } = answer(bad, [], ok));
    expect(afterPractice(bad, cur()).st.status).toBe("learning");
  });
  it("is solid only after a later revisit is answered correctly and unaided", () => {
    const practiced: ConceptState = { status: "practiced", log: [1, 1, 1, 1, 1], baseIndex: 0 };
    expect(answer(practiced, [], true, false, false).st.status).toBe("practiced"); // same-session success is not enough
    expect(answer(practiced, [], true, true, true).st.status).toBe("practiced"); // a hinted revisit is not enough
    expect(answer(practiced, [], false, false, true).st.status).toBe("learning"); // a missed revisit sends it back
    expect(answer(practiced, [], true, false, true).st.status).toBe("solid");
    expect(mastery({ status: "solid", log: [], baseIndex: 0 })).toBe(1);
    expect(isDone("solid") && isDone("practiced") && !isDone("learning")).toBe(true);
  });
  it("misses re-queue after at least 3 other questions and leave the queue when answered", () => {
    let st = fresh(), miss: MissEntry[] = [];
    ({ st, miss } = applyAnswer(st, miss, { key: "q1", conceptId: "c", ok: false, hinted: false, review: false, answerCount: 5 }));
    expect(miss).toEqual([{ key: "q1", conceptId: "c", after: 8 }]);
    ({ miss } = applyAnswer(st, miss, { key: "q1", conceptId: "c", ok: true, hinted: false, review: true, answerCount: 9 }));
    expect(miss).toEqual([]);
  });
  it("asks for re-teaching after 8 attempts without mastery", () => {
    const st: ConceptState = { status: "learning", log: [0, 1, 0, 1, 0, 1, 0, 0], baseIndex: 0 };
    expect(afterPractice(st, cur()).reteach).toBe(true);
  });
  it("the 4-question check passes at 3 of 4 and fails otherwise", () => {
    const st = fresh();
    expect(afterPractice(st, cur({ check: true, checkLog: [1, 1, 0, 1] })).st.status).toBe("practiced");
    expect(afterPractice(st, cur({ check: true, checkLog: [1, 0, 0, 1] })).checkFailed).toBe(true);
    expect(afterPractice(st, cur({ check: true, checkLog: [1, 1] })).checkFailed).toBe(false);
  });
});

describe("mixing, hints and grading", () => {
  it("every third practice question is a revisit: due miss first, else the weakest concept, else its own", () => {
    const miss: MissEntry[] = [{ key: "m", conceptId: "other", after: 4 }];
    const o = { check: false, currentConceptId: "c", miss, answered: 10, weakest: { key: "w" } };
    expect(revisitChoice({ ...o, practiceCount: 1 })).toEqual({ kind: "own" });
    expect(revisitChoice({ ...o, practiceCount: 3 })).toEqual({ kind: "miss", key: "m" });
    expect(revisitChoice({ ...o, practiceCount: 3, answered: 2 })).toEqual({ kind: "weak" }); // miss not due yet
    expect(revisitChoice({ ...o, practiceCount: 6, miss: [], weakest: null })).toEqual({ kind: "own" });
    expect(revisitChoice({ ...o, practiceCount: 3, check: true })).toEqual({ kind: "own" });
  });
  it("the hint ladder has three levels", () => {
    expect([0, 1, 2, 3, 4].map(nextHintLevel)).toEqual([1, 2, 3, 3, 3]);
  });
  it("grades numbers with tolerance and names the matching trap", () => {
    const traps = [{ value: 12.5, message: "You swapped the weights." }];
    expect(gradeNumeric("$1,234.5", 1234.5, 0.02, [])).toEqual({ ok: true });
    expect(gradeNumeric("12.50", 20, 0.02, traps)).toEqual({ ok: false, trap: "You swapped the weights." });
    expect(gradeNumeric("13", 20, 0.02, traps)).toEqual({ ok: false, trap: null });
    expect(gradeNumeric("abc", 20, 0.02, traps)).toMatchObject({ ok: false, bad: true });
  });
  it("randomness is deterministic by seed", () => {
    const a = makeRng(7), b = makeRng(7), c = makeRng(8);
    const seq = (r: ReturnType<typeof makeRng>) => [r.int(1, 1000), r.int(1, 1000), r.int(1, 1000)];
    expect(seq(a)).toEqual(seq(b));
    expect(seq(makeRng(7))).not.toEqual(seq(c));
    expect(hashStr("abc")).toBe(hashStr("abc"));
    expect(makeRng(3).shuffle([1, 2, 3, 4, 5])).toEqual(makeRng(3).shuffle([1, 2, 3, 4, 5]));
  });
});
