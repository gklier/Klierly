// Course discovery and import. Runs in its own extension tab so it survives
// navigation in the course tab. Nothing is imported before "Import selected".
import { ApiError, fetchCourses, fetchSources, importCapture, importFile, loadSettings, logEvent, normalizeServerUrl, safeHttpUrl } from './src/api.js';
import { cleanText, cleanTitle, limitText } from './src/clean.js';
import { collectSignals, extractVisibleText } from './src/extract.js';
import { evaluateGuard } from './src/guard.js';
import { detectCourse } from './src/lms/index.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...children) => { const n = Object.assign(document.createElement(tag), props); n.append(...children); return n; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const params = new URLSearchParams(location.search);
const tabId = Number(params.get('tabId'));
const found = detectCourse(params.get('url') || '');
const PACE_MS = Number(params.get('pace')) || 1500; // pause between items: keeps load on the course site low
const MAX_FILE_BYTES = 25 * 1024 * 1024;

let settings, adapter, course, inventory = null, imported = new Map(), courses = [], run = null, stopRequested = false;
const selected = new Set();
const runKey = () => `run:${course.host}:${course.courseId}`;
const itemKey = (item) => adapter.externalId(course, item);

function fatal(message) { $('fatal').textContent = message; $('fatal').hidden = false; for (const s of ['step-access', 'step-scan', 'step-inventory']) $(s).hidden = true; }

async function exec(func, args = []) {
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func, args });
  return r?.result;
}

/** Open an address in the course tab and wait until it has loaded. Same site only. */
async function open(url) {
  if (new URL(url).origin !== course.origin) throw new Error('That link leaves the course site, so it was not opened.');
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); reject(new Error('The page took too long to load.')); }, 45000);
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); resolve(); } };
    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.update(tabId, { url }).catch((e) => { clearTimeout(timer); chrome.tabs.onUpdated.removeListener(listener); reject(e); });
  });
  await sleep(400); // let the page's own scripts render
}

// ---------------------------------------------------------------- access
async function hasAccess() {
  try { return await chrome.permissions.contains({ origins: [`${course.origin}/*`] }); } catch { return false; }
}

async function showAccessOrScan() {
  const ok = await hasAccess();
  $('step-access').hidden = ok;
  $('step-scan').hidden = !ok;
  $('revoke').hidden = !ok;
  if (ok) await offerResume();
}

// ---------------------------------------------------------------- scan
async function scan() {
  $('scan').disabled = true; $('scan-status').textContent = 'Opening the Modules page…';
  try {
    await open(course.modulesUrl);
    let result = null;
    for (let i = 0; i < 8; i++) { // modules render progressively
      result = await exec(adapter.readModulesPage);
      if (result?.modules?.length && !result.more) break;
      await sleep(700);
    }
    if (!result?.modules?.length) {
      $('scan-status').textContent = '';
      logEvent(settings, 'discovery.scan', { host: course.host, ok: false, modules: 0, diag: result?.diag }, $('target').value);
      return fatal('No modules were found on this course\'s Modules page. The course may not use Modules, may hide them from students, or this site may lay the page out differently. You can still capture single pages with the toolbar button, or upload files in Klierly.');
    }
    inventory = result;
    try { imported = new Map((await fetchSources(settings, $('target').value)).map((s) => [s.externalId, s])); } catch { imported = new Map(); }
    renderInventory();
    const items = allItems();
    const byType = {};
    for (const i of items) byType[i.type] = (byType[i.type] || 0) + 1;
    logEvent(settings, 'discovery.scan', { host: course.host, ok: true, modules: inventory.modules.length, items: items.length, importable: items.filter((i) => i.importable).length, locked: items.filter((i) => i.locked).length, byType, more: inventory.more, diag: inventory.diag }, $('target').value);
    $('scan-status').textContent = `Scanned ${new Date().toLocaleTimeString()}.`;
  } catch (e) {
    $('scan-status').textContent = '';
    fatal(`The course tab could not be read: ${e.message || 'unknown reason'} Make sure the course tab is still open and you are signed in.`);
  } finally { $('scan').disabled = false; }
}

