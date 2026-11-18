import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { ERROR_REASONS } from "@/db/schema";
import { REASONS } from "@/lib/practice/reasons";
import { StripPlot } from "@/components/strip-plot";
import { requireUser } from "@/lib/auth";
import { getCourse, topicStates } from "@/lib/courses";
import { formatDate, today } from "@/lib/dates";
import { getPlan } from "@/lib/plan/service";
import { readiness } from "@/lib/practice/core";

export const metadata = { title: "Progress" };
const MODE_LABEL = { drill: "Drill", exam: "Timed exam", review: "Review" } as const;

export default async function ProgressPage({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await requireUser();
  const course = await getCourse(user.id, (await params).courseId);
  const [topics, plan, reasons, byTopicWrong, daily, sessions] = await Promise.all([
    topicStates(user.id, course.id), getPlan(user.id, course.id),
    db.execute<{ reason: string | null; n: number }>(sql`select error_reason as reason, count(*)::int as n from answers where course_id = ${course.id} and user_id = ${user.id} and is_correct = false group by 1`),
    db.execute<{ topic_id: string; wrong: number; top_reason: string | null }>(sql`
      select topic_id, count(*)::int as wrong, mode() within group (order by error_reason) as top_reason
      from answers where course_id = ${course.id} and user_id = ${user.id} and is_correct = false and topic_id is not null group by 1`),
    db.execute<{ day: string; n: number; right: number }>(sql`
      select to_char(created_at, 'YYYY-MM-DD') as day, count(*)::int as n, count(*) filter (where is_correct)::int as right
      from answers where course_id = ${course.id} and user_id = ${user.id} and is_correct is not null group by 1 order by 1 desc limit 14`),
    db.select().from(schema.practiceSessions).where(and(eq(schema.practiceSessions.courseId, course.id), eq(schema.practiceSessions.userId, user.id), eq(schema.practiceSessions.status, "submitted"))).orderBy(desc(schema.practiceSessions.startedAt)).limit(15),
  ]);
  const scope = plan?.plan.moduleIds.length ? topics.filter((t) => t.moduleId && plan.plan.moduleIds.includes(t.moduleId)) : topics;
  const r = readiness(scope);
  const totalAnswers = topics.reduce((n, t) => n + t.attempts, 0);
  const totalWrong = reasons.rows.reduce((n, x) => n + x.n, 0);
  const untagged = reasons.rows.find((x) => x.reason === null)?.n ?? 0;
  const reasonCount = (id: string) => reasons.rows.find((x) => x.reason === id)?.n ?? 0;
  const maxReason = Math.max(1, ...ERROR_REASONS.map(reasonCount));
  const wrongByTopic = new Map(byTopicWrong.rows.map((x) => [x.topic_id, x]));
  const days = [...daily.rows].reverse();
  const now = Date.now();
  const base = `/courses/${course.id}`;

  if (totalAnswers === 0) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">Progress</h1>
        <p className="notice mt-4">No practice results yet. After your first session this page shows mastery by topic, the kinds of mistakes you make, and how your accuracy changes over time. <Link className="link" href={`${base}/practice`}>Start practising</Link></p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Progress</h1>

      <section className="panel p-5" aria-labelledby="ready-h">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h2 id="ready-h" className="text-base font-semibold">Readiness estimate{plan?.plan.moduleIds.length ? " for the exam scope" : ""}</h2>
          <span className="tnum text-3xl font-semibold" data-testid="readiness">{r.value === null ? "—" : `${r.value}%`}</span>
          <span className="text-sm text-muted">{r.practised} of {r.total} topics practised · {totalAnswers} graded answers</span>
        </div>
        <div className="mt-4"><StripPlot topics={scope} height={76} /></div>
        <p className="mt-2 text-sm text-muted"><strong className="text-ink">This is a heuristic, not a grade prediction.</strong> It averages your per-topic mastery (recent answers weigh more) and discounts topics with fewer than 5 answers, so untouched topics pull it down. It knows nothing about how your real exam is written or graded.{!r.enoughData && " There is too little data so far for it to mean much."}</p>
      </section>

      <section aria-labelledby="topics-h">
        <h2 id="topics-h" className="text-lg font-semibold">By topic</h2>
        <div className="panel mt-2 overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead><tr className="border-b border-line text-left text-muted"><th className="px-4 py-2 font-medium">Topic</th><th className="px-3 py-2 font-medium">Mastery</th><th className="px-3 py-2 font-medium">Correct</th><th className="px-3 py-2 font-medium">Misses</th><th className="px-3 py-2 font-medium">Most common reason</th><th className="px-3 py-2 font-medium">Next review</th></tr></thead>
            <tbody className="divide-y divide-line">
              {topics.map((t) => {
                const w = wrongByTopic.get(t.id);
                const due = t.nextReviewAt && t.nextReviewAt.getTime() <= now;
                return (
                  <tr key={t.id}>
                    <td className="px-4 py-2"><Link className="hover:underline" href={`${base}/practice/learn/${t.id}`}>{t.name}</Link><span className="block text-xs text-muted">{t.moduleName?.split(":")[0] ?? "No module"}</span></td>
                    <td className="px-3 py-2">{t.attempts === 0 ? <span className="text-muted">Not practised</span> : (
                      <span className="flex items-center gap-2"><span className="h-1.5 w-16 overflow-hidden rounded bg-surface-2"><span className="block h-full" style={{ width: `${Math.round(t.score! * 100)}%`, background: t.score! >= 0.8 ? "var(--good)" : t.score! >= 0.5 ? "var(--accent)" : "var(--bad)" }} /></span><span className="tnum">{Math.round(t.score! * 100)}%</span></span>)}</td>
                    <td className="tnum px-3 py-2">{t.attempts ? `${t.correct}/${t.attempts}` : "—"}</td>
                    <td className="tnum px-3 py-2">{w?.wrong ?? 0}</td>
                    <td className="px-3 py-2 text-muted">{w?.top_reason ? REASONS.find((x) => x.id === w.top_reason)?.label : w ? "Not tagged" : "—"}</td>
                    <td className="px-3 py-2">{!t.nextReviewAt ? "—" : due ? <span className="badge badge-warn">Due now</span> : <span className="tnum text-muted">{formatDate(today(t.nextReviewAt))}</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="panel p-5">
          <h2 className="text-base font-semibold">Why answers were wrong</h2>
          {totalWrong === 0 ? <p className="mt-2 text-sm text-muted">No wrong answers so far.</p> : (
            <>
              <ul className="mt-3 space-y-2 text-sm">
                {REASONS.map((x) => (
                  <li key={x.id} className="grid grid-cols-[8.5rem_1fr_2rem] items-center gap-2" title={x.help}>
                    <span>{x.label}</span>
                    <span className="h-2 overflow-hidden rounded bg-surface-2"><span className="block h-full rounded bg-accent" style={{ width: `${(reasonCount(x.id) / maxReason) * 100}%` }} /></span>
                    <span className="tnum text-right">{reasonCount(x.id)}</span>
                  </li>
                ))}
              </ul>
              {untagged > 0 && <p className="mt-3 text-sm text-muted">{untagged} of {totalWrong} wrong answers have no reason yet. Tag them when you review a session — it shows whether to study concepts or slow down on calculations.</p>}
            </>
          )}
        </div>
        <div className="panel p-5">
          <h2 className="text-base font-semibold">Accuracy by day</h2>
          <ul className="mt-3 flex h-28 items-end gap-1.5" aria-label="Accuracy by practice day">
            {days.map((d) => {
              const pct = Math.round((d.right / d.n) * 100);
              return <li key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${formatDate(d.day)}: ${d.right}/${d.n} correct`}><span className="tnum text-[0.7rem] text-muted">{pct}%</span><span className="w-full max-w-8 rounded-t bg-accent" style={{ height: `${Math.max(4, pct * 0.7)}%`, opacity: 0.45 + Math.min(0.55, d.n / 30) }} /><span className="tnum text-[0.65rem] text-muted">{d.day.slice(5).replace("-", "/")}</span></li>;
            })}
          </ul>
          <p className="mt-2 text-xs text-muted">Each bar is one day you practised (darker = more answers). {days.length < 2 ? "Practise on another day to see a trend." : ""}</p>
        </div>
      </section>

      <section aria-labelledby="hist-h">
        <h2 id="hist-h" className="text-lg font-semibold">Session history</h2>
        <ul className="panel mt-2 divide-y divide-line text-sm">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <span><span className="font-medium">{MODE_LABEL[s.mode]}</span> <span className="text-muted">· {s.startedAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span></span>
              <span className="flex items-center gap-3"><span className="tnum">{s.correctCount ?? 0}/{s.questionIds.length} correct</span><Link className="btn btn-sm" href={`${base}/practice/${s.id}`}>Review</Link></span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
