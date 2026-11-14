import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { generateNoteAction, startPractice } from "@/app/actions/practice";
import { CitationList } from "@/components/citations";
import { ActionForm, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { getProvider } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth";
import { expandCitations } from "@/lib/citations";
import { getCourse } from "@/lib/courses";
import { chunksForTopic, locationLabel } from "@/lib/retrieval";

export const metadata = { title: "Learn" };

export default async function LearnPage({ params }: { params: Promise<{ courseId: string; topicId: string }> }) {
  const user = await requireUser();
  const { courseId, topicId } = await params;
  const course = await getCourse(user.id, courseId);
  if (!/^[0-9a-f-]{36}$/.test(topicId)) notFound();
  const [topic] = await db.select().from(schema.topics).where(and(eq(schema.topics.id, topicId), eq(schema.topics.courseId, course.id), eq(schema.topics.userId, user.id))).limit(1);
  if (!topic) notFound();
  const [[note], chunks, provider, questions] = await Promise.all([
    db.select().from(schema.learnNotes).where(eq(schema.learnNotes.topicId, topic.id)).limit(1),
    chunksForTopic({ userId: user.id, courseId: course.id, topicName: topic.name, moduleId: topic.moduleId, limit: 4 }),
    getProvider(user.id),
    db.select({ id: schema.questions.id }).from(schema.questions).where(and(eq(schema.questions.topicId, topic.id), eq(schema.questions.status, "active"))),
  ]);
  const cites = note ? await expandCitations(note.body.keyPoints.map((k) => k.citations)) : [];
  const base = `/courses/${course.id}`;

  return (
    <article className="max-w-2xl">
      <Link href={`${base}/practice`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><Icon name="back" size={14} />Practice</Link>
      <h1 className="mt-2 text-2xl font-semibold">{topic.name}</h1>

      {chunks.length === 0 && !note ? (
        <p className="notice notice-warn mt-4"><strong>No imported material mentions this topic.</strong> CourseLab will not explain a topic from general knowledge and present it as your course. <Link className="link" href={`${base}/materials`}>Import notes or slides that cover it</Link>.</p>
      ) : (
        <>
          {note ? (
            <section className="mt-4" aria-labelledby="note-h">
              <p className="flex flex-wrap items-center gap-2"><span className="badge">{note.origin === "ai" ? "AI-generated from your materials" : "Written for the sample course"}</span></p>
              <h2 id="note-h" className="sr-only">Study note</h2>
              <p className="reading mt-3">{note.body.summary}</p>
              <ol className="mt-5 space-y-5">
                {note.body.keyPoints.map((k, i) => (
                  <li key={i}><p className="reading !text-[1.06rem]">{k.text}</p><div className="mt-1.5"><CitationList citations={cites[i] ?? []} courseId={course.id} /></div></li>
                ))}
              </ol>
            </section>
          ) : (
            <p className="notice mt-4">There is no study note for this topic yet. Below are the passages from your materials that match it most closely.{!provider && <> <strong>An AI key is required to generate a summarised note.</strong> <Link className="link" href="/settings#ai">Connect a provider</Link>.</>}</p>
          )}

          {provider && course.allowExternalAi && chunks.length > 0 && (
            <ActionForm action={generateNoteAction} className="mt-5">
              <input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="topicId" value={topic.id} />
              <Submit className="btn" pendingText="Writing from your sources…"><Icon name="spark" />{note ? "Regenerate the note with AI" : "Generate a study note with AI"}</Submit>
              <p className="help">Sends up to 6 short excerpts to {new URL(provider.baseUrl).host}. Points that cannot be tied to a source are dropped.</p>
            </ActionForm>
          )}

          {chunks.length > 0 && (
            <section className="mt-8" aria-labelledby="src-h">
              <h2 id="src-h" className="text-lg font-semibold">In your materials</h2>
              <ul className="mt-2 space-y-3">
                {chunks.map((c) => (
                  <li key={c.id} className="rounded-xl border border-line bg-surface p-4">
                    <Link className="link text-sm font-medium" href={`${base}/materials/${c.documentId}?chunk=${c.id}#c-${c.id}`}>{c.documentTitle}{locationLabel(c) ? `, ${locationLabel(c)}` : ""}</Link>
                    {c.kind === "table" ? <pre className="mt-1.5 overflow-x-auto text-xs">{c.text.split("\n").slice(0, 8).join("\n")}</pre> : <p className="mt-1.5 line-clamp-6 whitespace-pre-wrap font-serif text-[1rem] leading-relaxed">{c.text}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      <section className="mt-8 border-t border-line pt-5">
        <h2 className="text-lg font-semibold">Now test yourself</h2>
        {questions.length === 0 ? (
          <p className="mt-1 text-muted">No questions exist for this topic yet. <Link className="link" href={`${base}/practice#gen-h`}>Generate some</Link>.</p>
        ) : (
          <ActionForm action={startPractice} className="mt-2">
            <input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="mode" value="drill" /><input type="hidden" name="topicIds" value={topic.id} />
            <input type="hidden" name="count" value={Math.min(6, questions.length)} />
            <Submit pendingText="Starting…">Practise {Math.min(6, questions.length)} questions on this topic</Submit>
          </ActionForm>
        )}
      </section>
    </article>
  );
}
