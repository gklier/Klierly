import Link from "next/link";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { Icon } from "@/components/icons";
import { StripPlot } from "@/components/strip-plot";
import { aiStatus } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth";
import { getCourse, pendingProposalCount, topicStates } from "@/lib/courses";
import { daysBetween, formatDate, today } from "@/lib/dates";
import { getPlan } from "@/lib/plan/service";
import { readiness } from "@/lib/practice/core";

export const metadata = { title: "Overview" };

export default async function CourseOverview({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await requireUser();
  const course = await getCourse(user.id, (await params).courseId);
  const [topics, plan, pending, provider, docs, [answered]] = await Promise.all([
    topicStates(user.id, course.id), getPlan(user.id, course.id), pendingProposalCount(course.id), aiStatus(user.id),
    db.select().from(schema.sourceDocuments).where(eq(schema.sourceDocuments.courseId, course.id)).orderBy(desc(schema.sourceDocuments.createdAt)),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.answers).where(and(eq(schema.answers.courseId, course.id), sql`${schema.answers.isCorrect} is not null`)),
  ]);
  const now = today();
  const base = `/courses/${course.id}`;
  const scope = plan?.plan.moduleIds.length ? topics.filter((t) => t.moduleId && plan.plan.moduleIds.includes(t.moduleId)) : topics;
  const r = readiness(scope);
  const examDate = plan?.plan.examDate ?? course.examDate;
  const days = examDate ? daysBetween(now, examDate) : null;
  const todays = plan?.sessions.filter((s) => s.date === now) ?? [];
  const next = plan?.sessions.filter((s) => s.date > now && s.status === "planned").slice(0, 3) ?? [];
  const questions = topics.reduce((n, t) => n + t.questionCount, 0);
  const steps = [
    { done: docs.some((d) => d.status === "ready"), label: "Import course material", href: `${base}/materials`, hint: "Syllabus, notes, slides or readings you are allowed to use" },
    { done: topics.length > 0 && pending === 0, label: pending > 0 ? `Review ${pending} suggestions from your materials` : "Confirm modules and topics", href: `${base}/materials`, hint: "Accept or correct what was found in your files" },
    { done: questions > 0, label: "Get practice questions", href: `${base}/practice`, hint: provider.kind ? "Generate questions from your materials" : "Needs AI to be set up (the sample course already has questions)" },
    { done: Boolean(plan), label: "Prepare for your exam", href: `${base}/plan`, hint: "Set the date, scope and minutes per day" },
    { done: (answered?.n ?? 0) > 0, label: "Take a first practice session", href: `${base}/practice`, hint: "Progress and readiness start from your answers" },
  ];
  const allDone = steps.every((s) => s.done);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{course.name}</h1>
        <p className="mt-1 text-muted">{[course.term, course.goal].filter(Boolean).join(" · ") || "Course overview"}</p>
      </header>

      <section className="grid gap-4 md:grid-cols-[1.1fr_1fr]">
        <div className="panel p-5">
          <h2 className="text-sm font-semibold text-muted">{plan ? "Exam" : "Tentative exam date"}</h2>
          {examDate ? (
            <>
              <p className="mt-1 text-xl font-semibold">{formatDate(examDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p>
              <p className={`tnum ${days !== null && days >= 0 && days <= 7 ? "text-warn" : "text-muted"}`}>{days === null ? "" : days < 0 ? "This date has passed" : days === 0 ? "Today" : `${days} ${days === 1 ? "day" : "days"} to go`}{!plan && " · not confirmed in a study plan yet"}</p>
            </>
          ) : <p className="mt-1 text-muted">No exam date yet.</p>}
          <div className="mt-4 border-t border-line pt-4">
            <h3 className="text-sm font-semibold">{todays.length ? "Today" : "Up next"}</h3>
            {!plan ? <p className="mt-1 text-sm text-muted">No study plan yet. <Link className="link" href={`${base}/plan`}>Prepare for an exam</Link></p> : (todays.length ? todays : next).length === 0 ? <p className="mt-1 text-sm text-muted">Nothing scheduled. <Link className="link" href={`${base}/plan`}>Open the plan</Link></p> : (
              <ul className="mt-1 space-y-1.5 text-sm">
                {(todays.length ? todays : next).map((s) => (
                  <li key={s.id} className="flex items-start gap-2"><Icon name={s.status === "done" ? "check" : "calendar"} className={`mt-0.5 shrink-0 ${s.status === "done" ? "text-good" : "text-muted"}`} /><span className={s.status === "done" ? "text-muted line-through" : ""}>{!todays.length && <span className="text-muted">{formatDate(s.date)} · </span>}{s.title} <span className="tnum text-muted">· {s.minutes} min</span></span></li>
                ))}
              </ul>
            )}
            {plan && <Link href={`${base}/plan`} className="btn btn-sm mt-3">Open study plan</Link>}
          </div>
        </div>

        <div className="panel p-5">
          <h2 className="text-sm font-semibold text-muted">Readiness {plan?.plan.moduleIds.length ? "for the exam scope" : ""}</h2>
          <p className="mt-1 flex items-baseline gap-2"><span className="tnum text-4xl font-semibold">{r.value === null ? "—" : `${r.value}%`}</span><span className="text-sm text-muted">{r.practised} of {r.total} topics practised</span></p>
          <div className="mt-3"><StripPlot topics={scope} /></div>
          <p className="mt-2 text-xs text-muted">A heuristic from your recent answers (mastery per topic, discounted until a topic has 5 answers). It is not a prediction of your grade.{r.value !== null && !r.enoughData && " There is not much data yet, so treat it as a rough signal."}</p>
        </div>
      </section>

      {!allDone && (
        <section className="panel p-5" aria-labelledby="steps-h">
          <h2 id="steps-h" className="text-base font-semibold">Getting this course ready</h2>
          <ol className="mt-3 space-y-2">
            {steps.map((s, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-xs ${s.done ? "border-good bg-good-soft text-good" : "border-line text-muted"}`}>{s.done ? <Icon name="check" size={12} /> : i + 1}</span>
                <span>{s.done ? <span className="text-muted">{s.label}</span> : <Link className="link font-medium" href={s.href}>{s.label}</Link>}{!s.done && <span className="block text-sm text-muted">{s.hint}</span>}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="grid gap-4 md:grid-cols-2">
        <div className="panel p-5">
          <div className="flex items-center justify-between"><h2 className="text-base font-semibold">Recent imports</h2><Link href={`${base}/materials`} className="btn btn-sm btn-quiet">All materials</Link></div>
          {docs.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing imported yet.</p> : (
            <ul className="mt-2 space-y-1.5 text-sm">
              {docs.slice(0, 5).map((d) => (
                <li key={d.id} className="flex items-center gap-2"><Icon name="file" className="shrink-0 text-muted" /><Link className="truncate hover:underline" href={`${base}/materials/${d.id}`}>{d.title}</Link>{d.status !== "ready" && <span className={`badge ${d.status === "failed" ? "badge-bad" : "badge-warn"}`}>{d.status}</span>}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="panel p-5">
          <div className="flex items-center justify-between"><h2 className="text-base font-semibold">Practice</h2><Link href={`${base}/practice`} className="btn btn-sm btn-primary">Practise now</Link></div>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div><dt className="text-muted">Questions</dt><dd className="tnum text-lg font-semibold">{questions}</dd></div>
            <div><dt className="text-muted">Answers given</dt><dd className="tnum text-lg font-semibold">{answered?.n ?? 0}</dd></div>
            <div><dt className="text-muted">Topics</dt><dd className="tnum text-lg font-semibold">{topics.length}</dd></div>
          </dl>
          {topics.some((t) => !t.hasSources) && <p className="mt-3 text-sm text-warn">Some topics have no supporting material. <Link className="link" href={`${base}/materials#cov-h`}>See coverage</Link></p>}
        </div>
      </section>
    </div>
  );
}
