import Link from "next/link";
import { CourseNav } from "@/components/course-nav";
import { Icon } from "@/components/icons";
import { requireUser } from "@/lib/auth";
import { getCourse, pendingProposalCount } from "@/lib/courses";

export default async function CourseLayout({ children, params }: { children: React.ReactNode; params: Promise<{ courseId: string }> }) {
  const user = await requireUser();
  const course = await getCourse(user.id, (await params).courseId);
  const pending = await pendingProposalCount(course.id);
  return (
    <div className="lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:gap-10">
      <aside className="mb-5 lg:sticky lg:top-20 lg:mb-0 lg:self-start">
        <Link href="/" className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><Icon name="back" size={14} />All courses</Link>
        <Link href={`/courses/${course.id}`} className="mb-3 block text-base font-semibold leading-snug">{course.name}</Link>
        {course.isSample && <p className="badge badge-accent mb-3">Synthetic sample</p>}
        <CourseNav courseId={course.id} pendingSuggestions={pending} />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
