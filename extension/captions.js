// Caption import for the page in the student's tab. Nothing is sent before "Import captions".
import { ApiError, fetchCourses, importFile, loadSettings, logEvent, normalizeServerUrl, safeHttpUrl } from './src/api.js';
import { cleanTitle } from './src/clean.js';
import { captionFiles, listEmbeds, readCaptions } from './src/captions.js';
import { evaluateGuard } from './src/guard.js';
import { collectSignals } from './src/extract.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => { const n = Object.assign(document.createElement(tag), props); n.append(...children); return n; };
const tabId = Number(new URLSearchParams(location.search).get('tabId'));
let settings, courses = [], files = [], page = null, embeds = null, titleEdited = false;

const fatal = (m) => { $('fatal').textContent = m; $('fatal').hidden = false; for (const s of ['step-access', 'step-read', 'step-results']) $(s).hidden = true; };
const missingOrigins = async () => { const out = []; for (const o of embeds.origins) if (!(await chrome.permissions.contains({ origins: [`${o}/*`] }))) out.push(o); return out; };

async function showStep() {
  const missing = await missingOrigins();
  $('step-access').hidden = !missing.length;
  $('hosts').replaceChildren(...missing.map((o) => el('li', {}, new URL(o).host)));
  $('step-read').hidden = Boolean(missing.length);
}

function fillModules() {
  const course = courses.find((c) => c.id === $('target').value);
  $('module').replaceChildren(new Option('Decide automatically', ''), ...(course?.modules ?? []).map((m) => new Option(m.name, m.id)));
}
const ready = () => { $('import').disabled = !($('permission').checked && $('target').value && files.some((f) => f.selected)); };

async function read() {
  $('read').disabled = true; $('read-status').textContent = 'Reading caption tracks…';
  let results = [];
  try { results = (await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: readCaptions })).map((r) => r.result).filter(Boolean); }
  catch { $('read').disabled = false; return fatal('The browser did not allow this page to be read. Reload the page, click the Klierly button again and retry.'); }
  const notes = [];
  files = captionFiles(results, cleanTitle(page.title) || 'Lecture', notes).map((f) => ({ ...f, selected: true }));
  $('read').disabled = false;
  const players = results.reduce((n, r) => n + r.media, 0);
  logEvent(settings, 'captions.read', { frames: results.length, players, sources: files.length, tracks: files.filter((f) => f.cues).length, panels: files.filter((f) => !f.cues).length, embeddedOrigins: embeds.origins.length, mediasite: files.filter((f) => f.source === 'mediasite').length, skipped: notes.length }, $('target').value);
  if (!files.length) {
    $('read-status').textContent = '';
    if (notes.length) return fatal(`${[...new Set(notes)].join(' ')} If the lecture opened inside Canvas, open the video in its own tab or window and use the extension there.`);
    return fatal(players
      ? 'A video player was found, but it does not expose its captions to the browser (some players draw captions themselves or have none). If the player offers a transcript or caption download, save that file and upload it in Klierly → Materials.'
      : 'No video player with captions was found in the parts of this page the extension may read. If the video is inside an embedded frame, start it once so the player loads, then try again; or download the transcript from the player and upload it in Klierly.');
  }
  $('read-status').textContent = `Found ${files.length} caption ${files.length === 1 ? 'source' : 'sources'}.`;
  $('found').replaceChildren(...files.map((f) => {
    const box = el('input', { type: 'checkbox', checked: true, ariaLabel: `Select ${f.title}` });
    box.addEventListener('change', () => { f.selected = box.checked; ready(); });
    return el('li', {}, box, el('div', {}, el('span', {}, f.title), el('div', { className: 'muted small' }, `${f.cues ? `${f.cues} timed captions` : 'Transcript text without timestamps'} · from ${new URL(f.frame).host}`), el('div', { className: 'muted small' }, `“${f.preview.slice(0, 160)}…”`)), el('span', { className: 'tag good' }, f.cues ? 'Timestamps' : 'Text'));
  }));
  $('title').value = cleanTitle(page.title).replace(/:\s[^:]*$/, '') || 'Lecture';
  $('step-results').hidden = false;
  ready();
}

async function doImport() {
  $('import').disabled = true; $('error').hidden = true;
  let ok = 0, link = null;
  try {
    for (const [i, f] of files.filter((x) => x.selected).entries()) {
      // A Mediasite lecture keeps its own title unless the student typed one.
      const title = f.source === 'mediasite' && !titleEdited ? f.title : `${cleanTitle($('title').value) || 'Lecture'}${f.cues ? ' — captions' : ' — transcript'}${i ? ` ${i + 1}` : ''}`;
      const res = await importFile(settings, { courseId: $('target').value, title, url: page.url, permissionConfirmed: 'true',
        moduleName: $('module').selectedOptions[0]?.value ? $('module').selectedOptions[0].textContent : null }, new Blob([f.text], { type: f.mime }), f.filename);
      ok += 1; link = safeHttpUrl(res.viewUrl) || link;
    }
    await chrome.storage.local.set({ lastCourseId: $('target').value });
    $('done').replaceChildren(`Imported ${ok}. `, link ? el('a', { href: link, target: '_blank', rel: 'noopener' }, 'Open in Klierly') : '');
  } catch (e) {
    $('error').textContent = e instanceof ApiError ? e.message : 'The import failed.'; $('error').hidden = false; ready();
  }
}

async function init() {
  if (!tabId) return fatal('Open this from the Klierly toolbar button while you are on the page with the video.');
  settings = await loadSettings();
  if (!settings.token || !normalizeServerUrl(settings.serverUrl).ok) return fatal('The extension is not connected to Klierly yet. Open the extension settings first.');
  try {
    const [sig] = await chrome.scripting.executeScript({ target: { tabId }, func: collectSignals });
    page = sig.result;
    const verdict = evaluateGuard({ url: page.url, title: page.title, text: '', domSignals: page.domSignals });
    if (verdict.blocked) return fatal('This page looks like an assessment or a grades page, so nothing is read from it.');
    embeds = (await chrome.scripting.executeScript({ target: { tabId }, func: listEmbeds }))[0].result;
  } catch { return fatal('The browser did not allow this page to be read. Click the Klierly toolbar button on the page again, then choose captions.'); }
  try { courses = (await fetchCourses(settings)).courses; } catch (e) { return fatal(e instanceof ApiError ? e.message : 'Could not reach your Klierly server.'); }
  if (!courses.length) return fatal('You have no courses in Klierly yet.');
  const { lastCourseId } = await chrome.storage.local.get('lastCourseId');
  $('target').replaceChildren(...courses.map((c) => new Option(c.name, c.id)));
  if (courses.some((c) => c.id === lastCourseId)) $('target').value = lastCourseId;
  fillModules();
  $('target').addEventListener('change', fillModules);
  $('permission').addEventListener('change', ready);
  $('title').addEventListener('input', () => { titleEdited = true; });
  $('grant').addEventListener('click', async () => {
    try { await chrome.permissions.request({ origins: (await missingOrigins()).map((o) => `${o}/*`) }); } catch { /* shown below */ }
    await showStep();
  });
  $('skip').addEventListener('click', () => { $('step-access').hidden = true; $('step-read').hidden = false; });
  $('read').addEventListener('click', read);
  $('import').addEventListener('click', doImport);
  await showStep();
}

init().catch((e) => fatal(`Something went wrong: ${e.message || 'unexpected error'}`));
