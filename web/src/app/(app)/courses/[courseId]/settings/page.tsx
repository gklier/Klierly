import { deleteCourseAction, updateCourse } from "@/app/actions/courses";
import { leaveClassAction, unlinkCourseAction } from "@/app/actions/sharing";
import { ActionForm, ConfirmAction, Submit } from "@/components/forms";
import { requireUser } from "@/lib/auth";
import { classAccessForCourse } from "@/lib/classes";
import { getCourse } from "@/lib/courses";

export const metadata = { title: "Course settings" };

export default async function CourseSettings({ params }: { params: Promise<{ courseId: string }> }) {
  const user = await requireUser();
  const course = await getCourse(user.id, (await params).courseId);
  const access = await classAccessForCourse(user.id, course.id);
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">Course settings</h1>
      <ActionForm action={updateCourse} className="panel space-y-4 p-5">
        <input type="hidden" name="courseId" value={course.id} />
        <div><label className="label" htmlFor="name">Course name</label><input id="name" name="name" className="input" required maxLength={160} defaultValue={course.name} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><label className="label" htmlFor="term">Term</label><input id="term" name="term" className="input" maxLength={60} defaultValue={course.term ?? ""} /></div>
          <div><label className="label" htmlFor="examDate">Tentative exam date</label><input id="examDate" name="examDate" type="date" className="input" defaultValue={course.examDate ?? ""} /><p className="help">The confirmed date lives in the study plan.</p></div>
        </div>
        <div><label className="label" htmlFor="goal">Your goal</label><textarea id="goal" name="goal" rows={2} className="input" maxLength={500} defaultValue={course.goal ?? ""} /></div>

        <fieldset className="rounded-lg border border-line p-4">
          <legend className="px-1 text-sm font-semibold">Course rules</legend>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" name="allowExternalAi" defaultChecked={course.allowExternalAi} className="mt-1 size-4 accent-[var(--accent)]" />
            <span>Excerpts of this course&apos;s material may be sent to the AI provider I connected. <span className="text-muted">Untick this if your instructor, institution or the material&apos;s copyright terms do not allow sharing it with outside services. Search, practice with existing questions, the study plan and progress keep working; generating new questions and notes is switched off.</span></span>
          </label>
          <div className="mt-3"><label className="label" htmlFor="integrityNote">Notes on what this course allows <span className="font-normal text-muted">(for your own reference)</span></label>
            <textarea id="integrityNote" name="integrityNote" rows={2} className="input" maxLength={1000} defaultValue={course.integrityNote ?? ""} placeholder="e.g. Syllabus allows AI tools for studying, not for graded work" /></div>
        </fieldset>
        <Submit pendingText="Saving…">Save changes</Submit>
      </ActionForm>

      <section className="panel p-5" data-testid="class-link">
        <h2 className="text-base font-semibold">Class library</h2>
        {access ? (
          <>
            <p className="mt-1 text-sm text-muted">Linked to <strong>{access.label}</strong>. {access.active ? "Your claim is current." : "Open the course in Canvas again with the extension to confirm you are still in the class."}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <ConfirmAction action={unlinkCourseAction} hidden={{ courseId: course.id }} label="Unlink this course" confirmLabel="Unlink" description="This course stops being linked to the class. What you already shared stays until you take it down." className="btn btn-sm" />
              <ConfirmAction action={leaveClassAction} hidden={{ classId: access.classId, courseId: course.id }} label="Leave the class" confirmLabel="Leave the class" description="Everything you shared with this class is taken down and your courses are unlinked." />
            </div>
          </>
        ) : (
          <p className="mt-1 text-sm text-muted">Not linked. Open this course in Canvas, click the Klierly extension and choose <strong>Join the class library</strong> to share summaries with classmates and read theirs.</p>
        )}
      </section>

      <section className="panel p-5">
        <h2 className="text-base font-semibold">Delete this course</h2>
        <p className="mt-1 text-sm text-muted">Removes the course with all of its uploaded files, extracted text, search index, questions, study plan and practice history. This cannot be undone.</p>
        <div className="mt-3"><ConfirmAction action={deleteCourseAction} hidden={{ courseId: course.id }} label="Delete course" confirmLabel="Delete course" description={`“${course.name}” and everything in it will be permanently deleted.`} className="btn btn-danger" /></div>
      </section>
    </div>
  );
}
