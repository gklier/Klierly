/**
 * Pure rules for the class library. No database, so they are cheap to test exhaustively.
 */

/** Bumped whenever the sharing terms change; stored with every shared item. */
export const SHARING_TERMS_VERSION = "2026-11-17";
/** How long a claimed membership stays valid without the extension seeing the LMS course again. */
export const MEMBERSHIP_ACTIVE_DAYS = 120;
/** Distinct classmates who must report an item before it is hidden pending review. */
export const REPORTS_TO_HIDE = 2;
/** A shared summary may not contain a run of this many consecutive words copied from the source. */
export const MAX_COPIED_RUN = 8;

const words = (s: string) => s.toLowerCase().normalize("NFKC").replace(/[^a-z0-9%.$'-]+/g, " ").split(" ").filter(Boolean);

/**
 * Does `candidate` contain `run` or more consecutive words that also appear, in the same order, in any source text?
 * This is what keeps a shared summary in the student's own words instead of a copy of the instructor's.
 */
export function hasVerbatimRun(candidate: string, sources: string[], run = MAX_COPIED_RUN): boolean {
  const c = words(candidate);
  if (c.length < run) return false;
  const grams = new Set<string>();
  for (let i = 0; i + run <= c.length; i++) grams.add(c.slice(i, i + run).join(" "));
  for (const src of sources) {
    const s = words(src);
    for (let i = 0; i + run <= s.length; i++) if (grams.has(s.slice(i, i + run).join(" "))) return true;
  }
  return false;
}

const ALWAYS_BLOCKED = [/answer\s*key/i, /\bsolutions?\b/i, /\b(past|old|previous|prior)\s+(exam|midterm|quiz|test)s?(?![\w-])/i, /(?<![\w-])(exam|midterm|quiz|test)\s*#?\d*\s*(questions?|paper|copy|version|form\s*[a-d])\b/i];
// A hyphen is not a word break here: "t-test" and "post-test" are statistics, not an exam.
const ASSESSMENT_WORD = /(?<![\w-])(exam|midterm|quiz|test)(?![\w-])/i;
const STUDY_WORD = /\b(review|prep|preparation|guide|study|strategy|strategies|overview|format|schedule|about|recap|notes|lecture|summary|module|chapter|example|examples|hypothesis|intro|introduction|worked)\b/i;

/**
 * Titles or file names that suggest the material is (or answers) an exam or quiz. Such things are never shared.
 * "Exam 1 review" and "Study guide for the midterm" are study material and pass; "Midterm 2" and "Quiz 3 solutions" do not.
 */
export function looksLikeAssessmentMaterial(...texts: (string | null | undefined)[]): boolean {
  return texts.some((t) => {
    if (!t) return false;
    if (ALWAYS_BLOCKED.some((re) => re.test(t))) return true;
    return ASSESSMENT_WORD.test(t) && !STUDY_WORD.test(t);
  });
}

const HOST = /^[a-z0-9]([a-z0-9.-]{0,98}[a-z0-9])?(:\d{1,5})?$/i;

export type ClassIdentity = { lms: "canvas"; host: string; externalCourseId: string; label: string };

/** The course's own name as shown in the LMS: tidy, bounded, never empty. */
export function cleanClassLabel(raw: unknown, fallback: string): string {
  const t = typeof raw === "string" ? raw.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) : "";
  return t.length >= 2 ? t : fallback;
}

export function parseClassIdentity(input: { lms?: unknown; host?: unknown; externalCourseId?: unknown; label?: unknown }): ClassIdentity | null {
  if (input.lms !== "canvas") return null;
  const host = typeof input.host === "string" ? input.host.trim().toLowerCase() : "";
  const id = typeof input.externalCourseId === "string" ? input.externalCourseId.trim() : "";
  if (!HOST.test(host) || !/^\d{1,12}$/.test(id)) return null;
  return { lms: "canvas", host, externalCourseId: id, label: cleanClassLabel(input.label, `Canvas course ${id}`) };
}

export const membershipActive = (verifiedAt: Date, now = Date.now()) => now - verifiedAt.getTime() < MEMBERSHIP_ACTIVE_DAYS * 86400_000;

/** Course name from a Canvas page title such as "Modules: ISM3004 – Fall 2026" (page name first, course after). */
export function courseNameFromTitle(title: string): string {
  const t = title.replace(/\s+/g, " ").trim();
  const i = t.indexOf(": ");
  return (i >= 0 ? t.slice(i + 2) : t).slice(0, 100);
}
