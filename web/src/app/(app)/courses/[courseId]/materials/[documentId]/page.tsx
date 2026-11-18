import { ProcessingStatus } from "@/components/processing-status";
import Link from "next/link";
import { notFound } from "next/navigation";
import { and, asc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { deleteDocumentAction } from "@/app/actions/courses";
import { createSummaryAction, shareSummaryAction, unshareAction } from "@/app/actions/sharing";
import { ActionForm, ConfirmAction, Submit } from "@/components/forms";
import { Icon } from "@/components/icons";
import { requireUser } from "@/lib/auth";
import { classAccessForCourse, sharedStateForDocument } from "@/lib/classes";
import { getCourse } from "@/lib/courses";
import { looksLikeAssessmentMaterial } from "@/lib/sharing-rules";
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
  const [summary] = await db.select().from(schema.sourceSummaries).where(eq(schema.sourceSummaries.documentId, doc.id)).limit(1);
  const access = await classAccessForCourse(user.id, course.id);
  const shared = summary ? await sharedStateForDocument(user.id, doc.id) : null;
  const assessmentLike = looksLikeAssessmentMaterial(doc.title, doc.filename);
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
      {(doc.status === "queued" || doc.status === "processing") && <ProcessingStatus />}
      {doc.warnings.length > 0 && <ul className="notice notice-warn mt-4 list-disc space-y-1 pl-8">{doc.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
      {highlight && !highlighted && doc.status === "ready" && <p className="notice notice-warn mt-4">The cited excerpt is no longer in this source (it may have been re-imported). Nothing is highlighted rather than guessing.</p>}
      {highlighted && <p className="notice mt-4 text-sm">Showing the cited excerpt{locationLabel(highlighted) ? ` (${locationLabel(highlighted)})` : ""}. <a className="link" href={`#c-${highlighted.id}`}>Jump to it</a></p>}

      {doc.status === "ready" && (
        <section className="panel mt-5 p-5" aria-labelledby="sum-h" data-testid="summary-card">
          <h2 id="sum-h" className="text-base font-semibold">Summary in your own library</h2>
          {!summary ? (
            <>
              <p className="mt-1 text-sm text-muted">An AI writes a short summary of this source in its own words. It stays private until you choose to share it with your class.</p>
              <ActionForm action={createSummaryAction} className="mt-3">
                <input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="documentId" value={doc.id} />
                <Submit className="btn btn-sm" pendingText="Summarising…"><Icon name="spark" />Create summary</Submit>
              </ActionForm>
            </>
          ) : (
            <>
              <p className="mt-2">{summary.body.overview}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[0.95rem]">{summary.body.points.map((p, i) => <li key={i}>{p.text}{p.where && <span className="ml-1 text-xs text-muted">({p.where})</span>}</li>)}</ul>
              <p className="mt-2 text-xs text-muted">AI-written, may contain mistakes. Check it against the source below.</p>
              <div className="mt-4 border-t border-line pt-4 text-sm">
                {shared ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <span className={`badge ${shared.status === "active" ? "badge-good" : "badge-warn"}`}>{shared.status === "active" ? `Shared with ${access?.label ?? "your class"}` : "Hidden after reports"}</span>
                    <ConfirmAction action={unshareAction} hidden={{ itemId: shared.id, courseId: course.id }} label="Take down" confirmLabel="Take down" description="Classmates will no longer see this summary." />
                  </div>
                ) : assessmentLike ? (
                  <p className="text-muted">This looks like an exam, quiz or answer key, so it cannot be shared.</p>
                ) : !access ? (
                  <p className="text-muted">To share with your class, open the course in Canvas and use <strong>Join the class library</strong> in the extension.</p>
                ) : !access.active || !access.sharingEnabled ? (
                  <p className="text-muted">{access.sharingEnabled ? "Open the course in Canvas again with the extension to confirm you are still in the class." : "Sharing is turned off for this class."}</p>
                ) : (
                  <ActionForm action={shareSummaryAction} className="space-y-3">
                    <input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="documentId" value={doc.id} />
                    <label className="flex items-start gap-2.5">
                      <input type="checkbox" name="agree" className="mt-1 size-4 accent-[var(--accent)]" />
                      <span>I want to share this summary with <strong>{access.label}</strong>. It is not an exam, quiz or answer key, and my instructor or school does not prohibit sharing study notes. I accept the <a className="link" href="/terms/sharing" target="_blank" rel="noopener">class library terms</a>.</span>
                    </label>
                    <Submit className="btn btn-primary btn-sm" pendingText="Sharing…">Share with class</Submit>
                  </ActionForm>
                )}
              </div>
            </>
          )}
        </section>
      )}

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
