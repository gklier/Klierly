import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import type { PlanSessionKind } from "@/db/schema";
import { regeneratePlanAction, savePlanAction, startPlanSession, togglePlanSession } from "@/app/actions/plan";
import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { requireUser } from "@/lib/auth";
import { getCourse, listModules, topicStates } from "@/lib/courses";
import { addDays, daysBetween, formatDate, today } from "@/lib/dates";
import { moduleNumberOf } from "@/lib/ingest/proposals";
import { getPlan } from "@/lib/plan/service";

export const metadata = { title: "Study plan" };

const KIND: Record<PlanSessionKind, { label: string; tone: string }> = {
  learn: { label: "First pass", tone: "badge-accent" }, drill: { label: "Drill", tone: "" }, review: { label: "Spaced review", tone: "" },
  mixed: { label: "Mixed practice", tone: "" }, mock: { label: "Mock exam", tone: "badge-warn" }, wrap: { label: "Wrap-up", tone: "badge-good" },
};

export default async function PlanPage({ params, searchParams }: { params: Promise<{ courseId: string }>; searchParams: Promise<{ edit?: string; date?: string; mods?: string }> }) {
  const user = await requireUser();
  const course = await getCourse(user.id, (await params).courseId);
  const sp = await searchParams;
  const [data, modules, topics, dates] = await Promise.all([
    getPlan(user.id, course.id), listModules(course.id), topicStates(user.id, course.id),
    db.select().from(schema.courseDates).where(eq(schema.courseDates.courseId, course.id)).orderBy(asc(schema.courseDates.date)),
  ]);
  const now = today();
  const plan = data?.plan;
  const sessions = data?.sessions ?? [];
  const base = `/courses/${course.id}/plan`;
  const topicName = new Map(topics.map((t) => [t.id, t.name]));
  const examDates = dates.filter((d) => d.dateKind === "exam" && d.date > now);
  const showForm = !plan || sp.edit === "1";

  // Prefill: explicit choice from a syllabus date, then the saved plan, then the course's tentative date.
  const preDate = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : plan?.examDate ?? course.examDate ?? "";
  const preMods = sp.mods ? new Set(modules.filter((m) => sp.mods!.split(",").map(Number).includes(moduleNumberOf(m.name) ?? -1)).map((m) => m.id)) : new Set(plan?.moduleIds ?? modules.map((m) => m.id));
  const fromSyllabus = sp.date ? examDates.find((d) => d.date === sp.date) : undefined;

  const upcoming = sessions.filter((s) => s.date >= now);
  const missed = sessions.filter((s) => s.date < now && s.status === "planned");
  const earlier = sessions.filter((s) => s.date < now);
  const byDate = new Map<string, typeof sessions>();
  for (const s of upcoming) byDate.set(s.date, [...(byDate.get(s.date) ?? []), s]);
  const doneCount = sessions.filter((s) => s.status === "done").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Study plan</h1>
          {plan ? (
            <p className="mt-1 text-muted">Exam {formatDate(plan.examDate, { weekday: "long", month: "long", day: "numeric" })} — {daysBetween(now, plan.examDate) <= 0 ? "today or passed" : `${daysBetween(now, plan.examDate)} days away`} · {plan.minutesPerDay} minutes a day{plan.desiredGrade ? ` · aiming for ${plan.desiredGrade}` : ""}</p>
          ) : <p className="mt-1 text-muted">Tell CourseLab about your exam and it will lay out retrieval practice, worked examples and spaced review day by day.</p>}
        </div>
        {plan && !showForm && (
          <div className="flex gap-2">
            <form action={regeneratePlanAction}><input type="hidden" name="courseId" value={course.id} /><button className="btn" title="Rebuild from today using your latest practice results"><Icon name="refresh" />Update plan</button></form>
            <Link href={`${base}?edit=1`} className="btn">Edit exam details</Link>
          </div>
        )}
      </div>

      {showForm && (
        <ActionForm key={`${sp.date ?? ""}:${sp.mods ?? ""}`} action={savePlanAction} className="panel space-y-5 p-5">
          <input type="hidden" name="courseId" value={course.id} />
          <h2 className="text-lg font-semibold">Prepare for an exam</h2>

          {examDates.length > 0 && (
            <div className="notice text-sm">
              <p className="font-semibold">Exam dates found in your materials</p>
              <ul className="mt-1 space-y-1">
                {examDates.map((d) => (
                  <li key={d.id}>{d.label} <Link className="link" href={`${base}?edit=1&date=${d.date}${d.modulesCovered?.length ? `&mods=${d.modulesCovered.join(",")}` : ""}`}>Use this date{d.modulesCovered?.length ? " and scope" : ""}</Link></li>
                ))}
              </ul>
              <p className="mt-1 text-muted">Check them against your instructor&apos;s latest announcement — syllabi change.</p>
            </div>
          )}
          {fromSyllabus && <p className="notice notice-good text-sm">Filled in from “{fromSyllabus.label}”. Confirm it is still correct before saving.</p>}

          <div className="grid gap-4 sm:grid-cols-3">
            <div><label className="label" htmlFor="examDate">Exam date</label><input id="examDate" name="examDate" type="date" className="input" required min={addDays(now, 1)} defaultValue={preDate} /></div>
            <div><label className="label" htmlFor="minutesPerDay">Minutes per day</label><input id="minutesPerDay" name="minutesPerDay" type="number" min={10} max={600} step={5} className="input" required defaultValue={plan?.minutesPerDay ?? 40} /></div>
            <div><label className="label" htmlFor="desiredGrade">Target grade <span className="font-normal text-muted">(optional)</span></label><input id="desiredGrade" name="desiredGrade" className="input" maxLength={20} placeholder="A-" defaultValue={plan?.desiredGrade ?? ""} /></div>
          </div>

          <fieldset>
            <legend className="label">Modules this exam covers</legend>
            {modules.length === 0 ? <p className="text-sm text-muted">This course has no modules yet, so the plan will cover every topic. <Link className="link" href={`/courses/${course.id}/materials`}>Add modules</Link> to narrow the scope.</p> : (
              <div className="grid gap-1 sm:grid-cols-2">
                {modules.map((m) => {
                  const n = topics.filter((t) => t.moduleId === m.id).length;
                  return <label key={m.id} className="flex items-start gap-2 py-0.5 text-sm"><input type="checkbox" name="moduleIds" value={m.id} defaultChecked={preMods.has(m.id)} className="mt-1 accent-[var(--accent)]" /><span>{m.name} <span className="text-muted">· {n} {n === 1 ? "topic" : "topics"}</span></span></label>;
                })}
              </div>
            )}
          </fieldset>

          <fieldset>
            <legend className="label">How should sessions start?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {[["practice-first", "Practice first", "Try questions straight away and read the explanation after each one."], ["concise-reading", "Short reading first", "Read a brief note from your materials, then practise."]].map(([v, t, d]) => (
                <label key={v} className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line p-3 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                  <input type="radio" name="presentationMode" value={v} defaultChecked={(plan?.presentationMode ?? "practice-first") === v} className="mt-1 accent-[var(--accent)]" />
                  <span><span className="font-semibold">{t}</span><span className="block text-muted">{d}</span></span>
                </label>
              ))}
            </div>
            <p className="help">This is a preference for how sessions are arranged. Either way the plan relies on retrieval practice and spacing, which help regardless of preferred format.</p>
          </fieldset>

          {topics.length > 0 && (
            <details open={Object.keys(plan?.strengths ?? {}).length > 0}>
              <summary className="label !mb-0 cursor-pointer">How confident are you in each topic? <span className="font-normal text-muted">(optional — used only until you have practice results)</span></summary>
              <div className="mt-2 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {topics.map((t) => (
                  <label key={t.id} className="flex items-center justify-between gap-3 text-sm">
                    <span>{t.name}</span>
                    <select name={`strength_${t.id}`} defaultValue={String(plan?.strengths[t.id] ?? "")} className="input !min-h-8 w-36 !py-1 text-sm" aria-label={`Confidence in ${t.name}`}>
                      <option value="">Not rated</option><option value="1">1 · Lost</option><option value="2">2 · Shaky</option><option value="3">3 · OK</option><option value="4">4 · Solid</option><option value="5">5 · Strong</option>
                    </select>
                  </label>
                ))}
              </div>
            </details>
          )}

          <fieldset className="rounded-lg border border-line p-3">
            <legend className="px-1 text-sm font-semibold">Exam format</legend>
            <label className="flex items-start gap-2.5 text-sm"><input type="checkbox" name="formatConfirmed" defaultChecked={plan?.examFormat.confirmed} className="mt-1 accent-[var(--accent)]" /><span>My instructor has announced the format. <span className="text-muted">Leave unticked if you are not sure — CourseLab will not guess it, and the mock exam will use a default length.</span></span></label>
            <div className="mt-3 grid gap-3 sm:grid-cols-[8rem_8rem_1fr]">
              <div><label className="label" htmlFor="fq">Questions</label><input id="fq" name="formatQuestions" type="number" min={1} max={200} className="input" defaultValue={plan?.examFormat.questionCount ?? ""} /></div>
              <div><label className="label" htmlFor="fm">Minutes</label><input id="fm" name="formatMinutes" type="number" min={1} max={600} className="input" defaultValue={plan?.examFormat.minutes ?? ""} /></div>
              <div><label className="label" htmlFor="fn">Notes</label><input id="fn" name="formatNotes" className="input" maxLength={500} placeholder="e.g. multiple choice, formula sheet allowed" defaultValue={plan?.examFormat.notes ?? ""} /></div>
            </div>
          </fieldset>

          <div className="flex gap-2"><Submit pendingText="Building your plan…">{plan ? "Save and rebuild plan" : "Build my study plan"}</Submit>{plan && <Link href={base} className="btn btn-quiet">Cancel</Link>}</div>
        </ActionForm>
      )}

      {plan && !showForm && (
        <>
          {plan.warnings.length > 0 && (
            <section className="notice notice-warn" aria-label="Things to know about this plan">
              <p className="font-semibold">Before you rely on this plan</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </section>
          )}
          {missed.length > 0 && (
            <div className="notice flex flex-wrap items-center justify-between gap-3">
              <span>{missed.length} planned {missed.length === 1 ? "session was" : "sessions were"} missed. Updating the plan reschedules that work across the remaining days.</span>
              <form action={regeneratePlanAction}><input type="hidden" name="courseId" value={course.id} /><button className="btn btn-primary btn-sm">Reschedule missed work</button></form>
            </div>
          )}

          {upcoming.length === 0 ? (
            <p className="notice">No sessions are scheduled. {plan.warnings.length ? "See the notes above." : "Edit the exam details to rebuild the plan."}</p>
          ) : (
            <ol className="space-y-3">
              {[...byDate.entries()].map(([date, list]) => {
                const isToday = date === now;
                return (
                  <li key={date} className={`panel overflow-hidden ${isToday ? "!border-accent" : ""}`}>
                    <div className={`flex items-center justify-between px-4 py-2 text-sm ${isToday ? "bg-accent-soft" : "bg-surface-2"}`}>
                      <span className="font-semibold">{isToday ? "Today · " : ""}{formatDate(date, { weekday: "long", month: "short", day: "numeric" })}</span>
                      <span className="tnum text-muted">{list.reduce((n, s) => n + s.minutes, 0)} min</span>
                    </div>
                    <ul className="divide-y divide-line">
                      {list.map((s) => (
                        <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                          <div className="min-w-0 flex-1 basis-64">
                            <p className="flex flex-wrap items-center gap-2"><span className={`badge ${KIND[s.kind].tone}`}>{KIND[s.kind].label}</span><span className="tnum text-sm text-muted">{s.minutes} min</span>{s.status === "done" && <span className="badge badge-good"><Icon name="check" size={12} />Done</span>}</p>
                            <p className={`mt-1 ${s.status === "done" ? "text-muted line-through" : ""}`}>{s.title}</p>
                            {s.kind === "learn" && s.status !== "done" && (
                              <p className="mt-1 text-sm text-muted">Read first: {s.topicIds.filter((id) => topicName.has(id)).map((id, i) => <span key={id}>{i > 0 && ", "}<Link className="link" href={`/courses/${course.id}/practice/learn/${id}`}>{topicName.get(id)}</Link></span>)}</p>
                            )}
                          </div>
                          {s.status === "planned" && (
                            <ActionForm action={startPlanSession}>
                              <input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="planSessionId" value={s.id} />
                              <Submit className={`btn btn-sm ${isToday ? "btn-primary" : ""}`} pendingText="Starting…">{s.kind === "mock" ? "Start mock exam" : "Start practice"}</Submit>
                            </ActionForm>
                          )}
                          <form action={togglePlanSession}>
                            <input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="planSessionId" value={s.id} /><input type="hidden" name="to" value={s.status === "done" ? "planned" : "done"} />
                            <button className="btn btn-quiet btn-sm">{s.status === "done" ? "Undo" : "Mark done"}</button>
                          </form>
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
            </ol>
          )}
          <p className="text-sm text-muted">Last updated {plan.generatedAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. {doneCount} {doneCount === 1 ? "session" : "sessions"} completed. Update the plan after practising to re-weight it toward your weakest topics.</p>
          {earlier.length > 0 && (
            <details className="text-sm">
              <summary className="font-semibold text-muted">Earlier sessions ({earlier.length})</summary>
              <ul className="mt-2 space-y-1">
                {earlier.map((s) => <li key={s.id} className="flex gap-3"><span className="tnum w-24 shrink-0 text-muted">{formatDate(s.date)}</span><span className={`badge ${s.status === "done" ? "badge-good" : "badge-warn"}`}>{s.status === "done" ? "Done" : "Missed"}</span><span>{s.title}</span></li>)}
              </ul>
            </details>
          )}
        </>
      )}
    </div>
  );
}