function allItems() {
  return inventory.modules.flatMap((m, mi) => m.items.map((item) => ({ ...item, moduleName: m.name, moduleIndex: mi, key: itemKey(item), ...adapter.classify(item) })));
}

function renderInventory() {
  const items = allItems();
  const importable = items.filter((i) => i.importable);
  $('found-count').textContent = `— ${inventory.modules.length} modules, ${items.length} items, ${importable.length} can be imported`;
  const notes = [];
  if (inventory.more) notes.push('Canvas was still loading more modules or items; scroll the Modules page to the bottom and scan again to see everything.');
  $('scan-notes').textContent = notes.join(' '); $('scan-notes').hidden = !notes.length;
  const options = () => inventory.modules.map((m, i) => new Option(m.name, String(i)));
  $('range-from').replaceChildren(...options()); $('range-to').replaceChildren(...options());
  $('range-to').value = String(inventory.modules.length - 1);

  $('modules').replaceChildren(...inventory.modules.map((m, mi) => {
    const rows = items.filter((i) => i.moduleIndex === mi);
    const can = rows.filter((i) => i.importable);
    const all = el('input', { type: 'checkbox', disabled: !can.length, ariaLabel: `Select all importable items in ${m.name}` });
    all.dataset.module = String(mi);
    all.addEventListener('change', () => { for (const i of can) all.checked ? selected.add(i.key) : selected.delete(i.key); syncChecks(); });
    return el('section', { className: 'module' },
      el('header', {}, all, el('span', {}, m.name), el('span', { className: 'muted small', style: 'font-weight:400;margin-left:auto' }, `${can.length} of ${rows.length} importable`)),
      el('ul', {}, ...rows.map((i) => {
        const box = el('input', { type: 'checkbox', disabled: !i.importable, ariaLabel: `Select ${i.title}` });
        box.dataset.key = i.key;
        box.addEventListener('change', () => { box.checked ? selected.add(i.key) : selected.delete(i.key); syncChecks(); });
        const prior = imported.get(i.key);
        const state = !i.importable ? el('span', { className: 'tag' }, 'Not imported')
          : prior ? el('span', { className: `tag ${prior.status === 'failed' ? 'bad' : 'good'}`, title: prior.error || '' }, prior.status === 'failed' ? 'Failed in Klierly' : 'Imported')
          : el('span', { className: 'tag warn' }, 'New');
        return el('li', { className: i.importable ? '' : 'off' }, box,
          el('div', {}, el('span', {}, i.title), el('span', { className: 'muted small' }, `  ${adapter.TYPE_LABEL[i.type] || 'Other'}`), i.reason ? el('div', { className: 'muted small' }, i.reason) : ''),
          state);
      })));
  }));
  $('step-inventory').hidden = false;
  syncChecks();
}

function syncChecks() {
  const items = allItems();
  for (const box of document.querySelectorAll('#modules input[data-key]')) box.checked = selected.has(box.dataset.key);
  for (const box of document.querySelectorAll('#modules input[data-module]')) {
    const can = items.filter((i) => i.moduleIndex === Number(box.dataset.module) && i.importable);
    box.checked = can.length > 0 && can.every((i) => selected.has(i.key));
  }
  const chosen = items.filter((i) => selected.has(i.key));
  const skipped = items.filter((i) => !i.importable);
  const again = chosen.filter((i) => imported.has(i.key)).length;
  $('summary').textContent = chosen.length
    ? `${chosen.length} ${chosen.length === 1 ? 'item' : 'items'} selected from ${new Set(chosen.map((i) => i.moduleName)).size} module(s)${again ? `; ${again} already imported will be re-checked and replaced only if they changed` : ''}. About ${Math.max(1, Math.round((chosen.length * (PACE_MS + 2500)) / 60000))} minute(s).`
    : 'Nothing selected yet.';
  const reasons = new Map();
  for (const i of skipped) reasons.set(i.reason, (reasons.get(i.reason) || 0) + 1);
  $('skip-list').replaceChildren(...[...reasons].map(([reason, n]) => el('li', {}, `${n} not offered: ${reason}`)));
  const ready = chosen.length > 0 && $('permission').checked && $('target').value;
  $('start').disabled = !ready;
  $('start-hint').textContent = !chosen.length ? 'Select at least one item.' : !$('target').value ? 'Choose a Klierly course.' : !$('permission').checked ? 'Tick the declaration to enable.' : '';
}

