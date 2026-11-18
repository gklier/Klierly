import Link from "next/link";
import { reportAction, unshareAction } from "@/app/actions/sharing";
import { ActionForm, ConfirmAction, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { requireUser } from "@/lib/auth";
import { libraryFor } from "@/lib/classes";
import { getCourse } from "@/lib/courses";

export const metadata = { title: "Class library" };

export default async function LibraryPage({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await requireUser();
  const course = await getCourse(user.id, (await params).courseId);
  const { access, items } = await libraryFor(user.id, course.id);

  if (!access) {
    return (
      <div className="max-w-2xl space-y-3">
        <h1 className="text-2xl font-semibold">Class library</h1>
        <p className="notice">This course is not linked to a class yet. Open the course in Canvas, click the Klierly extension and choose <strong>Join the class library</strong>. An administrator must approve your membership before you can view shared summaries.</p>
        <p className="text-sm text-muted"><Link className="link" href="/terms/sharing">How sharing works</Link></p>
      </div>
    );
  }
  const modules = [...new Set(items.map((i) => i.moduleName ?? "Other"))];
  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Class library</h1>
        <p className="mt-1 text-muted">{access.label}. AI summaries that classmates chose to share, written in their own words. Not official course material; check anything important against your own notes.</p>
        <p className="mt-1 text-sm"><Link className="link" href="/terms/sharing">How sharing works</Link></p>
      </header>
      {!access.sharingEnabled && <p role="status" className="notice notice-warn">Sharing is turned off for this class.</p>}
      {!access.approved && <p role="status" className="notice notice-warn">Your membership is awaiting administrator approval.</p>}
      {access.approved && access.sharingEnabled && !access.active && <p role="status" className="notice notice-warn">Open this course in Canvas again with the extension to confirm you are still in the class. The library stays hidden until then.</p>}
      {access.active && access.sharingEnabled && items.length === 0 && <p className="notice">Nothing has been shared yet. Open one of your sources, create a summary, and share it to start the library.</p>}
      {modules.map((m) => (
        <section key={m}>
          <h2 className="text-lg font-semibold">{m}</h2>
          <ul className="mt-2 space-y-3">
            {items.filter((i) => (i.moduleName ?? "Other") === m).map((i) => (
              <li key={i.id} className="panel p-4" data-testid="shared-item">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{i.title}</h3>
                  <span className="flex items-center gap-1.5"><span className="badge">AI summary</span><span className="badge">{i.mine ? "Shared by you" : "A classmate"}</span></span>
                </div>
                <p className="mt-2">{i.body.overview}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[0.95rem]">{i.body.points.map((p, k) => <li key={k}>{p.text}{p.where && <span className="ml-1 text-xs text-muted">({p.where})</span>}</li>)}</ul>
                <div className="mt-3 flex justify-end">
                  {i.mine ? (
                    <ConfirmAction action={unshareAction} hidden={{ itemId: i.id, courseId: course.id }} label={<><Icon name="trash" />Take down</>} confirmLabel="Take down" description="Classmates will no longer see this summary. Your private copy stays." />
                  ) : (
                    <details className="text-sm">
                      <summary className="cursor-pointer text-muted hover:text-ink">Report</summary>
                      <ActionForm action={reportAction} className="mt-2 flex flex-wrap items-center gap-2">
                        <input type="hidden" name="itemId" value={i.id} /><input type="hidden" name="courseId" value={course.id} />
                        <input name="reason" className="input" maxLength={500} placeholder="What is wrong? e.g. copies the lecture, looks like exam content" aria-label="Reason" required />
                        <Submit className="btn btn-sm" pendingText="Sending…">Send report</Submit>
                      </ActionForm>
                    </details>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
