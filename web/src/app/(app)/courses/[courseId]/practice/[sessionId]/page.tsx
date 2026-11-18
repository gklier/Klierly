import Link from "next/link";
import { notFound } from "next/navigation";
import { generateAction, startPractice } from "@/app/actions/practice";
import { aiStatus } from "@/lib/ai/provider";
import { CitationList } from "@/components/citations";
import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { ErrorTagger, PracticeRunner, QuestionLabels, ReportButton } from "@/components/practice-runner";
import { requireUser } from "@/lib/auth";
import { getCourse } from "@/lib/courses";
import { getSessionView } from "@/lib/practice/service";

export const metadata = { title: "Practice session" };
const LETTERS = ["A", "B", "C", "D"];
const secs = (ms: number) => (ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`);

export default async function SessionPage({ params }: { params: Promise<{ courseId: string; sessionId: string }> }) {
  const user = await requireUser();
  const { courseId, sessionId } = await params;
  const course = await getCourse(user.id, courseId);
  const view = await getSessionView(user.id, sessionId);
  if (!view || view.courseId !== course.id) notFound();
  if (view.status === "active") return <PracticeRunner view={view} courseName={course.name} />;

  const total = view.questions.length;
  const answered = view.questions.filter((q) => view.answers[q.id]?.feedback);
  const correct = view.correctCount ?? 0;
  const totalMs = Object.values(view.answers).reduce((n, a) => n + a.timeMs, 0);
  const denominator = view.mode === "exam" ? total : answered.length;
  const byTopic = new Map<string, { right: number; n: number; id: string | null }>();
  for (const q of answered) {
    const k = q.topicName ?? "Other";
    const e = byTopic.get(k) ?? { right: 0, n: 0, id: q.topicId };
    e.n++; if (view.answers[q.id].feedback!.isCorrect) e.right++;
    byTopic.set(k, e);
  }
  const weak = [...byTopic.entries()].filter(([, v]) => v.right < v.n).sort((a, b) => a[1].right / a[1].n - b[1].right / b[1].n);
  const weakIds = weak.map(([, v]) => v.id).filter((id): id is string => Boolean(id)).slice(0, 8);
  const ai = weakIds.length ? await aiStatus(user.id) : null;
  const title = { drill: "Drill results", exam: "Mock exam results", review: "Review results" }[view.mode];

  return (
    <div>
      <Link href={`/courses/${course.id}/practice`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><Icon name="back" size={14} />Practice</Link>
      <h1 className="mt-2 text-2xl font-semibold">{title}</h1>
      <dl className="panel mt-4 grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
        <div><dt className="text-sm text-muted">Score</dt><dd className="tnum text-2xl font-semibold" data-testid="score">{correct}/{denominator}</dd></div>
        <div><dt className="text-sm text-muted">Percent</dt><dd className="tnum text-2xl font-semibold">{denominator ? Math.round((correct / denominator) * 100) : 0}%</dd></div>
        <div><dt className="text-sm text-muted">Time on questions</dt><dd className="tnum text-2xl font-semibold">{secs(totalMs)}</dd></div>
        <div><dt className="text-sm text-muted">Average per question</dt><dd className="tnum text-2xl font-semibold">{answered.length ? secs(totalMs / answered.length) : "—"}</dd></div>
      </dl>
      {view.mode !== "exam" && answered.length < total && <p className="mt-2 text-sm text-muted">{total - answered.length} of {total} questions were not answered and are not counted.</p>}

      <section className="mt-6" aria-labelledby="next-h">
        <h2 id="next-h" className="text-lg font-semibold">What to practise next</h2>
        {weak.length === 0 ? (
          <p className="mt-1 text-muted">No misses in this session. Come back when these topics are due for spaced review, or try a timed mock exam.</p>
        ) : (
          <>
            <ul className="mt-2 space-y-1 text-sm">
              {weak.slice(0, 4).map(([name, v]) => <li key={name}><strong>{name}</strong> — {v.right}/{v.n} correct in this session</li>)}
            </ul>
            <div className="mt-3 flex flex-wrap items-start gap-2">
              <ActionForm action={startPractice}>
                <input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="mode" value="review" /><input type="hidden" name="count" value="10" />
                <Submit className="btn" pendingText="Starting…">Retry the questions I missed</Submit>
              </ActionForm>
              {weakIds.length > 0 && (
                <ActionForm action={startPractice}>
                  <input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="mode" value="drill" /><input type="hidden" name="count" value="8" />
                  {weakIds.map((id) => <input key={id} type="hidden" name="topicIds" value={id} />)}
                  <Submit className="btn" pendingText="Starting…">Drill these topics</Submit>
                </ActionForm>
              )}
            </div>
            {weakIds.length > 0 && ai?.kind && ai.available && course.allowExternalAi && (
              <ActionForm action={generateAction} className="mt-3">
                <input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="perTopic" value="3" />
                {weakIds.map((id) => <input key={id} type="hidden" name="topicIds" value={id} />)}
                <Submit className="btn" pendingText="Writing new questions on your weak topics…">Generate fresh questions on these topics</Submit>
                <p className="help">New questions, written from your materials on the topics above, so follow-up practice is not a repeat of what you just saw.</p>
              </ActionForm>
            )}
          </>
        )}
      </section>

      <h2 className="mt-8 text-lg font-semibold">Question review</h2>
      <ol className="mt-3 space-y-4">
        {view.questions.map((q, i) => {
          const a = view.answers[q.id];
          const f = a?.feedback;
          if (!f) return <li key={q.id} className="panel p-4 text-sm text-muted"><span className="tnum font-semibold">{i + 1}.</span> Not answered — {q.stem}</li>;
          const blank = a.response.choice === undefined && !a.response.value;
          return (
            <li key={q.id} className="panel p-4 sm:p-5">
              <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
                <span className="tnum font-semibold text-ink">{i + 1}.</span>
                <span className={`badge ${f.isCorrect ? "badge-good" : "badge-bad"}`}>{f.isCorrect ? "Correct" : blank ? "No answer" : "Incorrect"}</span>
                {q.topicName && <span>{q.topicName}</span>}<span className="tnum">· {secs(a.timeMs)}</span>{a.hintUsed && <span className="badge">Hint used</span>}
              </p>
              <p className="reading mt-2 whitespace-pre-wrap !text-[1.05rem]">{q.stem}</p>
              {q.type === "mcq" && q.choices ? (
                <ul className="mt-3 space-y-1.5">
                  {q.choices.map((c, j) => {
                    const right = f.correctIndex === j, picked = a.response.choice === j;
                    return (
                      <li key={j} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2 text-sm ${right ? "border-good bg-good-soft" : picked ? "border-bad bg-bad-soft" : "border-line"}`}>
                        <span className="font-semibold">{LETTERS[j]}</span><span className="font-serif text-[0.98rem]">{c}</span>
                        <span className="ml-auto shrink-0 text-xs font-semibold">{right ? "Correct answer" : picked ? "Your answer" : ""}{right && picked ? " · your answer" : ""}</span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-sm">Your answer: <strong className="tnum">{a.response.value ?? "—"}</strong> · Correct answer: <strong className="tnum">{f.correctValue}</strong>{f.unit ? ` ${f.unit}` : ""}</p>
              )}
              <p className="mt-3 font-serif text-[1rem] leading-relaxed">{f.explanation}</p>
              <div className="mt-3 space-y-3">
                {!f.isCorrect && <ErrorTagger answerId={f.answerId} initial={f.errorReason} />}
                <CitationList citations={f.citations} courseId={course.id} />
                <QuestionLabels f={f} />
                <ReportButton questionId={q.id} />
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
