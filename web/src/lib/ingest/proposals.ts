import type { ProposalPayload } from "@/db/schema";

export type ProposalDraft = { payload: ProposalPayload; dedupeKey: string; chunkOrdinal: number };
type ChunkIn = { ordinal: number; text: string; heading: string | null; kind: "text" | "table" };

const MODULE_RE = /^(?:#+\s*)?((?:Module|Week|Unit|Chapter)\s+(\d{1,2}))\s*[:.\-–—]\s*(\S.{2,90}?)\s*$/i;
const OBJECTIVES_RE = /^(?:#+\s*)?(?:learning\s+)?(?:objectives|outcomes|goals)\s*:?\s*$/i;
const BULLET_RE = /^\s*(?:[-*•–]|\d{1,2}[.)])\s+(.{8,300})$/;
const GENERIC_HEADING = /^(introduction|intro|overview|summary|conclusion|references|schedule|grading|agenda|contents|table of contents|questions\??|learning objectives|objectives|modules|course description|example|examples|notes|worked example|appendix|recap|review|key points|key takeaways)\b/i;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE_TEXT_RE = new RegExp(`\\b${MONTH_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "i");
const DATE_NUM_RE = /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;
const EXAM_RE = /\b(exam|midterm|final|test)\b/i;
const DEADLINE_RE = /\b(due|deadline|quiz|homework|assignment|project)\b/i;
const COVERS_RE = /\bcovers?\s+(?:modules?|weeks?|units?|chapters?)\s+(\d{1,2})(?:\s*(?:[-–—]|to|through)\s*(\d{1,2}))?((?:\s*(?:,|and)\s*\d{1,2})*)/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const iso = (y: number, m: number, d: number) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
};

export function parseDateInLine(line: string, fallbackYear: number | null): { date: string; yearAssumed: boolean } | null {
  const t = DATE_TEXT_RE.exec(line);
  if (t) {
    const month = MONTHS.findIndex((m) => m.startsWith(t[1].toLowerCase().slice(0, 3))) + 1;
    const year = t[3] ? Number(t[3]) : fallbackYear;
    if (!year) return null;
    const date = iso(year, month, Number(t[2]));
    return date ? { date, yearAssumed: !t[3] } : null;
  }
  const n = DATE_NUM_RE.exec(line);
  if (n) {
    const date = iso(Number(n[3]), Number(n[1]), Number(n[2]));
    return date ? { date, yearAssumed: false } : null;
  }
  return null;
}

export function parseModulesCovered(line: string): number[] | undefined {
  const m = COVERS_RE.exec(line);
  if (!m) return undefined;
  const set = new Set<number>();
  const a = Number(m[1]);
  const b = m[2] ? Number(m[2]) : a;
  for (let i = Math.min(a, b); i <= Math.max(a, b) && set.size < 30; i++) set.add(i);
  for (const x of m[3]?.match(/\d{1,2}/g) ?? []) set.add(Number(x));
  return [...set].sort((x, y) => x - y);
}

export const termYear = (term: string | null | undefined) => {
  const m = /\b(20\d{2})\b/.exec(term ?? "");
  return m ? Number(m[1]) : null;
};

/**
 * Deterministic suggestions drawn only from what the document says. Every
 * suggestion carries the chunk it came from, and nothing is applied until the
 * student accepts it.
 */
export function proposeFromChunks(doc: { id: string; title: string }, chunks: ChunkIn[], opts: { termYear: number | null }): ProposalDraft[] {
  const drafts = new Map<string, ProposalDraft>();
  const put = (payload: ProposalPayload, key: string, chunkOrdinal: number) => {
    const k = `${payload.kind}:${key}`;
    if (!drafts.has(k)) drafts.set(k, { payload, dedupeKey: key.slice(0, 200), chunkOrdinal });
  };
  const isSyllabus = /syllabus|schedule|course outline/i.test(doc.title);
  let topicCount = 0;
  const seenHeadings = new Set<string>();

  for (const c of chunks) {
    const lines = [...(c.heading ? [c.heading] : []), ...c.text.split("\n")].map((l) => l.replace(/\s*\|\s*/g, " | ").trim());
    let currentModule: number | undefined;
    const headingModule = c.heading ? MODULE_RE.exec(c.heading) : null;
    if (headingModule) currentModule = Number(headingModule[2]);
    let inObjectives = false;

    for (const line of lines) {
      if (!line) { continue; }
      const mod = MODULE_RE.exec(line);
      if (mod && !EXAM_RE.test(line) && !/\bopens?\b|\bdue\b/i.test(line)) {
        const number = Number(mod[2]);
        const label = `${mod[1].replace(/\s+/g, " ")}: ${mod[3].replace(/\s+/g, " ")}`.replace(/^\w/, (ch) => ch.toUpperCase());
        put({ kind: "module", name: label, number }, `${norm(mod[1])}`, c.ordinal);
        currentModule = number;
        inObjectives = false;
        continue;
      }
      if (OBJECTIVES_RE.test(line)) { inObjectives = true; continue; }
      if (inObjectives) {
        const b = BULLET_RE.exec(line);
        if (b) { put({ kind: "objective", text: b[1].trim(), moduleNumber: currentModule }, norm(b[1]), c.ordinal); continue; }
        inObjectives = false;
      }
      const isExam = EXAM_RE.test(line);
      if ((isExam || DEADLINE_RE.test(line)) && line.length <= 200) {
        const d = parseDateInLine(line, opts.termYear);
        if (d) {
          const label = line.replace(/\s*\|\s*/g, " — ").replace(/[.\s]+$/, "");
          const cleaned = norm(label.replace(DATE_TEXT_RE, "").replace(DATE_NUM_RE, ""));
          put({ kind: "date", label, date: d.date, dateKind: isExam ? "exam" : "deadline", modulesCovered: parseModulesCovered(line), ...(d.yearAssumed ? { yearAssumed: true } : {}) },
            `${d.date}:${cleaned.split(" ").slice(0, 3).join(" ")}`, c.ordinal);
        }
      }
    }

    const h = c.heading?.trim();
    if (!isSyllabus && h && topicCount < 14) {
      const base = h.replace(/\s*\(speaker notes\)$/i, "");
      const key = norm(base);
      if (!seenHeadings.has(key)) {
        seenHeadings.add(key);
        const words = key.split(" ").length;
        if (base.length >= 4 && base.length <= 70 && words <= 8 && !GENERIC_HEADING.test(base) && !MODULE_RE.test(base) && norm(doc.title) !== key && /[a-z]{3}/i.test(base)) {
          put({ kind: "topic", name: base.replace(/^worked example:\s*/i, "").replace(/^\w/, (ch) => ch.toUpperCase()), documentId: doc.id }, key, c.ordinal);
          topicCount++;
        }
      }
    }
  }
  return [...drafts.values()];
}

/** "Module 2 notes.pdf" → 2 */
export function moduleNumberOf(name: string): number | null {
  const m = /\b(?:module|week|unit|chapter)[\s_-]*(\d{1,2})\b/i.exec(name);
  return m ? Number(m[1]) : null;
}
