import type { CitationView } from "@/lib/citations";

/** Source references. A citation whose source was deleted is shown as unavailable, never as a guess. */
export function CitationList({ citations, courseId, newTab }: { citations: CitationView[]; courseId: string; newTab?: boolean }) {
  if (!citations.length) return <p className="text-sm text-muted">No source reference is available for this item.</p>;
  return (
    <ul className="space-y-1.5 text-sm">
      {citations.map((c) => (
        <li key={c.chunkId} className="border-l-2 border-line pl-3">
          {c.available ? (
            <a className="link font-medium" href={`/courses/${courseId}/materials/${c.documentId}?chunk=${c.chunkId}#c-${c.chunkId}`} {...(newTab ? { target: "_blank", rel: "noopener" } : {})}>
              {c.title}{c.location ? `, ${c.location}` : ""}
            </a>
          ) : (
            <span className="text-muted">Source removed — this reference can no longer be opened.</span>
          )}
          {c.available && c.quote && <span className="block font-serif italic text-muted">“{c.quote}”</span>}
          {c.available && !c.quoteVerified && <span className="block text-xs text-muted">Linked to this excerpt; no exact quote was verified.</span>}
        </li>
      ))}
    </ul>
  );
}
