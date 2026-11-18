import Link from "next/link";
import { createCourse } from "@/app/actions/courses";
import { ActionForm, Submit } from "@/components/forms";

export const metadata = { title: "New course" };

export default function NewCoursePage() {
  return (
    <div className="mx-auto max-w-xl">
      <h1 className="text-2xl font-semibold">New course</h1>
      <p className="mt-1 text-muted">Only the name is required. Everything here can be changed later, and nothing is assumed about your course until you import its material.</p>
      <ActionForm action={createCourse} className="panel mt-6 space-y-4 p-5">
        <div>
          <label className="label" htmlFor="name">Course name</label>
          <input className="input" id="name" name="name" required maxLength={160} placeholder="QMB 3250 – Statistics for Business Decisions" autoFocus />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="term">Term <span className="font-normal text-muted">(optional)</span></label><input className="input" id="term" name="term" maxLength={60} placeholder="Fall 2026" /></div>
          <div>
            <label className="label" htmlFor="examDate">Tentative exam date <span className="font-normal text-muted">(optional)</span></label>
            <input className="input" id="examDate" name="examDate" type="date" />
          </div>
        </div>
        <div>
          <label className="label" htmlFor="goal">Your goal <span className="font-normal text-muted">(optional)</span></label>
          <textarea className="input" id="goal" name="goal" rows={2} maxLength={500} placeholder="For example: be able to read regression output without notes" />
        </div>
        <div className="flex gap-2"><Submit pendingText="Creating…">Create course</Submit><Link href="/" className="btn btn-quiet">Cancel</Link></div>
      </ActionForm>
    </div>
  );
}
