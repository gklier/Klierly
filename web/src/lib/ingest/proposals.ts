import type { ProposalPayload } from "@/db/schema";

export type ProposalDraft = { payload: ProposalPayload; dedupeKey: string; chunkOrdinal: number };
type ChunkIn = { ordinal: number; text: string; heading: string | null; kind: "text" | "table" };

const MODULE_RE = /^(?:#+\s*)?((?:Module|Week|Unit|Chapter)\s+(\d{1,2}))\s*[:.\-–—]\s*(\S.{2,90}?)\s*$/i;
const OBJECTIVES_RE = /^(?:#+\s*)?(?:learning\s+)?(?:objectives|outcomes|goals)\s*:?\s*$/i;
const BULLET_RE = /^\s*(?:[-*•–]|\d{1,2}[.)])\s+(.{8,300})$/;
const GENERIC_HEADING = /^(introduction|intro|overview|summary|conclusion|references|schedule|grading|agenda|contents|table of contents|questions\??|learning objectives|objectives|modules|course description|example|examples|notes|worked example|appendix|recap|review|key points|key takeaways)\b/i;
/** Headings that are structure or housekeeping, not something to study. */
const NOT_A_TOPIC = new Set(["plan", "do", "report", "mechanics", "hypotheses", "hypothesis", "assumptions", "conclusion", "conclusions", "resources", "data", "ranks", "steps", "results", "output", "solution", "solutions",
  "practice", "to do", "view all pages", "next steps", "instructions", "readings", "reading", "videos", "video", "lecture", "lectures", "slides", "homework", "announcements", "data sets", "datasets", "files", "links"]);
const FILE_NAME = /\.(docx?|pptx?|xlsx?|pdf|csv|txt|jmp|zip|mp4|mov|html?)$/i;

/** Is this heading worth offering as a study topic? Conservative: a missed topic can be added by hand, a junk one erodes trust. */
export function isTopicHeading(raw: string, docTitle = ""): boolean {
  const base = raw.replace(/\s*\(speaker notes\)$/i, "").trim();
  const key = norm(base);
  const words = key.split(" ").filter(Boolean);
  if (base.length < 4 || base.length > 70 || words.length > 8 || !/[a-z]{3}/i.test(base)) return false;
  if (FILE_NAME.test(base) || GENERIC_HEADING.test(base) || MODULE_RE.test(base) || key === norm(docTitle)) return false;
  // "1. Plan", "Step 3: Report", "Part B" — numbered steps of a worked example or outline.
  const unnumbered = key.replace(/^(step|part|section|example|question|problem)?\s*(\d+|[a-d])\b\s*/, "").trim();
  if (!unnumbered || NOT_A_TOPIC.has(unnumbered) || NOT_A_TOPIC.has(key)) return false;
  if (unnumbered !== key && unnumbered.split(" ").length <= 2) return false;
  // One-word headings are usually labels ("Ranks", "Notes"); keep long terms and acronyms ("Multicollinearity", "ANOVA").
  if (words.length === 1 && !(base.length >= 9 || /^[A-Z]{4,}$/.test(base))) return false;
  return true;
}

const OBJECTIVE_VERBS = "conduct|perform|run|carry out|explain|describe|distinguish|determine|identify|interpret|compare|contrast|use|apply|calculate|compute|construct|build|create|evaluate|assess|understand|recognize|recognise|define|state|summarize|summarise|select|choose|test|estimate|predict|forecast|analyze|analyse|derive|check|diagnose|justify|decide|differentiate|formulate|write|make";
const OBJECTIVE_START = new RegExp(`^(?:${OBJECTIVE_VERBS})\\b`, "i");
const STOP_TOKENS = new Set(["the", "and", "for", "with", "from", "that", "this", "test", "tests", "vs", "versus", "using", "into", "statistic", "statistics"]);

/** "Conduct a Kruskal Wallace test, including stating a hypothesis…" → "Kruskal Wallace test". The full objective is kept alongside. */
export function topicFromObjective(text: string): string {
  let t = text.replace(/\s+/g, " ").trim().replace(/[.;:]+$/, "");
  t = t.replace(/,?\s+(including|such as|e\.g\.|by|in order to|so that)\b.*$/i, "");
  const when = /^(?:determine|decide|identify|recognize|recognise|know)\s+when\s+(?:to\s+)?(?:use|apply)\s+(?:the\s+)?(.+)$/i.exec(t);
  if (when) t = `When to use ${when[1].replace(/\s+(appropriately|correctly|properly)$/i, "")}`;
  else {
    t = t.replace(new RegExp(`^(?:${OBJECTIVE_VERBS})(?:\\s+and\\s+(?:${OBJECTIVE_VERBS}))?\\s+`, "i"), "").replace(/^(?:an?|the|how to|what|why)\s+/i, "").replace(/\s+(appropriately|correctly|properly)$/i, "");
  }
  t = t.trim();
  if (t.length > 80) t = t.slice(0, 80).replace(/\s+\S*$/, "");
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : text.slice(0, 80);
}

const topicTokens = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 2 && !STOP_TOKENS.has(w)));

