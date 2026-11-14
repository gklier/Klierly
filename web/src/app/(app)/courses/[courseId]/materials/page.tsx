import Link from "next/link";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema } from "@/db";
import type { ProposalPayload } from "@/db/schema";
import { addModule, addTopic, deleteDocumentAction, deleteModule, deleteTopic, resolveProposalAction, retryDocumentAction, setDocumentModule, setTopicModule } from "@/app/actions/courses";
import { ActionForm, ConfirmAction, Submit } from "@/components/forms";
import { organizeTopicsAction } from "@/app/actions/practice";
import { aiStatus } from "@/lib/ai/provider";
import { Icon } from "@/components/icons";
import { ImportPanel } from "@/components/import-panel";
import { AutoSubmitSelect } from "@/components/auto-submit";
import { requireUser } from "@/lib/auth";
import { getCourse, listModules, topicStates } from "@/lib/courses";
import { formatDate } from "@/lib/dates";
import { env } from "@/lib/env";
import { locationLabel, searchChunks } from "@/lib/retrieval";

export const metadata = { title: "Materials" };

const KIND_LABEL = { file: "File", paste: "Pasted", web: "Web capture" } as const;
const PROPOSAL_LABEL: Record<ProposalPayload["kind"], string> = { module: "Module", topic: "Topic", objective: "Learning objective", date: "Date", format: "Exam format" };

function proposalText(p: ProposalPayload): string {
  if (p.kind === "module" || p.kind === "topic") return p.name;
  if (p.kind === "objective") return p.text;
  if (p.kind === "format") return `${p.label} — ${[p.questionCount && `${p.questionCount} questions`, p.minutes && `${p.minutes} minutes`, p.points && `${p.points} points`, p.types?.length && p.types.join(", ")].filter(Boolean).join(", ")}`;
  return `${p.label}${p.yearAssumed ? " (year assumed from the term)" : ""}`;
}

function confidence(c: number | null) {
  if (c === null) return null;
  if (c >= 0.9) return <span className="badge badge-good" title="Share of the document with cleanly extracted text">Extraction {Math.round(c * 100)}%</span>;
  return <span className="badge badge-warn" title="Some pages had little or no extractable text">Extraction {Math.round(c * 100)}%</span>;
}

