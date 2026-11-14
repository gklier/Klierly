// Canvas adapter for course discovery.
//
// Access model: everything here reads pages the student's own browser has
// rendered, in the student's own tab. It does NOT call the Canvas REST API,
// does not use developer keys or access tokens, and never touches cookies.
// (Instructure's API policy is written for registered, token-based apps; an
// official integration needs an institution-issued developer key and is out
// of scope here. See docs/LMS_ACCESS.md.)
//
// The functions marked "injected" are serialised into the tab with
// chrome.scripting.executeScript, so each must be fully self-contained.

const COURSE_PATH = /^\/courses\/(\d+)(\/|$)/;

/** Is this address inside a Canvas-style course? URL shape only; the page structure is checked when scanning. */
export function matchCourse(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1'))) return null;
  const m = COURSE_PATH.exec(u.pathname);
  if (!m) return null;
  return { lms: 'canvas', origin: u.origin, host: u.host, courseId: m[1], modulesUrl: `${u.origin}/courses/${m[1]}/modules`, syllabusUrl: `${u.origin}/courses/${m[1]}/assignments/syllabus` };
}

export const TYPE_LABEL = { page: 'Page', file: 'File', syllabus: 'Syllabus', quiz: 'Quiz', assignment: 'Assignment', discussion: 'Discussion', link: 'External link', tool: 'External tool', other: 'Other' };

/** Why an item is, or is not, offered for import. Decided from the inventory alone, before anything is opened. */
export function classify(item) {
  if (item.locked) return { importable: false, reason: 'Locked or not released yet in Canvas.' };
  if (!item.url) return { importable: false, reason: 'Canvas shows no link for this item (it may be locked or unpublished).' };
  switch (item.type) {
    case 'page': case 'syllabus': return { importable: true, reason: '' };
    case 'file': return { importable: true, reason: '' };
    case 'quiz': return { importable: false, reason: 'Quizzes and exams are never imported.' };
    case 'assignment': return { importable: false, reason: 'Graded work is not imported automatically.' };
    case 'discussion': return { importable: false, reason: 'Discussions contain other students’ posts and are not imported.' };
    case 'link': return { importable: false, reason: 'External website. Open it yourself and capture that page if you are allowed to.' };
    case 'tool': return { importable: false, reason: 'Embedded external tool (often video); its content cannot be read.' };
    default: return { importable: false, reason: 'Unrecognised item type. Open it and use single-page capture, or upload the file.' };
  }
}

export function externalId(course, item) {
  return `canvas:${course.host}:${course.courseId}:${item.type}:${String(item.id).replace(/[^\w.-]/g, '_')}`.slice(0, 300);
}

/**
 * Injected. Reads the rendered Modules page: module names and, per item, its
 * title, type and link — the same list the student sees. No content is read.
 */
export function readModulesPage() {
  const text = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const shown = (el) => Boolean(el && (typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length));
  const TYPES = [
    ['context_module_sub_header', 'header'], ['wiki_page', 'page'], ['attachment', 'file'], ['lti-quiz', 'quiz'], ['quiz', 'quiz'],
    ['assignment', 'assignment'], ['discussion_topic', 'discussion'], ['external_url', 'link'], ['context_external_tool', 'tool'],
  ];
  const ICONS = [['icon-document', 'page'], ['icon-paperclip', 'file'], ['icon-quiz', 'quiz'], ['icon-assignment', 'assignment'], ['icon-discussion', 'discussion'], ['icon-link', 'link'], ['icon-lti', 'tool']];
  const typeOf = (li) => {
    const hint = text(li.querySelector('span.type')).toLowerCase();
    for (const [cls, type] of TYPES) if (li.classList.contains(cls) || hint === cls) return type;
    for (const [cls, type] of ICONS) if (li.querySelector(`i.${cls}, .${cls}`)) return type;
    return 'other';
  };
  const modules = [];
  for (const m of document.querySelectorAll('#context_modules .context_module, .context_module[data-module-id]')) {
    if (m.id === 'context_module_blank' || !shown(m)) continue; // Canvas keeps a hidden template module in the page
    const name = text(m.querySelector('.ig-header .name, .ig-header-title .name, h2 .name')) || (m.getAttribute('aria-label') || '').trim();
    if (!name) continue;
    const moduleLocked = shown(m.querySelector('.ig-header .locked_icon, .ig-header .icon-lock, .ig-header .lock-icon'));
    const items = [];
    for (const li of m.querySelectorAll('.context_module_item')) {
      if (!shown(li)) continue;
      const type = typeOf(li);
      if (type === 'header') continue;
      const link = li.querySelector('a.ig-title, a.item_link, .module-item-title a[href], .ig-info a[href]');
      const href = link ? link.getAttribute('href') : null;
      let url = null;
      try { if (href && !href.startsWith('#') && !/^javascript:/i.test(href)) url = new URL(href, location.href).href; } catch { /* leave null */ }
      const title = text(link) || text(li.querySelector('.ig-title, .title, .module-item-title'));
      if (!title) continue;
      const locked = moduleLocked || li.classList.contains('locked') || shown(li.querySelector('.locked_icon, .icon-lock'));
      items.push({ id: (li.id || '').replace(/^context_module_item_/, '') || `${modules.length}-${items.length}`, title: title.slice(0, 200), type, url, locked });
    }
    modules.push({ id: m.dataset.moduleId || (m.id || '').replace(/^context_module_/, '') || String(modules.length), name: name.slice(0, 120), locked: moduleLocked, items });
  }
  const more = Boolean(document.querySelector('.module-items-lazy-loading, .loading-more-modules, #context_modules_loading, [data-testid="modules-load-more"]'));
  // Structure counts only (no text): lets a failed scan on a site we have not seen be diagnosed from the log.
  const count = (sel) => { try { return document.querySelectorAll(sel).length; } catch { return -1; } };
  const diag = { modulesRoot: count('#context_modules'), moduleEls: count('.context_module'), itemEls: count('.context_module_item'), titleLinks: count('a.ig-title, a.item_link'), iframes: count('iframe'), lazy: more, hasMain: count('main, [role="main"]') };
  return { url: location.href, isModulesPage: Boolean(document.querySelector('#context_modules')) || modules.length > 0, modules, more, pageTitle: document.title, diag };
}

