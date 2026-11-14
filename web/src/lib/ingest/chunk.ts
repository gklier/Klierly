import type { Segment } from "@/lib/worker";

export type Chunk = {
  ordinal: number; kind: "text" | "table"; text: string; heading: string | null;
  page: number | null; slide: number | null; tStartMs: number | null; tEndMs: number | null;
  charStart: number; charEnd: number;
};

const TARGET = 1000;
const MAX = 1400;

/** Split long text on paragraph, then sentence, then hard boundaries. */
export function splitText(text: string, max = MAX, target = TARGET): string[] {
  if (text.length <= max) return [text];
  const out: string[] = [];
  let cur = "";
  const push = () => { if (cur.trim()) out.push(cur.trim()); cur = ""; };
  const add = (piece: string, joiner: string) => {
    if (cur && cur.length + joiner.length + piece.length > target) push();
    cur = cur ? cur + joiner + piece : piece;
  };
  for (const para of text.split(/\n{2,}/)) {
    if (para.length <= max) { add(para, "\n\n"); continue; }
    const units = para.includes("\n") ? para.split("\n") : para.split(/(?<=[.!?])\s+/);
    const joiner = para.includes("\n") ? "\n" : " ";
    for (const u of units) {
      if (u.length <= max) { add(u, joiner); continue; }
      push();
      for (let i = 0; i < u.length; i += target) out.push(u.slice(i, i + target));
    }
    push();
  }
  push();
  return out;
}

const sameLocation = (a: Segment, b: Segment) =>
  a.kind === "text" && b.kind === "text" && a.heading === b.heading && a.page === b.page && a.slide === b.slide &&
  a.t_start_ms === null && b.t_start_ms === null;

/**
 * Turn parser segments into retrieval chunks. Provenance (page, slide,
 * timestamps, heading) is carried from the segment; charStart/charEnd are
 * offsets into the document text formed by joining chunks with "\n\n".
 */
export function chunkSegments(segments: Segment[]): Chunk[] {
  const merged: Segment[] = [];
  for (const s of segments) {
    const text = s.text.trim();
    if (!text) continue;
    const last = merged[merged.length - 1];
    if (last && sameLocation(last, s) && last.text.length + text.length + 2 <= TARGET) last.text = `${last.text}\n\n${text}`;
    else merged.push({ ...s, text });
  }
  const chunks: Chunk[] = [];
  let offset = 0;
  for (const s of merged) {
    for (const piece of splitText(s.text)) {
      chunks.push({
        ordinal: chunks.length, kind: s.kind, text: piece, heading: s.heading, page: s.page, slide: s.slide,
        tStartMs: s.t_start_ms, tEndMs: s.t_end_ms, charStart: offset, charEnd: offset + piece.length,
      });
      offset += piece.length + 2;
    }
  }
  return chunks;
}