// ---------------------------------------------------------------- import run
async function saveRun() { await chrome.storage.local.set({ [runKey()]: run }); }

async function offerResume() {
  const stored = (await chrome.storage.local.get(runKey()))[runKey()];
  const left = stored?.items?.filter((i) => i.status === 'pending').length || 0;
  $('resume').hidden = !left;
  if (left) $('resume-text').textContent = `An earlier import stopped with ${left} ${left === 1 ? 'item' : 'items'} still to do.`;
  return left ? stored : null;
}

function renderRun() {
  const done = run.items.filter((i) => i.status !== 'pending').length;
  const failed = run.items.filter((i) => i.status === 'failed').length;
  $('run-bar').style.width = `${(done / run.items.length) * 100}%`;
  $('run-status').textContent = run.state === 'running' ? `Importing ${done + 1 > run.items.length ? run.items.length : done + 1} of ${run.items.length}…`
    : run.state === 'stopped' ? `Stopped. ${done} of ${run.items.length} handled${failed ? `, ${failed} could not be imported` : ''}. You can resume later.`
    : `Finished: ${run.items.filter((i) => i.status === 'done').length} imported or up to date${failed ? `, ${failed} could not be imported` : ''}.`;
  const label = { pending: ['Waiting', ''], working: ['Working…', 'warn'], done: ['Imported', 'good'], unchanged: ['No change', 'good'], updated: ['Updated', 'good'], failed: ['Not imported', 'bad'] };
  $('run-list').replaceChildren(...run.items.map((i) => {
    const [text, tone] = label[i.status === 'done' ? (i.outcome === 'unchanged' ? 'unchanged' : i.outcome === 'updated' ? 'updated' : 'done') : i.status];
    const link = i.viewUrl && safeHttpUrl(i.viewUrl);
    return el('li', {}, el('span', {}, ''), el('div', {}, link ? el('a', { href: link, target: '_blank', rel: 'noopener' }, i.title) : el('span', {}, i.title),
      el('span', { className: 'muted small' }, `  ${i.moduleName}`), i.message ? el('div', { className: i.status === 'failed' ? 'small' : 'muted small' }, i.message) : ''),
      el('span', { className: `tag ${tone}` }, i.serverStatus === 'failed' ? 'Failed in Klierly' : i.serverStatus === 'ready' ? `${text} · processed` : text));
  }));
  $('cancel').hidden = run.state !== 'running';
  const base = normalizeServerUrl(settings.serverUrl);
  if (base.ok) { $('open-klierly').href = `${base.url}/courses/${run.klierlyCourseId}/materials`; $('open-klierly').hidden = false; }
  $('refresh-status').hidden = run.state === 'running';
}