export default async function MaterialsPage({ params, searchParams }: { params: Promise<{ courseId: string }>; searchParams: Promise<{ q?: string }> }) {
  const user = await requireUser();
  const course = await getCourse(user.id, (await params).courseId);
  const q = ((await searchParams).q ?? "").trim().slice(0, 200);
  const [modules, docs, proposals, topics, objectives, ai] = await Promise.all([
    listModules(course.id),
    db.select().from(schema.sourceDocuments).where(eq(schema.sourceDocuments.courseId, course.id)).orderBy(desc(schema.sourceDocuments.createdAt)),
    db.select().from(schema.proposals).where(and(eq(schema.proposals.courseId, course.id), eq(schema.proposals.status, "pending"))).orderBy(asc(schema.proposals.createdAt)),
    topicStates(user.id, course.id),
    db.select().from(schema.learningObjectives).where(eq(schema.learningObjectives.courseId, course.id)).orderBy(asc(schema.learningObjectives.createdAt)),
    aiStatus(user.id),
  ]);
  const evidenceIds = [...proposals.map((p) => p.evidenceChunkId), ...objectives.map((o) => o.evidenceChunkId)].filter((x): x is string => Boolean(x));
  const evidence = evidenceIds.length
    ? await db.select({ id: schema.sourceChunks.id, documentId: schema.sourceChunks.documentId, title: schema.sourceDocuments.title, page: schema.sourceChunks.page, slide: schema.sourceChunks.slide, tStartMs: schema.sourceChunks.tStartMs, heading: schema.sourceChunks.heading })
        .from(schema.sourceChunks).innerJoin(schema.sourceDocuments, eq(schema.sourceDocuments.id, schema.sourceChunks.documentId)).where(inArray(schema.sourceChunks.id, evidenceIds))
    : [];
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const results = q ? await searchChunks({ userId: user.id, courseId: course.id, query: q, limit: 12 }) : [];
  const pending = docs.filter((d) => d.status === "queued" || d.status === "processing").length;
  const base = `/courses/${course.id}/materials`;
  const groups = [...modules.map((m) => ({ id: m.id as string | null, name: m.name })), { id: null, name: modules.length ? "Not assigned to a module" : "All sources" }];
  const topicsWithout = topics.filter((t) => !t.hasSources);
  const emptyModules = modules.filter((m) => !docs.some((d) => d.moduleId === m.id));
  const order = { module: 0, date: 1, format: 2, topic: 3, objective: 4 } as const;
  const sortedProposals = [...proposals].sort((a, b) => order[a.kind] - order[b.kind]);
  const Evidence = ({ id }: { id: string | null }) => {
    const e = id ? evidenceById.get(id) : undefined;
    if (!e) return null;
    return <Link className="link text-xs" href={`${base}/${e.documentId}?chunk=${e.id}#c-${e.id}`}>{e.title}{locationLabel(e) ? `, ${locationLabel(e)}` : ""}</Link>;
  };

  return (
    <div className="space-y-7">
      <div>
        <h1 className="text-2xl font-semibold">Materials</h1>
        <p className="mt-1 text-muted">Everything Klierly knows about this course comes from what you add here. It stays private to your account.</p>
      </div>

      <ImportPanel courseId={course.id} modules={modules.map((m) => ({ id: m.id, name: m.name }))} maxMb={Math.round(env.maxUploadBytes / 1048576)} pendingAtLoad={pending} />

      {sortedProposals.length > 0 && (
        <section className="panel p-4 sm:p-5" aria-labelledby="sugg-h">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 id="sugg-h" className="text-base font-semibold">Suggestions from your materials <span className="badge badge-accent ml-1">{sortedProposals.length}</span></h2>
              <p className="text-sm text-muted">Found in the text you imported. Nothing is applied until you accept it; open the source to check.</p>
            </div>
            <div className="flex gap-2">
              <form action={resolveProposalAction}><input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="proposalId" value="all" /><button className="btn btn-primary btn-sm" name="do" value="accept">Accept all</button></form>
              <form action={resolveProposalAction}><input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="proposalId" value="all" /><button className="btn btn-sm" name="do" value="dismiss">Dismiss all</button></form>
            </div>
          </div>
          <ul className="mt-3 divide-y divide-line">
            {sortedProposals.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className="badge w-36 justify-center">{PROPOSAL_LABEL[p.kind]}{p.payload.kind === "date" ? ` · ${p.payload.dateKind}` : ""}{p.payload.kind === "topic" && p.payload.via === "ai" ? " · AI" : ""}{p.payload.kind === "topic" && p.payload.via === "objective" ? " · objective" : ""}</span>
                <div className="min-w-0 flex-1 basis-64">
                  <p className="text-sm">{proposalText(p.payload)}{p.payload.kind === "date" && <span className="tnum text-muted"> → {formatDate(p.payload.date, { month: "short", day: "numeric", year: "numeric" })}</span>}</p>
                  {p.payload.kind === "topic" && p.payload.detail && <p className="text-xs text-muted">From the objective: {p.payload.detail}</p>}
                  <Evidence id={p.evidenceChunkId} />
                </div>
                <form action={resolveProposalAction} className="flex gap-1.5">
                  <input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="proposalId" value={p.id} />
                  <button className="btn btn-sm" name="do" value="accept" aria-label={`Accept ${PROPOSAL_LABEL[p.kind]}: ${proposalText(p.payload)}`}><Icon name="check" />Accept</button>
                  <button className="btn btn-sm btn-quiet" name="do" value="dismiss" aria-label={`Dismiss ${PROPOSAL_LABEL[p.kind]}: ${proposalText(p.payload)}`}><Icon name="x" /></button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="src-h">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="src-h" className="text-lg font-semibold">Sources <span className="tnum font-normal text-muted">({docs.length})</span></h2>
          <form className="flex gap-2" role="search" action={base}>
            <label className="sr-only" htmlFor="q">Search your materials</label>
            <input id="q" name="q" defaultValue={q} className="input w-56 sm:w-72" placeholder="Search inside your materials" />
            <button className="btn" type="submit"><Icon name="search" />Search</button>
          </form>
        </div>

        {q && (
          <div className="panel mt-3 p-4">
            <div className="flex items-center justify-between"><h3 className="font-semibold">{results.length ? `Excerpts matching “${q}”` : `Nothing in your materials matches “${q}”`}</h3><Link href={base} className="btn btn-sm btn-quiet">Clear</Link></div>
            <ul className="mt-2 divide-y divide-line">
              {results.map((r) => (
                <li key={r.id} className="py-3">
                  <Link href={`${base}/${r.documentId}?chunk=${r.id}#c-${r.id}`} className="group block">
                    <p className="text-sm font-medium group-hover:underline">{r.documentTitle}<span className="font-normal text-muted">{locationLabel(r) ? ` · ${locationLabel(r)}` : ""}</span></p>
                    <p className="mt-1 line-clamp-3 font-serif text-[0.98rem] text-muted">{r.text}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}

        {docs.length === 0 ? (
          <p className="notice mt-3">No sources yet. Upload a syllabus, lecture notes or slides above — the study plan and practice questions are built only from what you import.</p>
        ) : (
          <div className="mt-3 space-y-5">
            {groups.map((g) => {
              const list = docs.filter((d) => d.moduleId === g.id);
              if (!list.length) return null;
              return (
                <div key={g.id ?? "none"}>
                  <h3 className="mb-1.5 text-sm font-semibold text-muted">{g.name}</h3>
                  <ul className="panel divide-y divide-line">
                    {list.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                        <div className="min-w-0 flex-1 basis-60">
                          <Link href={`${base}/${d.id}`} className="font-medium hover:underline">{d.title}</Link>
                          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                            <span className="badge">{KIND_LABEL[d.kind]}</span>
                            {d.parser && <span className="badge">{d.parser.replace("paste-", "").toUpperCase()}</span>}
                            {d.status === "ready" && <>{confidence(d.parserConfidence)}<span className="tnum">{d.chunkCount} {d.chunkCount === 1 ? "excerpt" : "excerpts"}</span></>}
                            {(d.status === "queued" || d.status === "processing") && <span className="badge badge-warn"><span className="spinner" />Processing</span>}
                            {d.status === "failed" && <span className="badge badge-bad">Failed</span>}
                            {d.warnings.length > 0 && <span className="badge badge-warn" title={d.warnings.join(" ")}>{d.warnings.length} {d.warnings.length === 1 ? "warning" : "warnings"}</span>}
                          </p>
                          {d.error && <p className="mt-1 text-sm text-bad">{d.error}</p>}
                        </div>
                        {d.status === "failed" && (
                          <form action={retryDocumentAction}><input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="documentId" value={d.id} /><button className="btn btn-sm"><Icon name="refresh" />Try again</button></form>
                        )}
                        {modules.length > 0 && (
                          <form action={setDocumentModule}>
                            <input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="documentId" value={d.id} />
                            <AutoSubmitSelect name="moduleId" defaultValue={d.moduleId ?? ""} label={`Module for ${d.title}`} options={[{ value: "", label: "No module" }, ...modules.map((m) => ({ value: m.id, label: m.name }))]} />
                          </form>
                        )}
                        <ConfirmAction action={deleteDocumentAction} hidden={{ courseId: course.id, documentId: d.id }} label={<><Icon name="trash" /><span className="sr-only">Delete {d.title}</span></>} confirmLabel="Delete source"
                          description={`“${d.title}”, its extracted text and its search index entries will be permanently deleted. Questions that cite only this source are removed too.`} className="btn btn-quiet btn-sm btn-danger" />
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="grid items-start gap-5 lg:grid-cols-2" aria-label="Course structure">
        <div className="panel p-4 sm:p-5">
          <h2 className="text-base font-semibold">Modules</h2>
          <p className="text-sm text-muted">Used to group sources and to choose what an exam covers.</p>
          {modules.length === 0 ? <p className="mt-3 text-sm text-muted">No modules yet. Accept suggestions from a syllabus or add them by hand.</p> : (
            <ul className="mt-3 divide-y divide-line">
              {modules.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span>{m.name} <span className="text-muted">· {(() => { const n = docs.filter((d) => d.moduleId === m.id).length; return `${n} ${n === 1 ? "source" : "sources"}`; })()}</span></span>
                  <form action={deleteModule}><input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="moduleId" value={m.id} /><button className="btn btn-quiet btn-sm" aria-label={`Remove module ${m.name}`} title="Remove module (sources and topics are kept)"><Icon name="x" /></button></form>
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={addModule} className="mt-3" resetOnOk>
            <input type="hidden" name="courseId" value={course.id} />
            <div className="flex gap-2"><label className="sr-only" htmlFor="new-module">New module name</label><input id="new-module" name="name" className="input" placeholder="Module 5: Logistic regression" maxLength={120} required /><Submit className="btn">Add</Submit></div>
          </ActionForm>
        </div>

        <div className="panel p-4 sm:p-5">
          <h2 className="text-base font-semibold">Topics</h2>
          <p className="text-sm text-muted">What you practise and what progress is tracked by. Move a topic if it is under the wrong module.</p>
          {topics.length === 0 ? <p className="mt-3 text-sm text-muted">No topics yet. Accept topic suggestions above or add your own.</p> : (
            <ul className="mt-3 divide-y divide-line">
              {topics.map((t) => (
                <li key={t.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 py-2 text-sm">
                  <span className="min-w-0">{t.name} {!t.hasSources && <span className="badge badge-warn" title="No imported text mentions this topic">No material</span>}</span>
                  <form action={setTopicModule}>
                    <input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="topicId" value={t.id} />
                    <AutoSubmitSelect name="moduleId" defaultValue={t.moduleId ?? ""} label={`Module for topic ${t.name}`} options={[{ value: "", label: "No module" }, ...modules.map((m) => ({ value: m.id, label: m.name }))]} />
                  </form>
                  <form action={deleteTopic}><input type="hidden" name="courseId" value={course.id} /><input type="hidden" name="topicId" value={t.id} /><button className="btn btn-quiet btn-sm" aria-label={`Remove topic ${t.name}`} title="Remove topic"><Icon name="x" /></button></form>
                </li>
              ))}
            </ul>
          )}
          {docs.some((d) => d.status === "ready") && ai.kind && ai.available && course.allowExternalAi && (
            <ActionForm action={organizeTopicsAction} className="mt-3 border-t border-line pt-3">
              <input type="hidden" name="courseId" value={course.id} />
              <Submit className="btn" pendingText="Reading your material…"><Icon name="spark" />Suggest topics with AI</Submit>
              <p className="help">Headings alone often make poor topics. This sends short excerpts from across your sources to {ai.kind === "managed" ? ai.label : ai.host} (one request) and proposes real subjects for you to accept or dismiss. Nothing is added without your review.</p>
            </ActionForm>
          )}
          <ActionForm action={addTopic} className="mt-3" resetOnOk>
            <input type="hidden" name="courseId" value={course.id} />
            <div className="flex gap-2"><label className="sr-only" htmlFor="new-topic">New topic name</label><input id="new-topic" name="name" className="input" placeholder="Residual plots" maxLength={120} required /><Submit className="btn">Add</Submit></div>
          </ActionForm>
        </div>
      </section>

      <section className="panel p-4 sm:p-5" aria-labelledby="cov-h">
        <h2 id="cov-h" className="text-base font-semibold">Coverage</h2>
        {topics.length === 0 && docs.length === 0 ? <p className="mt-2 text-sm text-muted">Nothing to check yet.</p> : (
          <ul className="mt-2 space-y-1.5 text-sm">
            <li className="flex gap-2"><Icon name={topicsWithout.length ? "alert" : "check"} className={`mt-0.5 shrink-0 ${topicsWithout.length ? "text-warn" : "text-good"}`} />
              {topicsWithout.length ? <span>No imported text mentions: <strong>{topicsWithout.map((t) => t.name).join(", ")}</strong>. Questions and study notes cannot be written for these until you add material.</span> : <span>{topics.length ? `All ${topics.length} topics are supported by imported text.` : "No topics defined yet."}</span>}</li>
            {modules.length > 0 && <li className="flex gap-2"><Icon name={emptyModules.length ? "alert" : "check"} className={`mt-0.5 shrink-0 ${emptyModules.length ? "text-warn" : "text-good"}`} />
              {emptyModules.length ? <span>No sources assigned to: <strong>{emptyModules.map((m) => m.name).join(", ")}</strong>.</span> : <span>Every module has at least one source.</span>}</li>}
          </ul>
        )}
        {objectives.length > 0 && (
          <details className="mt-4">
            <summary className="text-sm font-semibold">Learning objectives from your materials ({objectives.length})</summary>
            <ul className="mt-2 space-y-1.5 text-sm">
              {objectives.map((o) => (
                <li key={o.id}><span className="text-muted">{modules.find((m) => m.id === o.moduleId)?.name.split(":")[0] ?? "Course"}:</span> {o.text} <Evidence id={o.evidenceChunkId} /></li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  );
}
