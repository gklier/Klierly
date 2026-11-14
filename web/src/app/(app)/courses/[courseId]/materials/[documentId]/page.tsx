import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { deleteDocumentAction } from "@/app/actions/courses";
import { ConfirmAction } from "@/components/forms";
import { Icon } from "@/components/icons";
import { requireUser } from "@/lib/auth";
import { getCourse } from "@/lib/courses";
import { locationLabel } from "@/lib/retrieval";

export const metadata = { title: "Source" };

export default async function DocumentPage({ params, searchParams }: { params: Promise<{ courseId: string; documentId: string }>; searchParams: Promise<{ chunk?: string }> }) {
  const user = await requireUser();
  const { courseId, documentId } = await params;
  const course = await getCourse(user.id, courseId);
  if (!/^[0-9a-f-]{36}$/.test(documentId)) notFound();
  const [doc] = await db.select().from(schema.sourceDocuments)
    .where(and(eq(schema.sourceDocuments.id, documentId), eq(schema.sourceDocuments.courseId, course.id), eq(schema.sourceDocuments.userId, user.id))).limit(1);
  if (!doc) notFound();
  const chunks = await db.select().from(schema.sourceChunks).where(eq(schema.sourceChunks.documentId, doc.id)).orderBy(asc(schema.sourceChunks.ordinal));
  const [job] = await db.select().from(schema.importJobs).where(eq(schema.importJobs.documentId, doc.id)).limit(1);
  const [mod] = doc.moduleId ? await db.select().from(schema.modules).where(eq(schema.modules.id, doc.moduleId)).limit(1) : [];
  const highlight = (await searchParams).chunk;
  const highlighted = highlight ? chunks.find((c) => c.id === highlight) : undefined;
  const safeUrl = doc.originUrl && /^https?:\/\//i.test(doc.originUrl) ? doc.originUrl : null;

  return (
    <article>
      <Link href={`/courses/${course.id}/materials`} className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink"><Icon name="back" size={14} />Materials</Link>
      <header className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold">{doc.title}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-muted">
            <span className="badge">{doc.kind === "file" ? doc.filename : doc.kind === "web" ? "Web capture" : "Pasted text"}</span>
            {mod && <span className="badge">{mod.name}</span>}
            {doc.parser && <span className="badge">{doc.parser} parser</span>}
            {doc.parserConfidence !== null && <span className={`badge ${doc.parserConfidence >= 0.9 ? "badge-good" : "badge-warn"}`}>Extraction {Math.round(doc.parserConfidence * 100)}%</span>}
            <span className="tnum">{chunks.length} excerpts · {doc.charCount.toLocaleString("en-US")} characters</span>
          </p>
          {safeUrl && <p className="mt-1.5 text-sm"><Icon name="link" className="mr-1 inline" /><a className="link break-all" href={safeUrl} target="_blank" rel="noopener noreferrer nofollow">{safeUrl}</a></p>}
        </div>
        <div className="flex gap-2">
          {doc.kind === "file" && <a className="btn btn-sm" href={`/api/documents/${doc.id}/file`} download>Download original</a>}
          <ConfirmAction action={deleteDocumentAction} hidden={{ courseId: course.id, documentId: doc.id, redirect: "1" }} label={<><Icon name="trash" />Delete</>} confirmLabel="Delete source"
            description="The file, its extracted text and its search index entries will be permanently deleted. Questions that cite only this source are removed too." />
        </div>
      </header>

      {doc.status === "failed" && <p role="alert" className="notice notice-bad mt-4"><strong>This source could not be processed.</strong> {doc.error}</p>}
      {(doc.status === "queued" || doc.status === "processing") && <p className="notice mt-4" role="status">This source is still being processed. Reload in a moment.</p>}
      {doc.warnings.length > 0 && <ul className="notice notice-warn mt-4 list-disc space-y-1 pl-8">{doc.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      {highlight && !highlighted && doc.status === "ready" && <p className="notice notice-warn mt-4">The cited excerpt is no longer in this source (it may have been re-imported). Nothing is highlighted rather than guessing.</p>}
      {highlighted && <p className="notice mt-4 text-sm">Showing the cited excerpt{locationLabel(highlighted) ? ` (${locationLabel(highlighted)})` : ""}. <a className="link" href={`#c-${highlighted.id}`}>Jump to it</a></p>}

      <p className="mt-5 text-sm text-muted">Extracted text, split into the excerpts used for search and citations. Compare with the original if anything looks wrong.</p>
      <ol className="mt-3 space-y-3">
        {chunks.map((c) => {
          const on = c.id === highlight;
          return (
            <li key={c.id} id={`c-${c.id}`} className={`scroll-mt-24 rounded-xl border p-4 ${on ? "border-accent bg-accent-soft" : "border-line bg-surface"}`} aria-current={on ? "true" : undefined}>
              <p className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="tnum font-semibold">#{c.ordinal + 1}</span>
                {locationLabel({ ...c, heading: null }) && <span className="badge">{locationLabel({ ...c, heading: null })}</span>}
                {c.heading && <span>{c.heading}</span>}
                {c.kind === "table" && <span className="badge">Table</span>}
                {on && <span className="badge badge-accent">Cited excerpt</span>}
              </p>
              {c.kind === "table" ? (
                <div className="overflow-x-auto"><pre className="text-[0.8rem] leading-relaxed">{c.text}</pre></div>
              ) : (
                <p className="whitespace-pre-wrap font-serif text-[1.02rem] leading-relaxed">{c.text}</p>
              )}
            </li>
          );
        })}
      </ol>

      {job && (
        <details className="mt-6 text-sm">
          <summary className="font-semibold text-muted">Import log</summary>
          <ul className="mt-2 space-y-0.5 text-muted">
            {job.log.map((l, i) => <li key={i} className="tnum">{new Date(l.at).toLocaleString("en-US")} — {l.msg}</li>)}
          </ul>
        </details>
      )}
    </article>
  );
}