async function importOne(item) {
  await open(item.url);
  let info = null;
  for (let i = 0; i < 10; i++) { // wait for the content to render
    info = await exec(adapter.inspectResource);
    if (!info || info.kind !== 'page' || info.ready) break;
    await sleep(500);
  }
  if (!info) throw new Error('The page could not be read.');
  if (info.kind === 'unavailable') { const e = new Error(info.reason); e.fatal = Boolean(info.fatal); throw e; }
  const common = { courseId: run.klierlyCourseId, moduleName: item.moduleName, externalId: item.key, url: info.url };

  if (info.kind === 'file') {
    const file = await exec(adapter.fetchFile, [info.downloadUrl, info.filename || item.title, MAX_FILE_BYTES]);
    if (!file?.ok) throw new Error(file?.reason || 'The file could not be read.');
    const bytes = Uint8Array.from(atob(file.base64), (c) => c.charCodeAt(0));
    return importFile(settings, { ...common, title: item.title, permissionConfirmed: 'true' }, new Blob([bytes], { type: file.mime || 'application/octet-stream' }), file.filename);
  }

  // A page: the same safety checks and the same extractor as single-page capture.
  const signals = await exec(collectSignals);
  const verdict = evaluateGuard({ url: signals.url, title: signals.title, text: '', domSignals: signals.domSignals });
  if (verdict.blocked) throw new Error(verdict.kind === 'private' ? 'This is a grades or people page, which is not imported.' : 'This looks like an assessment in progress, which is never imported.');
  const raw = await exec(extractVisibleText, [{ selectionOnly: false }]);
  const { text } = limitText(cleanText(raw?.text ?? ''));
  if (evaluateGuard({ url: raw.url, title: raw.title, text, domSignals: signals.domSignals }).blocked) throw new Error('This looks like an assessment in progress, which is never imported.');
  if (text.length < 20) throw new Error('The page had no readable text (its content may be an embedded file or video). Open it yourself and upload the file if you are allowed to keep it.');
  return importCapture(settings, { ...common, moduleId: null, title: cleanTitle(item.title) || 'Course page', text, selectionOnly: false, permissionConfirmed: true, signals: { assessmentSuspected: false, reasons: [] } });
}

async function runImport() {
  stopRequested = false;
  run.state = 'running';
  $('step-inventory').hidden = true; $('step-scan').hidden = true; $('step-run').hidden = false;
  renderRun();
  for (const item of run.items) {
    if (item.status !== 'pending') continue;
    if (stopRequested) break;
    item.status = 'working'; renderRun();
    try {
      const res = await importOne(item);
      Object.assign(item, { status: 'done', outcome: res.outcome || (res.duplicate ? 'unchanged' : 'created'), viewUrl: res.viewUrl, message: '' });
    } catch (e) {
      const message = e instanceof ApiError ? e.message : e.message || 'Could not be imported.';
      Object.assign(item, { status: 'failed', message });
      if (e.fatal || (e instanceof ApiError && ['invalid_token', 'network', 'rate_limited', 'course_not_found'].includes(e.code))) {
        item.status = 'pending'; item.message = message; // not this item's fault: stop and let the student resume
        stopRequested = true;
        $('import-error').textContent = message;
      }
    }
    await saveRun(); renderRun();
    if (!stopRequested) await sleep(PACE_MS);
  }
  const left = run.items.some((i) => i.status === 'pending');
  run.state = left ? 'stopped' : 'finished';
  const tally = {};
  for (const i of run.items) { const k = i.status === 'done' ? (i.outcome || 'created') : i.status; tally[k] = (tally[k] || 0) + 1; }
  logEvent(settings, 'discovery.run', { host: course.host, items: run.items.length, tally, stopped: left, failures: run.items.filter((i) => i.status === 'failed').slice(0, 20).map((i) => ({ type: i.type, reason: String(i.message || '').slice(0, 140) })) }, run.klierlyCourseId);
  if (left) await saveRun(); else await chrome.storage.local.remove(runKey());
  try { await open(course.modulesUrl); } catch { /* the tab may have been closed */ }
  renderRun();
  await refreshServerStatus();
}

/** Ask Klierly how processing went for what was just imported. */
async function refreshServerStatus() {
  try {
    const byId = new Map((await fetchSources(settings, run.klierlyCourseId)).map((s) => [s.externalId, s]));
    for (const i of run.items) { const s = byId.get(i.key); if (s) { i.serverStatus = s.status; if (s.status === 'failed') i.message = s.error || 'Klierly could not process this source.'; } }
    renderRun();
  } catch { /* status is optional */ }
}