/** Do two topic names describe the same subject? Token overlap, forgiving of "Test"/"Statistic" and word order. */
export function sameTopic(a: string, b: string): boolean {
  const A = topicTokens(a), B = topicTokens(b);
  if (!A.size || !B.size) return norm(a) === norm(b);
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter) >= 0.6 || (inter >= 2 && inter / Math.min(A.size, B.size) >= 0.85);
}

export type ExamFacts = { questionCount?: number; minutes?: number; points?: number; types?: string[] };
const TYPE_WORDS: [RegExp, string][] = [[/multiple[- ]choice|\bmcq?\b/i, "multiple choice"], [/true\s*\/?\s*false/i, "true/false"], [/short[- ]answer/i, "short answer"], [/free[- ]response|essay/i, "free response"], [/numeric|calculation/i, "numeric"], [/\bproblems?\b/i, "problems"]];

/** Exam structure stated in one line of a syllabus: how many questions, of what kind, how long, worth how much. */
export function parseExamFormat(line: string): ExamFacts | null {
  if (!EXAM_RE.test(line) || line.length > 400) return null;
  const facts: ExamFacts = {};
  const total = /(\d{1,3})\s+(?:total\s+)?(?:exam\s+)?questions?\b/i.exec(line);
  const typed = [...line.matchAll(/(\d{1,3})\s*(?:[-–]\s*)?(multiple[- ]choice|true\s*\/?\s*false|short[- ]answer|free[- ]response|essay|numeric|calculation|problems?|questions?)\b/gi)];
  const sum = typed.reduce((n, m) => n + Number(m[1]), 0);
  const q = total ? Number(total[1]) : sum;
  if (q >= 1 && q <= 200) facts.questionCount = q;
  const types = TYPE_WORDS.filter(([re]) => re.test(line)).map(([, name]) => name);
  if (types.length) facts.types = types;
  const min = /(\d{1,3})\s*(?:minutes?|mins?)\b/i.exec(line), hrs = /(\d(?:\.\d)?)\s*(?:hours?|hrs?)\b/i.exec(line);
  const minutes = min ? Number(min[1]) : hrs ? Math.round(Number(hrs[1]) * 60) : null;
  if (minutes && minutes >= 5 && minutes <= 300) facts.minutes = minutes;
  const pts = /(\d{1,4})\s*points?\b/i.exec(line);
  if (pts && Number(pts[1]) >= 1) facts.points = Number(pts[1]);
  return facts.questionCount || facts.minutes ? facts : null;
}

/** "exam 1", "midterm", "final" — so a format line can be matched to the right exam. */
export function examKeyOf(line: string): string | null {
  const m = /\b(exam|test|quiz)\s*#?\s*(\d)\b|\b(midterm|mid-term)\s*(?:exam)?\s*#?\s*(\d)?\b|\b(final)(?:\s+exam)?\b/i.exec(line);
  if (!m) return null;
  if (m[1]) return `${m[1].toLowerCase()} ${m[2]}`;
  if (m[3]) return m[4] ? `midterm ${m[4]}` : "midterm";
  return "final";
}

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
        // Bulleted, or a plain sentence that starts with an objective verb ("Conduct a Kruskal Wallace test…").
        const text = b ? b[1].trim() : OBJECTIVE_START.test(line) && line.length >= 20 && line.length <= 400 ? line.replace(/^[-*•–]\s*/, "").trim() : null;
        if (text) {
          put({ kind: "objective", text, moduleNumber: currentModule }, norm(text), c.ordinal);
          // The course's own objectives are the best topic list there is: one topic per objective, full text kept.
          const name = topicFromObjective(text);
          if (isTopicHeading(name) || name.split(" ").length >= 2) put({ kind: "topic", name, documentId: doc.id, via: "objective", detail: text }, norm(name), c.ordinal);
          continue;
        }
        // A short line without a verb ("Resources", "Overview") ends the objectives list.
        if (line.split(" ").length <= 4 || BULLET_RE.test(line) === false) inObjectives = false;
      }
      const isExam = EXAM_RE.test(line);
      const facts = isExam ? parseExamFormat(line) : null;
      if (facts) {
        const key = examKeyOf(line);
        const label = line.replace(/\s*\|\s*/g, " — ").replace(/[.\s]+$/, "").slice(0, 240);
        put({ kind: "format", label, examKey: key, ...facts }, `${key ?? "any"}:${facts.questionCount ?? 0}:${facts.minutes ?? 0}`, c.ordinal);
      }
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
    if (!isSyllabus && h && topicCount < 10) {
      const base = h.replace(/\s*\(speaker notes\)$/i, "");
      const key = norm(base);
      if (!seenHeadings.has(key)) {
        seenHeadings.add(key);
        if (isTopicHeading(base, doc.title) && ![...drafts.values()].some((d) => d.payload.kind === "topic" && sameTopic(d.payload.name, base))) {
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
