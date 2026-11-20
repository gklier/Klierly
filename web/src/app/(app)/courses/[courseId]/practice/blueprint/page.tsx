import Link from "next/link";
import { fillBlueprint, startBlueprintExam } from "@/app/actions/practice";
import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { aiStatus } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth";
import { getCourse } from "@/lib/courses";
import { buildBlueprint } from "@/lib/practice/blueprint";

export const metadata = { title: "Exam blueprint" };

export default async function BlueprintPage({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await requireUser();
  const course = await getCourse(user.id, (await params).courseId);
  const [bp, ai] = await Promise.all([buildBlueprint(user.id, course.id), aiStatus(user.id)]);
  const base = `/courses/${course.id}`;
  const available = bp.rows.reduce((n, r) => n + Math.min(r.available, r.target), 0);
  const missing = bp.rows.reduce((n, r) => n + r.shortfall, 0);
  const canGenerate = ai.kind && ai.available && course.allowExternalAi;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`${base}/practice`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><Icon name="back" size={14} />Practice</Link>
        <h1 className="mt-2 text-2xl font-semibold">Practice exam blueprint</h1>
        <p className="mt-1 text-muted">{bp.scope === "plan" ? "For the modules in your study plan." : "For every topic in this course."} How many questions each topic gets in a mock exam, and whether your question bank can supply them.</p>
      </div>
      <ul className="notice space-y-1 text-sm">{bp.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>

      {bp.rows.length === 0 ? (
        <p className="notice notice-warn">There are no topics with imported material in scope, so there is nothing to build a blueprint from. <Link className="link" href={`${base}/materials`}>Import material and confirm topics</Link> first.</p>
      ) : (
        <>
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[38rem] text-sm">
              <thead><tr className="border-b border-line text-left text-muted"><th className="px-4 py-2 font-medium">Topic</th><th className="px-3 py-2 font-medium">Share</th><th className="px-3 py-2 font-medium">Planned</th><th className="px-3 py-2 font-medium">In your bank</th><th className="px-3 py-2 font-medium">Still needed</th><th className="px-3 py-2 font-medium">Your mastery</th></tr></thead>
              <tbody className="divide-y divide-line">
                {bp.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2">{r.name}<span className="block text-xs text-muted">{r.moduleName?.split(":")[0] ?? "No module"} · {r.excerpts}{r.excerpts >= 40 ? "+" : ""} matching excerpts</span></td>
                    <td className="px-3 py-2"><span className="flex items-center gap-2"><span className="h-1.5 w-14 overflow-hidden rounded bg-surface-2"><span className="block h-full bg-accent" style={{ width: `${Math.round(r.share * 100)}%` }} /></span><span className="tnum">{Math.round(r.share * 100)}%</span></span></td>
                    <td className="tnum px-3 py-2">{r.target}</td>
                    <td className="tnum px-3 py-2">{r.available}</td>
                    <td className="px-3 py-2">{r.shortfall > 0 ? <span className="badge badge-warn tnum">{r.shortfall}</span> : <span className="badge badge-good">Covered</span>}</td>
                    <td className="tnum px-3 py-2">{r.attempts ? `${Math.round((r.mastery ?? 0) * 100)}%` : <span className="text-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-line font-semibold"><td className="px-4 py-2">Total</td><td /><td className="tnum px-3 py-2" data-testid="bp-total">{bp.total}</td><td className="tnum px-3 py-2">{bp.rows.reduce((n, r) => n + r.available, 0)}</td><td className="tnum px-3 py-2" data-testid="bp-missing">{missing}</td><td /></tr></tfoot>
            </table>
          </div>
          {bp.uncovered.length > 0 && <p className="notice notice-warn text-sm">Left out because no imported material covers them: <strong>{bp.uncovered.join(", ")}</strong>.</p>}

          <div className="grid gap-4 md:grid-cols-2">
            <section className="panel p-5">
              <h2 className="text-base font-semibold">1. Fill the gaps</h2>
              {!canGenerate ? (
                <p className="mt-1 text-sm text-muted">{missing === 0 ? "Your question bank covers this blueprint." : <>{missing} more {missing === 1 ? "question is" : "questions are"} needed. {!ai.kind ? ai.reason : !course.allowExternalAi ? "AI is switched off for this course in its settings." : ai.reason}</>}</p>
              ) : (
                // The form stays mounted after the gaps are filled so its result message remains visible.
                <ActionForm action={fillBlueprint} className="mt-1">
                  <input type="hidden" name="courseId" value={course.id} />
                  {missing === 0 ? <p className="text-sm text-muted">Your question bank covers this blueprint.</p> : (
                    <>
                      <p className="text-sm text-muted">{missing} more {missing === 1 ? "question is" : "questions are"} needed. Klierly writes them from your materials and discards any draft that fails its checks. Up to 8 topics per click.</p>
                      <Submit className="btn mt-3" pendingText="Generating and checking…"><Icon name="spark" />Generate the missing questions</Submit>
                    </>
                  )}
                </ActionForm>
              )}
            </section>
            <section className="panel p-5">
              <h2 className="text-base font-semibold">2. Take the mock exam</h2>
              <p className="mt-1 text-sm text-muted">{Math.min(bp.total, bp.rows.reduce((n, r) => n + r.available, 0))} questions in {bp.minutes} minutes, mixed to this blueprint{available < bp.total ? " as far as your bank allows" : ""}. Unseen questions come first. Nothing is graded or explained until you submit.</p>
              <ActionForm action={startBlueprintExam} className="mt-3">
                <input type="hidden" name="courseId" value={course.id} />
                <Submit pendingText="Starting…" disabled={bp.rows.reduce((n, r) => n + r.available, 0) < 3}><Icon name="clock" />Start the blueprint exam</Submit>
              </ActionForm>
            </section>
          </div>
        </>
      )}
    </div>
  );
}
