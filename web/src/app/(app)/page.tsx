import Link from "next/link";
import { loadSample } from "@/app/actions/courses";
import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { requireUser } from "@/lib/auth";
import { courseSummaries } from "@/lib/courses";
import { daysBetween, formatDate, today } from "@/lib/dates";
import { readiness } from "@/lib/practice/core";

export const metadata = { title: "Courses" };

function examLine(date: string | null, confirmed: boolean) {
  if (!date) return { text: "No exam date set", tone: "text-muted" };
  const d = daysBetween(today(), date);
  const when = d < 0 ? "passed" : d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;
  return { text: `${confirmed ? "Exam" : "Tentative exam"} ${formatDate(date)} — ${when}`, tone: d >= 0 && d <= 7 ? "text-warn" : "text-muted" };
}

export default async function CoursesPage() {
  const user = await requireUser();
  const list = await courseSummaries(user.id);
  const hasSample = list.some((s) => s.course.isSample);
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Your courses</h1>
          <p className="mt-1 text-muted">Each course holds the material you imported, your study plan and your practice history.</p>
        </div>
        <Link href="/courses/new" className="btn btn-primary"><Icon name="plus" />New course</Link>
      </div>

      {list.length === 0 ? (
        <section className="panel mt-8 grid gap-8 p-6 sm:grid-cols-2 sm:p-8">
          <div>
            <h2 className="text-lg font-semibold">Start with your own course</h2>
            <p className="mt-2 text-muted">Create a course, import notes, slides or readings you are allowed to use, then build a study plan around your exam date.</p>
            <Link href="/courses/new" className="btn btn-primary mt-4"><Icon name="plus" />New course</Link>
          </div>
          <div className="border-t border-line pt-6 sm:border-l sm:border-t-0 sm:pl-8 sm:pt-0">
            <h2 className="text-lg font-semibold">Or look around first</h2>
            <p className="mt-2 text-muted">Load a synthetic statistics course (written for this app, not real university content) with ready-made practice questions. It works without an AI key.</p>
            <ActionForm action={loadSample} className="mt-4"><Submit className="btn" pendingText="Processing sample files…">Load the sample course</Submit></ActionForm>
          </div>
        </section>
      ) : (
        <>
          <ul className="mt-7 grid gap-4 md:grid-cols-2">
            {list.map(({ course, examDate, examConfirmed, documentCount, recent, scopeTopics, answered }) => {
              const exam = examLine(examDate, examConfirmed);
              const r = readiness(scopeTopics);
              return (
                <li key={course.id} className="panel flex flex-col p-5">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-lg font-semibold leading-snug">
                      <Link href={`/courses/${course.id}`} className="hover:underline">{course.name}</Link>
                    </h2>
                    {course.isSample && <span className="badge badge-accent">Synthetic sample</span>}
                  </div>
                  {course.term && <p className="text-sm text-muted">{course.term}</p>}
                  <p className={`mt-3 flex items-center gap-2 text-sm ${exam.tone}`}><Icon name="calendar" />{exam.text}</p>
                  <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-line pt-4 text-sm">
                    <div><dt className="text-muted">Readiness</dt><dd className="tnum text-lg font-semibold">{r.value === null ? "—" : `${r.value}%`}</dd></div>
                    <div><dt className="text-muted">Topics practised</dt><dd className="tnum text-lg font-semibold">{r.practised}/{r.total}</dd></div>
                    <div><dt className="text-muted">Answers</dt><dd className="tnum text-lg font-semibold">{answered}</dd></div>
                  </dl>
                  <p className="mt-1 text-xs text-muted">Readiness is a rough heuristic from your practice, not a grade prediction.</p>
                  <div className="mt-4 border-t border-line pt-3 text-sm">
                    <p className="text-muted">{documentCount === 0 ? "No material imported yet" : `${documentCount} ${documentCount === 1 ? "source" : "sources"} · recent imports`}</p>
                    <ul className="mt-1 space-y-0.5">
                      {recent.map((d) => (
                        <li key={d.id} className="flex items-center gap-2 truncate">
                          <Icon name="file" className="shrink-0 text-muted" />
                          <Link className="truncate hover:underline" href={`/courses/${course.id}/materials/${d.id}`}>{d.title}</Link>
                          {d.status !== "ready" && <span className={`badge ${d.status === "failed" ? "badge-bad" : "badge-warn"}`}>{d.status}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="mt-5 flex flex-wrap gap-2">
                    <Link href={`/courses/${course.id}`} className="btn btn-sm">Open course</Link>
                    <Link href={`/courses/${course.id}/practice`} className="btn btn-sm btn-quiet">Practice</Link>
                  </div>
                </li>
              );
            })}
          </ul>
          {!hasSample && (
            <ActionForm action={loadSample} className="mt-6 text-sm text-muted">
              Want to try every feature without an AI key? <Submit className="link" pendingText="Processing sample files…">Load the synthetic sample course</Submit>
            </ActionForm>
          )}
        </>
      )}
    </>
  );
}
