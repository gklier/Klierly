// Popup controller. Nothing leaves the browser until the Import button is clicked.
import { ApiError, fetchCourses, importCapture, loadSettings, normalizeServerUrl, safeHttpUrl } from './src/api.js';
import { cleanText, cleanTitle, formatCount, limitText } from './src/clean.js';
import { collectSignals, extractVisibleText } from './src/extract.js';
import { evaluateGuard, restrictedPageReason } from './src/guard.js';
import { detectCourse } from './src/lms/index.js';

const $ = (id) => document.getElementById(id);
const FALLBACK = 'You can still add permitted material in Klierly itself: copy the text and use Materials → Paste text, or upload the file.';
let settings, tab, capture = null, courses = [];

function show(view) {
  for (const v of ['disconnected', 'blocked', 'capture', 'done']) $(`view-${v}`).hidden = v !== view;
  $('status').hidden = true;
}

function block(title, reasons, help = FALLBACK) {
  $('blocked-title').textContent = title;
  $('blocked-reasons').replaceChildren(...reasons.map((r) => Object.assign(document.createElement('li'), { textContent: r })));
  $('blocked-help').textContent = help;
  show('blocked');
}

async function activeTab() {
  // Test seam: popup.html?tabId=N lets an automated test target a tab without a toolbar click.
  // It grants nothing: scripting still fails unless the browser has given this extension access to that tab.
  const forced = Number(new URLSearchParams(location.search).get('tabId'));
  if (forced) return chrome.tabs.get(forced);
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t;
}

async function run(func, args = []) {
  const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func, args });
  return result?.result;
}

function updateImportState() {
  const ready = $('permission').checked && $('course').value && capture && capture.text.length > 0;
  $('import').disabled = !ready;
  $('import-hint').textContent = !capture?.text ? 'There is no text to import.' : !$('course').value ? 'Choose a course.' : !$('permission').checked ? 'Tick the declaration to enable.' : '';
}

function fillModules() {
  const course = courses.find((c) => c.id === $('course').value);
  const options = [new Option('Decide automatically', ''), ...(course?.modules ?? []).map((m) => new Option(m.name, m.id))];
  $('module').replaceChildren(...options);
}

async function extract(selectionOnly) {
  const raw = await run(extractVisibleText, [{ selectionOnly }]);
  const { text, truncated } = limitText(cleanText(raw?.text ?? ''));
  // Second guard pass, now with the text (e.g. a running timer rendered as plain text).
  const verdict = evaluateGuard({ url: raw.url, title: raw.title, text, domSignals: capture?.domSignals ?? {} });
  if (verdict.blocked) { capture = null; block('This page looks like an assessment in progress', verdict.reasons, `Klierly does not capture graded assessments. ${FALLBACK}`); return; }
  capture = { ...capture, url: raw.url, text, usedSelection: raw.usedSelection };
  $('preview').value = text;
  $('count').textContent = `(${formatCount(text.length)}${truncated ? ', shortened to the import limit' : ''})`;
  const ex = raw.excluded ?? {};
  const parts = [ex.navigation && 'site navigation', ex.hidden && 'hidden content', ex.formFields && 'form fields', ex.embedded && 'embedded frames and media', ex.gradesOrPeople && 'grade or people blocks'].filter(Boolean);
  $('excluded').textContent = parts.length ? `Left out: ${parts.join(', ')}.` : '';
  updateImportState();
}