/**
 * Injected, after the tab has opened one selected item. Says what kind of page
 * this turned out to be; reads no content itself.
 */
export function inspectResource() {
  const text = (el) => (el ? (el.textContent || '').replace(/\s+/g, ' ').trim() : '');
  const shown = (el) => Boolean(el && (typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length));
  const path = location.pathname;
  const base = { url: location.href, title: document.title };
  if (/\/login|\/saml|\/cas\b/i.test(path) || document.querySelector('form#login_form, input[type="password"]')) {
    return { ...base, kind: 'unavailable', reason: 'Canvas asked you to sign in again. Sign in, then resume.' , fatal: true };
  }
  const lock = [...document.querySelectorAll('.lock_explanation, #unauthorized_message, .ic-Error-page, .unauthorized_message')].find(shown);
  if (lock) return { ...base, kind: 'unavailable', reason: `Canvas does not show this to you: ${text(lock).slice(0, 160) || 'access restricted'}` };
  if (/\/quizzes\/|\/assignments\/\d|\/discussion_topics\//.test(path)) return { ...base, kind: 'unavailable', reason: 'This opened a quiz, assignment or discussion, which is not imported.' };
  if (/\/files\/\d+/.test(path) || document.querySelector('#doc_preview, .file-preview')) {
    const link = [...document.querySelectorAll('#content a[href*="/download"], a[download][href*="/files/"]')].find(shown);
    if (!link) return { ...base, kind: 'unavailable', reason: 'Canvas offers no download link for this file here. If you may keep it, download it yourself and upload it in Klierly.' };
    const name = (link.getAttribute('download') || text(link).replace(/^download\s+/i, '') || text(document.querySelector('#content h2, #content h1'))).trim();
    return { ...base, kind: 'file', downloadUrl: new URL(link.getAttribute('href'), location.href).href, filename: name.slice(0, 200) };
  }
  const body = document.querySelector('#wiki_page_show .show-content, .show-content.user_content, #course_syllabus, #content .user_content');
  return { ...base, kind: 'page', ready: Boolean(body && text(body).length > 0) };
}

/**
 * Injected. Fetches one file the student selected, through the page itself
 * (the browser applies its normal rules; cookies are never read by this code).
 * Returns base64, or the reason it could not be read.
 */
export async function fetchFile(url, fallbackName, maxBytes) {
  const SUPPORTED = ['.pdf', '.docx', '.pptx', '.txt', '.md', '.markdown', '.html', '.htm', '.csv', '.xlsx', '.srt', '.vtt'];
  const extOf = (n) => { const m = /\.[a-z0-9]{1,8}$/i.exec(n || ''); return m ? m[0].toLowerCase() : ''; };
  const manual = 'Download it yourself and upload it in Klierly → Materials if you are allowed to keep it.';
  let res;
  try { res = await fetch(url, { credentials: 'include', redirect: 'follow' }); }
  catch { return { ok: false, reason: `The browser did not allow this file to be read from the page (it is served from a different address). ${manual}` }; }
  if (!res.ok) return { ok: false, reason: `Canvas answered ${res.status} for this file. ${manual}` };
  const cd = res.headers.get('content-disposition') || '';
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(cd), plain = /filename="?([^";]+)"?/i.exec(cd);
  let name = fallbackName || '';
  try { if (star) name = decodeURIComponent(star[1].trim()); else if (plain) name = plain[1].trim(); } catch { /* keep fallback */ }
  if (!extOf(name)) { const fromUrl = decodeURIComponent(new URL(res.url).pathname.split('/').pop() || ''); if (extOf(fromUrl)) name = fromUrl; }
  const ext = extOf(name);
  if (!SUPPORTED.includes(ext)) return { ok: false, reason: `“${name || 'This file'}” is a ${ext || 'file'} type Klierly cannot read (supported: ${SUPPORTED.join(' ')}).` };
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > maxBytes) return { ok: false, reason: `“${name}” is larger than the ${Math.round(maxBytes / 1048576)} MB limit.` };
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length > maxBytes) return { ok: false, reason: `“${name}” is larger than the ${Math.round(maxBytes / 1048576)} MB limit.` };
  if (buf.length === 0) return { ok: false, reason: `“${name}” is empty.` };
  let binary = '';
  for (let i = 0; i < buf.length; i += 0x8000) binary += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { ok: true, base64: btoa(binary), filename: name, mime: res.headers.get('content-type') || '', size: buf.length };
}

export const canvas = { id: 'canvas', name: 'Canvas', matchCourse, classify, externalId, readModulesPage, inspectResource, fetchFile, TYPE_LABEL };
