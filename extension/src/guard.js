// Capture guard: decides whether a page may be captured at all.
//
// Pure module (no DOM, no chrome.* APIs) so it can be unit-tested in Node.
// Input:  { url, title, text, domSignals }
// Output: { blocked, kind, reasons[], cautions[] }
//   kind     "assessment" | "private" | null
//   reasons  plain-language explanations of why capture is blocked
//   cautions plain-language notices shown next to an allowed preview
//
// `domSignals` is produced inside the page by collectSignals() in extract.js
// and only ever contains counts, booleans and matched button/vendor labels —
// never page content.

const PROCTOR_VENDORS = [
  ['Respondus', /respondus/i],
  ['LockDown Browser', /lock\s?down\s?browser/i],
  ['Honorlock', /honorlock/i],
  ['ProctorU', /proctoru\b/i],
  ['Proctorio', /proctorio/i],
  ['Examity', /examity/i],
];

const TIMER_LABEL = /\btime\s+(remaining|elapsed|left)\b/i;
// A timer label followed closely by a clock value: "Time Remaining 12:34",
// "Time Elapsed: 4 Minutes, 12 Seconds".
const RUNNING_TIMER = new RegExp(
  TIMER_LABEL.source +
    '[\\s:\\-–]{0,12}(\\d{1,3}:\\d{2}(:\\d{2})?|\\d+\\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\\b)',
  'i',
);

function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

/** URL-only checks. Cheap enough to run before anything is read from the page. */
export function classifyUrl(url) {
  const out = { assessment: [], privatePage: [], landing: false };
  const u = parseUrl(url || '');
  if (!u) return out;
  const path = decodeURIComponent(u.pathname).toLowerCase();
  const rest = (u.pathname + u.search + u.hash).toLowerCase();
  const whole = (u.hostname + rest).toLowerCase();

  if (/\/quizzes\/[^/]+\/take(\/|$)/.test(path) || /\/assignments\/.+\/take(\/|$)/.test(path) || /\/take(\/|$)/.test(path) || /\/take\?/.test(rest)) {
    out.assessment.push('The page address is a "take" page for a quiz or assignment.');
  }
  if (/(^|[/?&_.])attempts?([/=.?&#]|$)/.test(rest)) {
    out.assessment.push('The page address refers to an assessment attempt.');
  }
  if (/lock\s?down[-_]?browser|(^|[/?&=._])lockdown([/?&=._#]|$)|respondus/.test(whole)) {
    out.assessment.push('The page address refers to a lockdown browser.');
  }
  if (/proctor|honorlock|examity/.test(whole)) {
    out.assessment.push('The page address refers to exam proctoring.');
  }

  if (/\/(grades|gradebook)(\/|$)/.test(path)) {
    out.privatePage.push('This looks like a grades page. Grades are personal records, not study material.');
  }
  if (/\/(users|people|roster|classlist)(\/|$)/.test(path)) {
    out.privatePage.push('This looks like a people or roster page. It lists other people, not study material.');
  }

  out.landing = /\/(quizzes|quiz|exams|tests|assessments)\/[^/]+\/?$/.test(path);
  return out;
}

function vendorsIn(str) {
  if (!str) return [];
  return PROCTOR_VENDORS.filter(([, re]) => re.test(str)).map(([name]) => name);
}

export function evaluateGuard({ url = '', title = '', text = '', domSignals = {} } = {}) {
  const s = domSignals || {};
  const reasons = [];
  const cautions = [];

  const urlInfo = classifyUrl(url);

  // 1. Grades / people pages: blocked by address.
  if (urlInfo.privatePage.length) {
    return { blocked: true, kind: 'private', reasons: urlInfo.privatePage, cautions: [] };
  }

  // 2. Assessment signals from the address.
  reasons.push(...urlInfo.assessment);

  // 3. Assessment signals from the page structure.
  const questionGroups = Number(s.questionGroups) || 0;
  const answerInputs = Number(s.answerInputs) || 0;
  const quizForm = Boolean(s.quizForm);
  const submitButtons = Array.isArray(s.submitButtons) ? s.submitButtons : [];
  const hasQuestions = questionGroups > 0 && answerInputs > 0;

  if (quizForm && answerInputs > 0) {
    reasons.push('The page contains a quiz form with answer fields.');
  } else if (hasQuestions && questionGroups >= 2) {
    reasons.push('The page contains several questions with answer fields.');
  }
  if (submitButtons.length) {
    reasons.push(`The page has a "${submitButtons[0]}" button.`);
  }

  const timerLabel = Boolean(s.timerText) || TIMER_LABEL.test(text);
  const timerRunning = Boolean(s.runningTimer) || RUNNING_TIMER.test(text);
  const otherSignal = hasQuestions || quizForm || submitButtons.length > 0 || urlInfo.assessment.length > 0;
  if (timerRunning || (timerLabel && otherSignal)) {
    reasons.push('The page shows a running assessment timer.');
  } else if (timerLabel) {
    cautions.push('This page mentions a timer. If you are in the middle of a graded assessment, do not import it.');
  }

  // 4. Proctoring / lockdown tools. In the title it is decisive; in body text
  //    alone it is common on syllabi ("exams use Respondus"), so it only
  //    blocks together with another signal.
  const titleVendors = vendorsIn(title);
  const bodyVendors = [...new Set([...(Array.isArray(s.proctoring) ? s.proctoring : []), ...vendorsIn(text)])];
  if (titleVendors.length) {
    reasons.push(`The page title mentions ${titleVendors.join(', ')}.`);
  } else if (bodyVendors.length && (otherSignal || timerLabel)) {
    reasons.push(`The page mentions ${bodyVendors.join(', ')} alongside other assessment signals.`);
  } else if (bodyVendors.length) {
    cautions.push(`This page mentions ${bodyVendors.join(', ')}. Only import it if it is course information, not an assessment in progress.`);
  }

  if (reasons.length) {
    return { blocked: true, kind: 'assessment', reasons, cautions: [] };
  }

  // 5. Not blocked: landing / instructions pages get a caution only.
  const looksLikeLanding =
    urlInfo.landing || Boolean(s.startButton) || (hasQuestions && questionGroups < 2) || /^\s*(quiz|exam|midterm|final exam|test)\b.*\b(instructions|details)\b/i.test(title);
  if (looksLikeLanding) {
    cautions.push('This looks like a quiz or exam information page. Import instructions only if your course allows it, and never import questions from a graded assessment.');
  }

  return { blocked: false, kind: null, reasons: [], cautions };
}

/**
 * Pages the browser does not let extensions read, or where reading the DOM
 * gives nothing useful. Returns a plain-language reason, or null.
 */
export function restrictedPageReason(url) {
  if (!url) return null; // unknown: let the injection attempt decide
  const u = parseUrl(url);
  if (!u) return 'This page cannot be read by browser extensions.';
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    if (u.protocol === 'file:') return 'This is a file on your computer, which the extension does not read.';
    return 'This is a built-in browser page, which extensions are not allowed to read.';
  }
  const host = u.hostname.toLowerCase();
  if (host === 'chromewebstore.google.com' || (host === 'chrome.google.com' && u.pathname.startsWith('/webstore')) || (host === 'microsoftedge.microsoft.com' && u.pathname.startsWith('/addons'))) {
    return 'This is an extension store page, which extensions are not allowed to read.';
  }
  if (/\.pdf$/i.test(u.pathname)) {
    return 'This is a PDF shown in the browser’s PDF viewer, which the extension cannot read.';
  }
  return null;
}