async function init() {
  $('settings-link').addEventListener('click', (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); });
  $('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
  settings = await loadSettings();
  if (!settings.token || !normalizeServerUrl(settings.serverUrl).ok) return show('disconnected');

  try { tab = await activeTab(); } catch { tab = null; }
  if (!tab?.id) return block('No page to capture', ['The extension could not find the current tab.']);
  // On a course site, offer course-wide discovery in addition to capturing this one page.
  if (tab.url && detectCourse(tab.url)) {
    $('view-discover').hidden = false;
    $('discover').addEventListener('click', () => {
      chrome.tabs.create({ url: chrome.runtime.getURL(`discover.html?tabId=${tab.id}&url=${encodeURIComponent(tab.url)}`) });
      window.close();
    });
  }
  const restricted = restrictedPageReason(tab.url);
  if (restricted) return block('This page cannot be captured', [restricted]);

  let signals;
  try { signals = await run(collectSignals); } catch {
    return block('This page cannot be captured', ['The browser or the site does not allow extensions to read this page.'], `The extension does not try to work around that. ${FALLBACK}`);
  }
  if (!signals) return block('This page cannot be captured', ['The page did not return any information.']);
  const verdict = evaluateGuard({ url: signals.url, title: signals.title, text: '', domSignals: signals.domSignals });
  if (verdict.blocked) {
    return verdict.kind === 'private'
      ? block('This page is not study material', verdict.reasons, 'Grades and class lists are personal records. Klierly does not import them.')
      : block('This page looks like an assessment in progress', verdict.reasons, `Klierly does not capture or help with graded assessments. Finish it on your own; afterwards, study from permitted notes and readings. ${FALLBACK}`);
  }
  if (verdict.cautions.length) { $('cautions').textContent = verdict.cautions.join(' '); $('cautions').hidden = false; }

  capture = { domSignals: signals.domSignals };
  $('title').value = cleanTitle(signals.title) || 'Captured page';
  $('server-host').textContent = new URL(settings.serverUrl).host;
  $('selection-row').hidden = !signals.hasSelection;
  $('selection-only').checked = signals.hasSelection;
  show('capture');
  await extract(signals.hasSelection);
  if (!capture) return;

  // Lecture videos: captions are handled on their own page because embedded players need a per-site permission.
  try {
    const { listEmbeds } = await import('./src/captions.js');
    const embeds = await run(listEmbeds);
    if (embeds && (embeds.media > 0 || embeds.frames > 0)) {
      $('captions-row').hidden = false;
      $('captions-link').addEventListener('click', (e) => { e.preventDefault(); chrome.tabs.create({ url: chrome.runtime.getURL(`captions.html?tabId=${tab.id}`) }); window.close(); });
    }
  } catch { /* optional */ }
  $('selection-only').addEventListener('change', (e) => extract(e.target.checked));
  $('permission').addEventListener('change', updateImportState);
  $('course').addEventListener('change', () => { fillModules(); updateImportState(); });
  $('import').addEventListener('click', doImport);

  try {
    courses = (await fetchCourses(settings)).courses; // sends only the pairing token
  } catch (e) {
    $('error').textContent = e instanceof ApiError ? e.message : 'Could not load your courses.';
    $('error').hidden = false;
    return;
  }
  if (!courses.length) { $('error').textContent = 'You have no courses yet. Create one in Klierly first.'; $('error').hidden = false; return; }
  const { lastCourseId } = await chrome.storage.local.get('lastCourseId');
  $('course').replaceChildren(...courses.map((c) => new Option(c.name, c.id)));
  if (courses.some((c) => c.id === lastCourseId)) $('course').value = lastCourseId;
  fillModules();
  updateImportState();
}

async function doImport() {
  if ($('import').disabled || !capture) return;
  $('import').disabled = true; $('import').textContent = 'Importing…'; $('error').hidden = true;
  try {
    const res = await importCapture(settings, {
      courseId: $('course').value, moduleId: $('module').value || null, title: cleanTitle($('title').value) || 'Captured page',
      url: capture.url, text: capture.text, selectionOnly: Boolean(capture.usedSelection), permissionConfirmed: true,
      signals: { assessmentSuspected: false, reasons: [] },
    });
    await chrome.storage.local.set({ lastCourseId: $('course').value });
    $('done-title').textContent = res.duplicate ? 'Already imported.' : 'Imported.';
    $('done-text').textContent = res.duplicate ? 'This exact text is already in the course.' : 'Klierly is processing the text now.';
    const link = safeHttpUrl(res.viewUrl);
    if (link) $('done-link').href = link; else $('done-link').hidden = true;
    show('done');
  } catch (e) {
    $('error').textContent = e instanceof ApiError ? e.message : 'The import failed.';
    $('error').hidden = false;
    $('import').textContent = 'Import';
    updateImportState();
  }
}

init().catch(() => block('Something went wrong', ['The extension hit an unexpected error on this page.']));
