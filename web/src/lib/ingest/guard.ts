/**
 * Server-side re-check for web captures: refuse content that looks like an
 * active graded assessment. The extension runs its own check first; this is
 * defense in depth and also covers pasted text that declares a page URL.
 */
const URL_PATTERNS: [RegExp, string][] = [
  [/\/quizzes\/\d+\/take/i, "the page address is a quiz attempt"],
  [/\/(assignments|quizzes|exams|assessments?)\/[^?#]*\/(take|attempt)/i, "the page address is an assessment attempt"],
  [/[?&](attempt|take)=/i, "the page address is an assessment attempt"],
  [/lockdown|proctor|respondus|honorlock/i, "the page address belongs to a proctoring tool"],
  [/\/(grades|gradebook)(\/|$|\?)/i, "the page is a grades page"],
  [/\/(users|people|roster)(\/|$|\?)/i, "the page is a people or roster page"],
];
const TEXT_SIGNALS: [RegExp, string][] = [
  [/\btime (remaining|elapsed|left)\b/i, "a running assessment timer"],
  [/\bsubmit (quiz|exam|test|attempt|assessment)\b/i, "a submit-assessment button"],
  [/\bquestion \d+ of \d+\b/i, "numbered questions in progress"],
  [/\b(respondus|lockdown browser|honorlock|proctoru|proctorio)\b/i, "proctoring software"],
  [/\battempt \d+ (in progress|of \d+)\b/i, "an attempt in progress"],
];

export function assessAssessment(input: { url?: string | null; title?: string | null; text: string }): { blocked: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const [re, why] of URL_PATTERNS) if (input.url && re.test(input.url)) reasons.push(why);
  if (reasons.length) return { blocked: true, reasons: [...new Set(reasons)] };
  const hay = `${input.title ?? ""}\n${input.text.slice(0, 200_000)}`;
  const hits = TEXT_SIGNALS.filter(([re]) => re.test(hay)).map(([, why]) => why);
  // One phrase alone can appear in a syllabus or instructions; two independent signals do not.
  return { blocked: hits.length >= 2, reasons: hits.length >= 2 ? hits : [] };
}
