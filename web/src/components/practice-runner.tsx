"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { answerQuestion, finishPractice, reportQuestionAction, revealHint, tagErrorAction } from "@/app/actions/practice";
import { evaluate, formatNumber } from "@/lib/calc";
import { REASONS } from "@/lib/practice/reasons";
import type { Feedback, PublicQuestion, SessionView } from "@/lib/practice/service";
import { CitationList } from "./citations";
import { Icon } from "./icons";


const LETTERS = ["A", "B", "C", "D"];
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.max(0, sec) % 60).padStart(2, "0")}`;

export function ErrorTagger({ answerId, initial }: { answerId: string; initial: string | null }) {
  const [value, setValue] = useState(initial);
  const [failed, setFailed] = useState(false);
  const pick = async (id: string) => {
    const prev = value;
    setValue(id); setFailed(false);
    if (!(await tagErrorAction(answerId, id))) { setValue(prev); setFailed(true); }
  };
  return (
    <fieldset>
      <legend className="text-sm font-semibold">What went wrong?</legend>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        {REASONS.map((r) => (
          <button key={r.id} type="button" title={r.help} aria-pressed={value === r.id} onClick={() => pick(r.id)}
            className={`btn btn-sm ${value === r.id ? "!border-accent !bg-accent-soft !text-accent" : ""}`}>{r.label}</button>
        ))}
      </div>
      {failed && <p role="alert" className="mt-1 text-sm text-bad">Could not save that. Try again.</p>}
    </fieldset>
  );
}

export function ReportButton({ questionId }: { questionId: string }) {
  const [state, setState] = useState<"idle" | "open" | "sent" | "error">("idle");
  const [reason, setReason] = useState("");
  if (state === "sent") return <p className="text-sm text-muted">Reported. This question will not be shown again.</p>;
  if (state === "idle") return <button type="button" className="btn btn-quiet btn-sm text-muted" onClick={() => setState("open")}><Icon name="flag" />Report a bad question</button>;
  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => { e.preventDefault(); setState((await reportQuestionAction(questionId, reason)) ? "sent" : "error"); }}>
      <div className="min-w-52 flex-1">
        <label className="label" htmlFor={`rep-${questionId}`}>What is wrong with it?</label>
        <input id={`rep-${questionId}`} className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="Wrong answer, ambiguous, not from my course…" autoFocus />
      </div>
      <button className="btn btn-sm" type="submit">Send report</button>
      <button className="btn btn-quiet btn-sm" type="button" onClick={() => setState("idle")}>Cancel</button>
      {state === "error" && <p role="alert" className="w-full text-sm text-bad">Could not send the report. Try again.</p>}
    </form>
  );
}

export function QuestionLabels({ f }: { f: Pick<Feedback, "origin" | "grounding" | "correctnessConfidence" | "explanationConfidence"> }) {
  return (
    <p className="flex flex-wrap gap-1.5">
      <span className="badge">{f.origin === "ai" ? "AI-generated" : "Written for the sample course"}</span>
      {f.correctnessConfidence === "verified-numeric" && <span className="badge badge-good" title="The answer was recomputed by a tested calculation routine">Answer verified by calculation</span>}
      {f.correctnessConfidence === "model-asserted" && <span className="badge badge-warn" title="The answer key comes from the AI and was not independently verified">Answer not independently verified</span>}
      {f.explanationConfidence === "source-linked" && <span className="badge badge-warn" title="Linked to a source excerpt, but no exact quote was found">Quote not verified</span>}
      {f.grounding === "extrapolated" && <span className="badge badge-warn" title="Goes beyond what your materials state directly">Goes beyond your materials</span>}
    </p>
  );
}

function Calculator() {
  const [expr, setExpr] = useState("");
  const [history, setHistory] = useState<{ expr: string; result: string }[]>([]);
  const [error, setError] = useState("");
  const [notes, setNotes] = useState("");
  const run = () => {
    try { const result = formatNumber(evaluate(expr)); setHistory((h) => [{ expr, result }, ...h].slice(0, 8)); setExpr(result); setError(""); }
    catch { setError("Check the expression. Use + − × ÷ ^ ( ) and sqrt, ln, log, exp."); }
  };
  return (
    <aside className="panel p-4" aria-label="Calculator and scratchpad">
      <h2 className="text-sm font-semibold">Calculator</h2>
      <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); run(); }}>
        <label className="sr-only" htmlFor="calc-in">Expression</label>
        <input id="calc-in" data-calc className="input tnum" value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="39.863 + 2.479*20" autoComplete="off" spellCheck={false} />
        <button className="btn" type="submit" aria-label="Calculate">=</button>
      </form>
      {error && <p role="alert" className="mt-1 text-xs text-bad">{error}</p>}
      <ul className="mt-2 space-y-1 text-sm" aria-live="polite">
        {history.map((h, i) => <li key={i} className="tnum flex justify-between gap-3"><span className="truncate text-muted">{h.expr}</span><span className="font-semibold">{h.result}</span></li>)}
      </ul>
      <label className="label mt-4" htmlFor="scratch">Scratchpad <span className="font-normal text-muted">(not saved)</span></label>
      <textarea id="scratch" data-calc className="input font-serif" rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} />
    </aside>
  );
}

export function PracticeRunner({ view, courseName }: { view: SessionView; courseName: string }) {
  const router = useRouter();
  const exam = view.mode === "exam";
  const total = view.questions.length;
  const firstOpen = Math.max(0, view.questions.findIndex((q) => !view.answers[q.id]));
  const [index, setIndex] = useState(exam ? 0 : firstOpen === -1 ? 0 : firstOpen);
  const [responses, setResponses] = useState<Record<string, { choice?: number; value?: string }>>(() => Object.fromEntries(Object.entries(view.answers).map(([id, a]) => [id, a.response])));
  const [feedback, setFeedback] = useState<Record<string, Feedback>>(() => Object.fromEntries(Object.entries(view.answers).filter(([, a]) => a.feedback).map(([id, a]) => [id, a.feedback!])));
  const [saved, setSaved] = useState<Set<string>>(() => new Set(Object.keys(view.answers)));
  const [hints, setHints] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showCalc, setShowCalc] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const shownAt = useRef(Date.now());
  const finishing = useRef(false);
  const q: PublicQuestion = view.questions[index];
  const response = useMemo(() => responses[q.id] ?? {}, [responses, q.id]);
  const fb = feedback[q.id];
  const answeredCount = exam ? Object.values(responses).filter((r) => r.choice !== undefined || r.value?.trim()).length : Object.keys(feedback).length;
  const hasResponse = response.choice !== undefined || Boolean(response.value?.trim());

  useEffect(() => { shownAt.current = Date.now(); setError(""); }, [index]);

  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true; setBusy(true);
    await finishPractice(view.id);
    router.refresh();
  }, [view.id, router]);

  /** Exam: persist the current response (ungraded) and the time spent on this visit. */
  const saveExam = useCallback(async (question: PublicQuestion) => {
    const r = responses[question.id];
    if (!r || (r.choice === undefined && !r.value?.trim())) return true;
    const res = await answerQuestion(view.id, question.id, r, Date.now() - shownAt.current, false);
    shownAt.current = Date.now();
    if (!res.ok) { setError(res.message); return false; }
    setSaved((s) => new Set(s).add(question.id));
    return true;
  }, [responses, view.id]);

  useEffect(() => {
    if (!exam || view.timeLimitSec === null) return;
    const end = new Date(view.startedAt).getTime() + view.timeLimitSec * 1000;
    const tick = () => {
      const left = Math.ceil((end - Date.now()) / 1000);
      setRemaining(left);
      if (left <= 0) void saveExam(view.questions[index]).then(finish);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [exam, view.timeLimitSec, view.startedAt, view.questions, index, saveExam, finish]);

  const goto = useCallback(async (next: number) => {
    if (next < 0 || next >= total || busy) return;
    if (exam) { setBusy(true); await saveExam(q); setBusy(false); }
    setIndex(next);
  }, [total, busy, exam, saveExam, q]);

  const check = useCallback(async () => {
    if (!hasResponse || busy || fb) return;
    setBusy(true); setError("");
    const res = await answerQuestion(view.id, q.id, response, Date.now() - shownAt.current, Boolean(hints[q.id]));
    setBusy(false);
    if (!res.ok) { setError(res.message); return; }
    if (res.feedback) setFeedback((f) => ({ ...f, [q.id]: res.feedback! }));
  }, [hasResponse, busy, fb, view.id, q.id, response, hints]);

  const showHint = useCallback(async () => {
    if (exam || hints[q.id] || fb) return;
    const h = await revealHint(view.id, q.id);
    setHints((m) => ({ ...m, [q.id]: h ?? "No hint is available for this question." }));
  }, [exam, hints, q.id, fb, view.id]);

  const choose = useCallback((i: number) => { if (!fb) setResponses((r) => ({ ...r, [q.id]: { choice: i } })); }, [fb, q.id]);
  const last = index === total - 1;
  const primary = useCallback(() => {
    if (exam) { if (last) setConfirming(true); else void goto(index + 1); return; }
    if (!fb) void check();
    else if (last) void finish();
    else setIndex(index + 1);
  }, [exam, last, goto, index, fb, check, finish]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("[data-calc]") || el.closest("dialog") || e.metaKey || e.ctrlKey || e.altKey) return;
      const typing = el.tagName === "INPUT" || el.tagName === "TEXTAREA";
      if (e.key === "Enter" && el.tagName !== "BUTTON" && el.tagName !== "A") { e.preventDefault(); primary(); return; }
      if (typing) return;
      if (q.type === "mcq" && q.choices) {
        const n = "1234".indexOf(e.key) >= 0 ? Number(e.key) - 1 : "abcd".indexOf(e.key.toLowerCase());
        if (n >= 0 && n < q.choices.length) { choose(n); return; }
      }
      if (e.key.toLowerCase() === "h") void showHint();
      if (e.key.toLowerCase() === "c") setShowCalc((v) => !v);
      if (exam && e.key === "ArrowRight") void goto(index + 1);
      if (exam && e.key === "ArrowLeft") void goto(index - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [primary, q, choose, showHint, exam, goto, index]);

  const unanswered = total - answeredCount;
  const modeLabel = useMemo(() => ({ drill: "Drill", exam: "Timed mock exam", review: "Review mistakes" })[view.mode], [view.mode]);

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-bg" data-testid="practice-runner">
      <header className="sticky top-0 z-10 border-b border-line backdrop-blur-md" style={{ background: "var(--nav)" }}>
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{modeLabel}</p>
            <p className="truncate text-xs text-muted">{courseName}</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {exam && remaining !== null && (
              <span role="timer" aria-label="Time remaining" className={`tnum flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm font-semibold ${remaining <= 60 ? "bg-bad-soft text-bad" : "bg-surface-2"}`}><Icon name="clock" />{clock(remaining)}</span>
            )}
            <span className="tnum text-sm text-muted" aria-label={`${answeredCount} of ${total} answered`}>{answeredCount}/{total}</span>
            <button type="button" className="btn btn-sm" aria-pressed={showCalc} onClick={() => setShowCalc((v) => !v)}><Icon name="calc" /><span className="hidden sm:inline">Calculator</span></button>
            {exam
              ? <button type="button" className="btn btn-sm btn-primary" onClick={() => setConfirming(true)}>Submit exam</button>
              : <Link href={`/courses/${view.courseId}/practice`} className="btn btn-sm" title="Your answers so far are saved">Exit</Link>}
          </div>
        </div>
        <div className="h-0.5 bg-surface-2" aria-hidden="true"><div className="h-full bg-accent transition-[width] duration-300" style={{ width: `${(answeredCount / total) * 100}%` }} /></div>
      </header>

      <div className={`mx-auto grid max-w-5xl gap-6 px-4 py-7 ${showCalc ? "lg:grid-cols-[minmax(0,1fr)_18rem]" : ""}`}>
        <div className="mx-auto w-full max-w-2xl">
          {exam && (
            <nav aria-label="Questions" className="mb-5 flex flex-wrap gap-1.5">
              {view.questions.map((x, i) => {
                const r = responses[x.id];
                const done = r && (r.choice !== undefined || r.value?.trim());
                return (
                  <button key={x.id} type="button" onClick={() => goto(i)} aria-current={i === index ? "step" : undefined} aria-label={`Question ${i + 1}${done ? ", answered" : ", not answered"}`}
                    className={`tnum size-8 rounded-md border text-sm font-medium ${i === index ? "border-accent bg-accent text-accent-ink" : done ? "border-line bg-surface-2" : "border-line bg-surface text-muted"}`}>{i + 1}</button>
                );
              })}
            </nav>
          )}

          <p className="text-sm text-muted">Question {index + 1} of {total}{q.topicName ? ` · ${q.topicName}` : ""}</p>
          <h1 className="reading mt-2 whitespace-pre-wrap" data-testid="stem">{q.stem}</h1>

          {q.type === "mcq" && q.choices ? (
            <div role="radiogroup" aria-label="Answer choices" className="mt-5 space-y-2.5">
              {q.choices.map((c, i) => {
                const selected = response.choice === i;
                const isRight = fb && fb.correctIndex === i;
                const isWrongPick = fb && selected && !isRight;
                return (
                  <button key={i} type="button" role="radio" aria-checked={selected} disabled={Boolean(fb)} onClick={() => choose(i)} data-testid={`choice-${i}`}
                    className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-default ${
                      isRight ? "border-good bg-good-soft" : isWrongPick ? "border-bad bg-bad-soft" : selected ? "border-accent bg-accent-soft" : "border-line bg-surface hover:border-muted"}`}>
                    <span className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md border text-xs font-semibold ${selected && !fb ? "border-accent bg-accent text-accent-ink" : "border-line"}`}>{LETTERS[i]}</span>
                    <span className="font-serif text-[1.05rem] leading-snug">{c}</span>
                    {isRight && <span className="ml-auto flex shrink-0 items-center gap-1 text-sm font-semibold text-good"><Icon name="check" />Correct answer</span>}
                    {isWrongPick && <span className="ml-auto flex shrink-0 items-center gap-1 text-sm font-semibold text-bad"><Icon name="x" />Your answer</span>}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="mt-5 max-w-xs">
              <label className="label" htmlFor="num-answer">Your answer{q.unit ? ` (${q.unit})` : ""}</label>
              <input id="num-answer" data-testid="numeric-input" className="input tnum text-lg" inputMode="decimal" autoComplete="off" value={response.value ?? ""} disabled={Boolean(fb)}
                onChange={(e) => setResponses((r) => ({ ...r, [q.id]: { value: e.target.value } }))} placeholder="Enter a number" autoFocus />
              <p className="help">Small rounding differences are accepted.</p>
            </div>
          )}

          {!exam && hints[q.id] && <p className="notice mt-4"><strong>Hint.</strong> {hints[q.id]}</p>}
          {error && <p role="alert" className="notice notice-bad mt-4">{error}</p>}

          {fb && (
            <section className={`mt-5 rounded-xl border p-4 ${fb.isCorrect ? "border-good bg-good-soft" : "border-bad bg-bad-soft"}`} aria-live="polite" data-testid="feedback">
              <h2 className={`flex items-center gap-2 text-base font-semibold ${fb.isCorrect ? "text-good" : "text-bad"}`}><Icon name={fb.isCorrect ? "check" : "x"} size={18} />{fb.isCorrect ? "Correct" : "Not quite"}</h2>
              {q.type === "numeric" && <p className="mt-1 text-sm">Correct answer: <strong className="tnum">{fb.correctValue}</strong>{fb.unit ? ` ${fb.unit}` : ""}</p>}
              <p className="mt-2 font-serif text-[1.02rem] leading-relaxed">{fb.explanation}</p>
            </section>
          )}
          {fb && (
            <div className="mt-4 space-y-4">
              {!fb.isCorrect && <ErrorTagger answerId={fb.answerId} initial={fb.errorReason} />}
              <div><h3 className="mb-1.5 text-sm font-semibold">From your materials</h3><CitationList citations={fb.citations} courseId={view.courseId} newTab /></div>
              <QuestionLabels f={fb} />
              <ReportButton questionId={q.id} />
            </div>
          )}

          <div className="mt-7 flex flex-wrap items-center gap-2">
            {exam && <button type="button" className="btn" onClick={() => goto(index - 1)} disabled={index === 0 || busy}><Icon name="back" />Previous</button>}
            <button type="button" className="btn btn-primary" onClick={primary} disabled={busy || (!exam && !fb && !hasResponse)} data-testid="primary">
              {busy && <span className="spinner" />}
              {exam ? (last ? "Review and submit" : "Next") : !fb ? "Check answer" : last ? "Finish session" : "Next question"}
              {!busy && (exam || fb) && !last && <Icon name="arrow" />}
            </button>
            {!exam && !fb && q.hasHint && !hints[q.id] && <button type="button" className="btn btn-quiet" onClick={showHint}>Show a hint</button>}
            {exam && saved.has(q.id) && <span className="text-sm text-muted">Answer saved</span>}
          </div>
          <p className="mt-6 hidden text-xs text-muted sm:block">
            Keys: {q.type === "mcq" && <><span className="kbd">A</span>–<span className="kbd">D</span> choose · </>}<span className="kbd">Enter</span> {exam ? "next" : "check / next"}{!exam && <> · <span className="kbd">H</span> hint</>} · <span className="kbd">C</span> calculator{exam && <> · <span className="kbd">←</span> <span className="kbd">→</span> move</>}
          </p>
          {exam && <p className="mt-2 text-xs text-muted">Answers and explanations are shown only after you submit.</p>}
        </div>
        {showCalc && <Calculator />}
      </div>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="submit-h">
          <div className="panel w-full max-w-sm p-5">
            <h2 id="submit-h" className="text-base font-semibold">Submit the exam?</h2>
            <p className="mt-2 text-sm text-muted">{unanswered > 0 ? `${unanswered} ${unanswered === 1 ? "question is" : "questions are"} unanswered and will be marked incorrect. ` : "All questions are answered. "}You cannot change answers after submitting.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy}>Keep working</button>
              <button type="button" className="btn btn-primary" data-testid="confirm-submit" disabled={busy} onClick={async () => { setBusy(true); await saveExam(q); await finish(); }}>{busy && <span className="spinner" />}Submit exam</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
