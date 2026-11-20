import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { buildGuideAction, startStudyingAction } from "@/app/actions/learn";
import { ActionForm, Submit } from "@/components/forms";
import { BuildPoller } from "@/components/learn-progress";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { getCourse } from "@/lib/courses";
import { suggestModules } from "@/lib/learn/pipeline";
import { conceptList, guideStatus } from "@/lib/learn/service";

export const metadata = { title: "Learn" };
const LABEL: Record<string, string> = { new: "Not started", learning: "Learning", practiced: "Practiced", solid: "Solid" };

export default async function LearnPage({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await requireUser();
  const course = await getCourse(user.id, (await params).courseId);
  const status = await guideStatus(user.id, course.id);
  const modules = await db.select().from(schema.modules).where(eq(schema.modules.courseId, course.id)).orderBy(asc(schema.modules.position));
  const build = status.build;
  const running = build?.status === "queued" || build?.status === "running";

  if (running) {
    const pct = build!.total ? Math.round((build!.done / build!.total) * 100) : 5;
    return (
      <div className="max-w-2xl space-y-4">
        <h1 className="text-2xl font-semibold">Building your study guide</h1>
        <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Study guide progress" className="h-3 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
        <p className="text-muted" role="status" data-testid="build-status">{build!.stage === "analyze" ? "Reading your course materials…" : build!.stage === "concepts" ? "Finding the concepts…" : `Writing lessons and questions… ${build!.done} of ${build!.total}`}</p>
        <p className="text-sm text-muted">You can leave this page. The guide keeps building and will be here when you come back.</p>
        <BuildPoller active />
      </div>
    );
  }

  const picker = async () => {
    const sugg = await suggestModules(user.id, course.id);
    const built = new Set((await conceptList(user.id, course.id)).length ? (await db.select({ m: schema.lmConcepts.moduleId }).from(schema.lmConcepts).where(eq(schema.lmConcepts.courseId, course.id))).map((r) => r.m) : []);
    return (
      <ActionForm action={buildGuideAction} className="panel space-y-4 p-5">
        <input type="hidden" name="courseId" value={course.id} />
        <fieldset>
          <legend className="text-base font-semibold">Which modules are you studying?</legend>
          <p className="mt-1 text-sm text-muted">{sugg.note ?? "Pre-selected from your exam information. Change anything you like."}</p>
          {modules.length === 0 ? <p className="notice mt-3">Import your course first, then come back. Klierly builds the guide from what you imported.</p> : (
            <ul className="mt-3 space-y-1.5">
              {modules.map((m) => (
                <li key={m.id}>
                  <label className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-surface-2">
                    <input type="checkbox" name="moduleIds" value={m.id} defaultChecked={Boolean(sugg.why[m.id])} className="mt-1 size-4 accent-[var(--accent)]" />
                    <span><span className="font-medium">{m.name}</span>
                      {built.has(m.id) && <span className="badge ml-2">Already built</span>}
                      {sugg.why[m.id] && <span className="block text-xs text-muted" title={sugg.why[m.id]}>Why: {sugg.why[m.id]}</span>}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </fieldset>
        {modules.length > 0 && <Submit className="btn btn-primary btn-lg" pendingText="Starting…">Build my study guide</Submit>}
      </ActionForm>
    );
  };

  if (!status.ready) {
    return (
      <div className="max-w-2xl space-y-5">
        <h1 className="text-2xl font-semibold">Learn</h1>
        {build?.status === "failed" && <p role="alert" className="notice notice-bad"><strong>The last build did not finish.</strong> {build.error}</p>}
        <p className="text-muted">Pick the modules you are studying. Klierly builds the whole guide in one go: lessons, worked examples, guided practice and a large bank of checked questions. No further setup.</p>
        {await picker()}
      </div>
    );
  }

  const concepts = await conceptList(user.id, course.id);
  const analysis = (build?.analysis ?? null) as { conflicts?: { issue: string }[]; uncertainties?: string[]; missing_or_unavailable_materials?: { what: string; why: string }[] } | null;
  const notes = [...(analysis?.conflicts ?? []).map((c) => c.issue), ...(analysis?.missing_or_unavailable_materials ?? []).map((m) => `${m.what}: ${m.why}`), ...(analysis?.uncertainties ?? [])];
  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Learn</h1>
        <p className="mt-1 text-muted" data-testid="guide-counts">{status.concepts} concepts · {status.questions.toLocaleString("en-US")} practice questions ready ({status.numeric.toLocaleString("en-US")} calculation, {status.mcq + status.scenario} conceptual and matching)</p>
      </header>
      <ActionForm action={startStudyingAction}>
        <input type="hidden" name="courseId" value={course.id} />
        <Submit className="btn btn-primary w-full justify-center py-5 text-xl tracking-wide" pendingText="Opening…">STUDY FOR MY EXAM</Submit>
      </ActionForm>
      <ol className="panel divide-y divide-line" aria-label="Learning path">
        {concepts.map((c, i) => (
          <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="tnum w-6 text-muted">{i + 1}</span><span className="flex-1">{c.title}</span>
            <span className={`badge ${c.status === "solid" ? "badge-good" : c.status === "practiced" ? "badge-accent" : ""}`}>{LABEL[c.status]}</span>
          </li>
        ))}
      </ol>
      {notes.length > 0 && (
        <details className="panel p-4 text-sm"><summary className="cursor-pointer font-semibold">Things Klierly could not settle from your materials ({notes.length})</summary>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-muted">{notes.map((n, i) => <li key={i}>{n}</li>)}</ul></details>
      )}
      <details className="text-sm"><summary className="cursor-pointer text-muted">Add more modules</summary><div className="mt-3">{await picker()}</div></details>
      <p className="text-xs text-muted"><Link className="link" href={`/courses/${course.id}/practice`}>Classic practice</Link> is still available.</p>
    </div>
  );
}
