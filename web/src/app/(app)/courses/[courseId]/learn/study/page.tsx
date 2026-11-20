import Link from "next/link";
import { redirect } from "next/navigation";
import { advanceAction, answerAction, hintAction, reportQuestionAction } from "@/app/actions/learn";
import { ActionForm, Submit } from "@/components/forms";
import { requireUser } from "@/lib/auth";
import { getCourse } from "@/lib/courses";
import { studyView } from "@/lib/learn/service";

export const metadata = { title: "Study" };
const PHASES = [["learn", "Learn"], ["worked", "Example"], ["guided", "Guided"], ["practice", "Practice"]] as const;
const H = ({ html }: { html: string }) => <span dangerouslySetInnerHTML={{ __html: html }} />; // every string rendered here was sanitised to an allowlist when it was stored

export default async function StudyPage({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await requireUser();
  const course = await getCourse(user.id, (await params).courseId);
  const v = await studyView(user.id, course.id);
  if (!v) redirect(`/courses/${course.id}/learn`);
  const hidden = <><input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="token" value={v.token} /></>;
  const Next = ({ label = "Next", primary = true }: { label?: string; primary?: boolean }) => (
    <ActionForm action={advanceAction}>{hidden}<Submit className={primary ? "btn btn-primary btn-lg" : "btn btn-lg"} pendingText="…">{label}</Submit></ActionForm>
  );
  const q = v.question;
  const phaseIdx = PHASES.findIndex(([k]) => k === v.phase);

  return (
    <article className="mx-auto max-w-2xl space-y-5">
      <header className="space-y-2">
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted"><Link className="link" href={`/courses/${course.id}/learn`}>All concepts</Link><span>·</span><span className="tnum">Concept {v.concept.index + 1} of {v.concept.total}</span><span className={`badge ${v.status === "practiced" || v.status === "solid" ? "badge-good" : ""}`}>{v.status}</span></p>
        <h1 className="text-2xl font-semibold" data-testid="concept-title">{v.concept.title}</h1>
        {v.phase !== "done" && <ol className="flex gap-1.5" aria-label="Steps in this concept">{PHASES.map(([k, label], i) => <li key={k} aria-current={k === v.phase ? "step" : undefined} className={`rounded-full px-3 py-1 text-xs font-medium ${i === phaseIdx ? "bg-accent-soft text-accent" : i < phaseIdx ? "text-ink" : "text-muted"}`}>{label}</li>)}</ol>}
      </header>

      {v.phase === "learn" && (
        <section className="panel space-y-4 p-6" aria-live="polite" data-testid="lesson-card">
          {v.i === 0 && <p className="text-muted">{v.concept.why}</p>}
          <h2 className="text-lg font-semibold">{v.concept.cards[v.i]?.heading}</h2>
          <div className="text-[1.05rem] leading-relaxed"><H html={v.concept.cards[v.i]?.bodyHtml ?? ""} /></div>
          {v.i === v.concept.cards.length - 1 && v.concept.formulas.length > 0 && <ul className="rounded-lg bg-surface-2 p-3 text-sm">{v.concept.formulas.map((f) => <li key={f.name}><b>{f.name}:</b> {f.text}</li>)}</ul>}
          <details className="text-sm"><summary className="cursor-pointer text-muted">Explain it a different way</summary><p className="mt-2">{v.concept.alt}</p></details>
          <div className="flex items-center justify-between"><span className="tnum text-sm text-muted">Card {v.i + 1} of {v.concept.cards.length}</span><Next /></div>
        </section>
      )}

      {v.phase === "worked" && v.worked && (
        <section className="panel space-y-4 p-6" data-testid="worked-example">
          <h2 className="text-lg font-semibold">Worked example</h2>
          <p className="text-[1.05rem]"><H html={v.worked.stem} /></p>
          <ol className="space-y-2">{v.worked.steps.map((s, i) => <li key={i} className="rounded-lg bg-surface-2 p-3"><span className="tnum mr-2 text-xs text-muted">Step {i + 1}</span><H html={s} /></li>)}</ol>
          <Next label="Next step" />
        </section>
      )}

      {(v.phase === "guided" || v.phase === "practice") && q && (
        <section className="panel space-y-4 p-6" data-testid="question">
          <p className="flex items-center gap-2 text-xs text-muted">{v.phase === "guided" ? `Guided practice, round ${v.round + 1} of 3` : "Practice"}{q.review && <span className="badge badge-accent">Revisit</span>}</p>
          <p className="text-[1.05rem] leading-relaxed"><H html={q.stemHtml} /></p>
          {q.scaffold.length > 0 && <ol className="space-y-2 text-sm">{q.scaffold.map((s, i) => <li key={i} className="rounded-lg bg-surface-2 p-3"><span className="tnum mr-2 text-xs text-muted">Step {i + 1}</span><H html={s} /></li>)}</ol>}
          {q.hintTexts.length > 0 && <ul className="notice space-y-1 text-sm" data-testid="hints">{q.hintTexts.map((h, i) => <li key={i}><H html={h} /></li>)}</ul>}

          {!q.answered && q.kind === "num" && (
            <ActionForm action={answerAction} className="flex flex-wrap items-center gap-3">
              {hidden}<label className="sr-only" htmlFor="resp">Your answer</label>
              <input id="resp" name="resp" inputMode="decimal" autoComplete="off" autoFocus className="input w-44 text-lg" placeholder="Your answer" required />
              <Submit className="btn btn-primary btn-lg" pendingText="Checking…">Check</Submit>
            </ActionForm>
          )}
          {!q.answered && q.kind === "mcq" && q.choices && (
            <ActionForm action={answerAction} className="space-y-2">
              {hidden}
              {q.choices.map((c, i) => (
                <button key={i} type="submit" name="resp" value={i} disabled={q.wrong.includes(i)} className={`block w-full rounded-xl border p-4 text-left text-[1.02rem] ${q.wrong.includes(i) ? "border-line text-muted line-through" : "border-line hover:border-accent"}`}><H html={c} /></button>
              ))}
            </ActionForm>
          )}
          {!q.answered && <ActionForm action={hintAction}>{hidden}<Submit className="btn btn-sm" disabled={q.hints >= 3} pendingText="…">{q.hints === 0 ? "Give me a hint" : q.hints < 3 ? "Another hint" : "No more hints"}</Submit></ActionForm>}

          {q.answered && q.feedback && (
            <div className="space-y-3" data-testid="feedback" aria-live="polite">
              <p className={`notice ${q.ok ? "notice-good" : "notice-bad"}`}><strong>{q.ok ? "Correct." : "Not quite."}</strong>{q.feedback.answer !== null && !q.ok && <> The answer is <b>{Number(q.feedback.answer.toFixed(4))}</b>.</>}</p>
              {q.feedback.trap && <p className="notice notice-warn" data-testid="trap-feedback">{q.feedback.trap}</p>}
              {q.feedback.steps.length > 0 && <ol className="space-y-2 text-sm">{q.feedback.steps.map((s, i) => <li key={i} className="rounded-lg bg-surface-2 p-3"><H html={s} /></li>)}</ol>}
              {q.feedback.whyEach && q.choices && <ul className="space-y-2 text-sm">{q.choices.map((c, i) => <li key={i} className={`rounded-lg border p-3 ${i === q.feedback!.correctIndex ? "border-[var(--good)]" : "border-line"}`}><b><H html={c} /></b><br /><span className="text-muted"><H html={q.feedback!.whyEach![i]} /></span></li>)}</ul>}
              {q.sources.length > 0 && <p className="text-xs text-muted">From: {q.sources.join(", ")}</p>}
            </div>
          )}
          {q.answered && <div className="flex items-center justify-between gap-3"><ActionForm action={reportQuestionAction}>{hidden}<input type="hidden" name="key" value={q.key} /><Submit className="btn btn-quiet btn-sm" pendingText="…">Report a problem</Submit></ActionForm><Next label={q.ok ? "Next" : "Got it, next"} /></div>}
          {!q.answered && v.phase === "practice" && <div className="text-xs text-muted tnum" data-testid="checkpoint">Mastery check: {v.checkpoint.recent.filter((x) => x === 1).length} clean answers in your last {Math.max(v.checkpoint.recent.length, 0)} (need {v.checkpoint.needed} of 5)</div>}
        </section>
      )}

      {v.phase === "done" && (
        <section className="panel space-y-3 p-6 text-center" data-testid="concept-done">
          <h2 className="text-xl font-semibold">{v.concept.title}: practiced</h2>
          <p className="text-muted">It becomes solid once you get a later, spaced question on it right without help. Klierly will bring it back.</p>
          <Next label="Next concept" />
        </section>
      )}
    </article>
  );
}
