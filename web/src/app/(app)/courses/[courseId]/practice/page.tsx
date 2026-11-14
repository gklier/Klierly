import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { generateAction, startPractice } from "@/app/actions/practice";
import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { getProvider, usageToday } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth";
import { getCourse, topicStates } from "@/lib/courses";
import { masteryMap, questionPool } from "@/lib/practice/service";
import { pickQuestions, mulberry32 } from "@/lib/practice/core";

export const metadata = { title: "Practice" };

const MODE_LABEL = { drill: "Drill", exam: "Timed exam", review: "Review mistakes" } as const;

function TopicPicker({ topics, name = "topicIds", note }: { topics: { id: string; name: string; questionCount: number; moduleName: string | null }[]; name?: string; note: string }) {
  return (
    <details className="mt-3 text-sm">
      <summary className="font-medium text-muted">Choose topics <span className="font-normal">({note})</span></summary>
      <div className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {topics.map((t) => (
          <label key={t.id} className="flex items-start gap-2 py-0.5">
            <input type="checkbox" name={name} value={t.id} className="mt-1 accent-[var(--accent)]" />
            <span>{t.name} <span className="tnum text-muted">· {t.questionCount}</span></span>
          </label>
        ))}
      </div>
    </details>
  );
}

export default async function PracticePage({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await requireUser();
  const course = await getCourse(user.id, (await params).courseId);
  const [topics, provider, pool, mastery, recent, reported] = await Promise.all([
    topicStates(user.id, course.id),
    getProvider(user.id),
    questionPool(user.id, course.id),
    masteryMap(user.id, course.id),
    db.select().from(schema.practiceSessions).where(and(eq(schema.practiceSessions.courseId, course.id), eq(schema.practiceSessions.userId, user.id))).orderBy(desc(schema.practiceSessions.startedAt)).limit(8),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.questions).where(and(eq(schema.questions.courseId, course.id), eq(schema.questions.status, "reported"))),
  ]);
  const total = pool.length;
  const unseen = pool.filter((q) => q.timesSeen === 0).length;
  const reviewCount = pickQuestions(pool, mastery, "review", 60, mulberry32(1), Date.now()).length;
  const withQuestions = topics.filter((t) => t.questionCount > 0);
  const used = provider ? await usageToday(user.id) : 0;
  const base = `/courses/${course.id}/practice`;
  const suggested = topics.filter((t) => t.hasSources).sort((a, b) => a.questionCount - b.questionCount || (a.score ?? 0.4) - (b.score ?? 0.4)).slice(0, 4).map((t) => t.id);

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-semibold">Practice</h1>
        <p className="mt-1 text-muted">
          {total === 0 ? "No practice questions yet." : <><span className="tnum">{total}</span> questions in this course, <span className="tnum">{unseen}</span> you have not seen. Every question links back to your materials.</>}
        </p>
      </div>

      {topics.length === 0 ? (
        <p className="notice">Practice is organised by topic. <Link className="link" href={`/courses/${course.id}/materials`}>Import material and accept or add topics</Link> first.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <section className="panel p-5" aria-labelledby="m-learn">
            <h2 id="m-learn" className="flex items-center gap-2 text-base font-semibold"><Icon name="book" />Learn</h2>
            <p className="mt-1 text-sm text-muted">A short explanation of one topic, built from your sources, before you practise it.</p>
            <ul className="mt-3 max-h-56 space-y-0.5 overflow-y-auto text-sm">
              {topics.map((t) => (
                <li key={t.id}><Link className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-surface-2" href={`${base}/learn/${t.id}`}>
                  <span>{t.name}</span>{!t.hasSources ? <span className="badge badge-warn">No material</span> : <Icon name="arrow" className="text-muted" />}
                </Link></li>
              ))}
            </ul>
          </section>

          <section className="panel p-5" aria-labelledby="m-drill">
            <h2 id="m-drill" className="flex items-center gap-2 text-base font-semibold"><Icon name="target" />Drill</h2>
            <p className="mt-1 text-sm text-muted">A short adaptive set: weak and overdue topics come up more, with mastered ones mixed in. Feedback after every answer.</p>
            <ActionForm action={startPractice} className="mt-3">
              <input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="mode" value="drill" />
              <div className="flex items-end gap-2">
                <div><label className="label" htmlFor="drill-n">Questions</label>
                  <select id="drill-n" name="count" className="input" defaultValue="8"><option>5</option><option>8</option><option>12</option><option>20</option></select></div>
                <Submit disabled={total === 0} pendingText="Starting…">Start drill</Submit>
              </div>
              {withQuestions.length > 1 && <TopicPicker topics={withQuestions} note="leave empty for adaptive mix" />}
            </ActionForm>
          </section>

          <section className="panel p-5" aria-labelledby="m-exam">
            <h2 id="m-exam" className="flex items-center gap-2 text-base font-semibold"><Icon name="clock" />Timed mock exam</h2>
            <p className="mt-1 text-sm text-muted">A fixed set under a time limit, preferring questions you have not seen. Score and explanations appear only after you submit.</p>
            <ActionForm action={startPractice} className="mt-3">
              <input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="mode" value="exam" />
              <div className="flex flex-wrap items-end gap-2">
                <div><label className="label" htmlFor="exam-n">Questions</label><input id="exam-n" name="count" type="number" min={3} max={60} defaultValue={Math.min(15, Math.max(3, total))} className="input w-24" /></div>
                <div><label className="label" htmlFor="exam-m">Minutes</label><input id="exam-m" name="minutes" type="number" min={1} max={240} defaultValue={25} className="input w-24" /></div>
                <Submit disabled={total < 3} pendingText="Starting…">Start exam</Submit>
              </div>
              {total < 3 && <p className="help">A mock exam needs at least 3 questions.</p>}
              {withQuestions.length > 1 && <TopicPicker topics={withQuestions} note="leave empty for all topics" />}
            </ActionForm>
          </section>

          <section className="panel p-5" aria-labelledby="m-review">
            <h2 id="m-review" className="flex items-center gap-2 text-base font-semibold"><Icon name="refresh" />Review mistakes</h2>
            <p className="mt-1 text-sm text-muted">Retry questions you last got wrong, plus topics whose spaced review is due.</p>
            <ActionForm action={startPractice} className="mt-3">
              <input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="mode" value="review" /><input type="hidden" name="count" value="12" />
              <div className="flex items-center gap-3">
                <Submit disabled={reviewCount === 0} pendingText="Starting…">Review {reviewCount > 0 ? Math.min(12, reviewCount) : ""} {reviewCount === 1 ? "question" : "questions"}</Submit>
                {reviewCount === 0 && <span className="text-sm text-muted">Nothing is waiting for review.</span>}
              </div>
            </ActionForm>
          </section>
        </div>
      )}

      {topics.length > 0 && (
        <section className="panel p-5" aria-labelledby="gen-h">
          <h2 id="gen-h" className="flex items-center gap-2 text-base font-semibold"><Icon name="spark" />Generate new questions</h2>
          {!provider ? (
            <div className="mt-2">
              <p className="notice"><strong>AI key required for generating new sets.</strong> {course.isSample ? "The sample course's ready-made questions work without one. " : ""}New questions are written by an AI provider you connect, from excerpts of your materials, then checked by Klierly before they are saved.</p>
              <Link href="/settings#ai" className="btn mt-3">Connect an AI provider</Link>
            </div>
          ) : !course.allowExternalAi ? (
            <p className="notice notice-warn mt-2">This course is set to keep its materials away from external AI providers. <Link className="link" href={`/courses/${course.id}/settings`}>Change it in course settings</Link> if your course rules allow it.</p>
          ) : (
            <ActionForm action={generateAction} className="mt-2">
              <input type="hidden" name="courseId" value={course.id} />
              <p className="text-sm text-muted">Sends up to 6 short excerpts per topic to <strong>{new URL(provider.baseUrl).host}</strong> ({provider.model}). Drafts with a wrong calculation, a missing source or more than one correct answer are discarded. <span className="tnum">{used}/{provider.dailyRequestLimit}</span> requests used today.</p>
              <fieldset className="mt-3">
                <legend className="label">Topics <span className="font-normal text-muted">(up to 8; number = questions already in the bank)</span></legend>
                <div className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                  {topics.map((t) => (
                    <label key={t.id} className={`flex items-start gap-2 py-0.5 ${t.hasSources ? "" : "text-muted"}`}>
                      <input type="checkbox" name="topicIds" value={t.id} defaultChecked={suggested.includes(t.id)} disabled={!t.hasSources} className="mt-1 accent-[var(--accent)]" />
                      <span>{t.name} <span className="tnum text-muted">· {t.questionCount}</span>{!t.hasSources && " · no material"}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="mt-3 flex items-end gap-2">
                <div><label className="label" htmlFor="per">Per topic</label><select id="per" name="perTopic" className="input" defaultValue="3"><option>2</option><option>3</option><option>5</option></select></div>
                <Submit pendingText="Generating and checking…">Generate questions</Submit>
              </div>
            </ActionForm>
          )}
        </section>
      )}

      {recent.length > 0 && (
        <section aria-labelledby="recent-h">
          <h2 id="recent-h" className="text-lg font-semibold">Recent sessions</h2>
          <ul className="panel mt-2 divide-y divide-line">
            {recent.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span><span className="font-medium">{MODE_LABEL[s.mode]}</span> <span className="text-muted">· {s.startedAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></span>
                <span className="flex items-center gap-3">
                  {s.status === "submitted" ? <span className="tnum">{s.correctCount ?? 0}/{s.questionIds.length} correct</span> : <span className="badge badge-warn">In progress</span>}
                  <Link className="btn btn-sm" href={`${base}/${s.id}`}>{s.status === "submitted" ? "Review" : "Continue"}</Link>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(reported[0]?.n ?? 0) > 0 && <p className="text-sm text-muted">{reported[0].n} reported {reported[0].n === 1 ? "question is" : "questions are"} excluded from practice.</p>}
    </div>
  );
}