// ---------------------------------------------------------------- start-up
async function init() {
  if (!tabId || !found) return fatal('Open this from the Klierly toolbar button while you are on a course page.');
  ({ adapter, course } = found);
  $('access-host').textContent = course.host;
  settings = await loadSettings();
  if (!settings.token || !normalizeServerUrl(settings.serverUrl).ok) return fatal('The extension is not connected to Klierly yet. Open the extension settings, add your server address and pairing token, then try again.');
  $('server-host').textContent = new URL(settings.serverUrl).host;
  try { courses = (await fetchCourses(settings)).courses; } catch (e) { return fatal(e instanceof ApiError ? e.message : 'Could not reach your Klierly server.'); }
  if (!courses.length) return fatal('You have no courses in Klierly yet. Create one there first, then come back.');
  const { lastCourseId } = await chrome.storage.local.get('lastCourseId');
  $('target').replaceChildren(...courses.map((c) => new Option(c.name, c.id)));
  if (courses.some((c) => c.id === lastCourseId)) $('target').value = lastCourseId;

  $('grant').addEventListener('click', async () => {
    let ok = false;
    try { ok = await chrome.permissions.request({ origins: [`${course.origin}/*`] }); } catch { ok = false; }
    if (!ok) { $('fatal').textContent = 'Access was not granted, so the course cannot be scanned. Single-page capture from the toolbar button still works.'; $('fatal').hidden = false; }
    await showAccessOrScan();
  });
  $('revoke').addEventListener('click', async (e) => { e.preventDefault(); await chrome.permissions.remove({ origins: [`${course.origin}/*`] }); location.reload(); });
  $('scan').addEventListener('click', scan);
  $('range-apply').addEventListener('click', () => {
    const [a, b] = [Number($('range-from').value), Number($('range-to').value)].sort((x, y) => x - y);
    for (const i of allItems()) if (i.importable && i.moduleIndex >= a && i.moduleIndex <= b) selected.add(i.key);
    syncChecks();
  });
  $('select-new').addEventListener('click', () => { for (const i of allItems()) if (i.importable && !imported.has(i.key)) selected.add(i.key); syncChecks(); });
  $('select-none').addEventListener('click', () => { selected.clear(); syncChecks(); });
  $('permission').addEventListener('change', syncChecks);
  $('target').addEventListener('change', async () => {
    try { imported = new Map((await fetchSources(settings, $('target').value)).map((s) => [s.externalId, s])); } catch { imported = new Map(); }
    if (inventory) renderInventory();
  });
  $('start').addEventListener('click', async () => {
    const items = allItems().filter((i) => selected.has(i.key)).map((i) => ({ key: i.key, title: i.title, type: i.type, url: i.url, moduleName: i.moduleName, status: 'pending' }));
    if (!items.length || !$('permission').checked) return;
    run = { klierlyCourseId: $('target').value, startedAt: new Date().toISOString(), state: 'running', items };
    await chrome.storage.local.set({ lastCourseId: run.klierlyCourseId });
    await saveRun();
    await runImport();
  });
  $('cancel').addEventListener('click', () => { stopRequested = true; $('cancel').disabled = true; $('run-status').textContent = 'Stopping after the current item…'; });
  $('refresh-status').addEventListener('click', refreshServerStatus);
  $('resume-go').addEventListener('click', async () => { const stored = await offerResume(); if (stored) { run = stored; $('cancel').disabled = false; await runImport(); } });
  $('resume-drop').addEventListener('click', async () => { await chrome.storage.local.remove(runKey()); $('resume').hidden = true; });
  await showAccessOrScan();
}

init().catch((e) => fatal(`Something went wrong: ${e.message || 'unexpected error'}`));
