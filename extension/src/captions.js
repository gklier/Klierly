// Lecture captions. Reads only caption/subtitle text that a player on the page
// exposes to the browser (HTML text tracks) or shows in a transcript panel.
// It never downloads, records or decodes the video or audio itself.
//
// Players inside embedded frames live on another site, so the student is asked
// (through Chrome's own prompt) to allow that specific site first.
// The two functions below are injected into the page and must be self-contained.

/** Injected in the top frame: which embedded players/frames does this page have? No content is read. */
export function listEmbeds() {
  const shown = (el) => (typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length > 0);
  const origins = new Set();
  for (const f of document.querySelectorAll('iframe[src]')) {
    if (!shown(f)) continue;
    try { const u = new URL(f.src, location.href); if ((u.protocol === 'https:' || u.protocol === 'http:') && u.origin !== location.origin) origins.add(u.origin); } catch { /* ignore */ }
  }
  return { origins: [...origins], media: document.querySelectorAll('video, audio').length, frames: document.querySelectorAll('iframe').length };
}

/** Injected in every frame the student allowed: caption tracks and visible transcript panels. */
export async function readCaptions() {
  const shown = (el) => (typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.getClientRects().length > 0);
  const items = [];
  const media = [...document.querySelectorAll('video, audio')];
  for (const m of media) {
    for (const track of [...m.textTracks]) {
      if (track.kind !== 'subtitles' && track.kind !== 'captions') continue;
      const before = track.mode;
      if (before === 'disabled') track.mode = 'hidden'; // lets the browser load the cues without displaying them
      for (let i = 0; i < 16 && !(track.cues && track.cues.length); i += 1) await new Promise((r) => setTimeout(r, 250));
      const cues = track.cues ? [...track.cues].map((c) => ({ s: c.startTime, e: c.endTime, t: String(c.text || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() })).filter((c) => c.t) : [];
      if (before === 'disabled') track.mode = before;
      if (cues.length) items.push({ kind: 'track', label: track.label || track.language || 'Captions', lang: track.language || '', cues: cues.slice(0, 6000) });
    }
  }
  const panels = [...document.querySelectorAll('[class*="transcript" i], [id*="transcript" i], [aria-label*="transcript" i]')].filter(shown);
  for (const el of panels) {
    if (panels.some((p) => p !== el && p.contains(el))) continue; // outermost panel only
    const text = (el.innerText || '').trim();
    if (text.length >= 200) items.push({ kind: 'panel', label: 'Transcript panel', text: text.slice(0, 400000) });
  }

  // Mediasite (UF's lecture platform). On a Mediasite Play page, ask the player's own service for the
  // lecture's transcript, exactly as the player does, from inside the page and the student's own session.
  // Nothing here reads cookies or tokens, and a lecture the student cannot open simply fails.
  const notes = [];
  const play = /\/Mediasite\/Play\/([^/?#]+)/i.exec(location.pathname);
  if (play) {
    try {
      const servicePath = (document.querySelector('#ServicePath')?.textContent || '').trim() || '/Mediasite/PlayerService/PlayerService.svc/json';
      const endpoint = new URL(servicePath.replace(/\/$/, '') + '/GetPlayerOptions', location.origin).href;
      const res = await fetch(endpoint, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Requested-With': 'XMLHttpRequest' },
        body: JSON.stringify({ getPlayerOptionsRequest: { ResourceId: play[1], QueryString: location.search || '', UrlReferrer: document.referrer || '', UseScreenReader: false } }),
      });
      if (!res.ok) notes.push(`Mediasite answered ${res.status} when asked for this lecture's details. Sign in to Mediasite again if needed; some lectures are restricted.`);
      else {
        const p = (await res.json().catch(() => null))?.d?.Presentation;
        const captionsUrl = p?.Transcripts?.[0]?.CaptionsUrl;
        if (!p) notes.push('Mediasite did not return details for this lecture. It may be restricted, or the player layout changed.');
        else if (!captionsUrl) notes.push('This lecture has no transcript or captions published in Mediasite.');
        else {
          const target = new URL(captionsUrl, location.href);
          if (target.protocol !== 'https:' && target.protocol !== 'http:') notes.push('Mediasite gave a transcript address that is not a web address.');
          else {
            const cr = await fetch(target.href, { credentials: 'include' });
            if (!cr.ok) notes.push(`The transcript download failed (${cr.status}).`);
            else {
              const raw = await cr.text();
              if (raw.length > 5000000) notes.push('The transcript is larger than 5 MB, which is more than expected for one lecture.');
              else items.push({ kind: 'mediasite', label: 'Mediasite transcript', title: String(p.Title || p.Name || document.title || '').slice(0, 200), raw, transcripts: Array.isArray(p.Transcripts) ? p.Transcripts.length : 1 });
            }
          }
        }
      }
    } catch {
      notes.push('The browser did not let the page fetch this lecture\'s transcript (it may be served from another address). Download it from the player and upload it in Klierly.');
    }
  }
  return { frame: location.origin + location.pathname, title: document.title, media: media.length, items, notes };
}

const stamp = (sec) => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}.${p(ms % 1000, 3)}`;
};

/** Caption cues → a WebVTT file, so Klierly keeps the timestamps for citations. */
export function toVtt(cues) {
  const lines = ['WEBVTT', ''];
  for (const c of cues) {
    if (!c.t || !(c.e > c.s)) continue;
    lines.push(`${stamp(c.s)} --> ${stamp(c.e)}`, c.t.replace(/-->/g, '->'), '');
  }
  return lines.join('\n');
}

const decodeEntities = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;|&#39;/g, "'").replace(/&amp;/g, '&');

/** "00:01:02.500", "1:02.5", "62.5s" → seconds, or null. */
function clockToSeconds(v) {
  const t = String(v || '').trim();
  const secs = /^(\d+(?:\.\d+)?)s$/.exec(t);
  if (secs) return Number(secs[1]);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{2}(?:[.,]\d+)?)$/.exec(t);
  return m ? Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3].replace(',', '.')) : null;
}

/** Timed-text XML (TTML / DFXP) → WebVTT, or '' if it holds no timed lines. */
export function ttmlToVtt(xml) {
  const cues = [];
  for (const m of String(xml).matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
    const begin = /\bbegin="([^"]+)"/i.exec(m[1]), end = /\bend="([^"]+)"/i.exec(m[1]), dur = /\bdur="([^"]+)"/i.exec(m[1]);
    const s = clockToSeconds(begin?.[1]);
    const e = end ? clockToSeconds(end[1]) : dur && s !== null ? s + (clockToSeconds(dur[1]) ?? 0) : null;
    const t = decodeEntities(m[2].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    if (s !== null && e !== null && t) cues.push({ s, e, t });
  }
  return cues.length ? toVtt(cues) : '';
}

/**
 * What a transcript download actually is. Mediasite's format has not been confirmed on a real UF
 * lecture, so this accepts WebVTT, SRT, timed-text XML and plain text, and refuses anything else
 * (for example JSON) rather than importing noise.
 */
export function normalizeTranscript(raw) {
  const t = String(raw ?? '').replace(/^\uFEFF/, '').trim();
  if (!t) return { format: 'empty' };
  if (/^WEBVTT/.test(t)) return { format: 'vtt', text: t };
  if (/^\d+\s*\r?\n\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}\s*-->/.test(t)) return { format: 'srt', text: t };
  if (/^<\?xml|^<tt[\s>]/i.test(t) || /<tt[\s>]/i.test(t.slice(0, 600))) { const vtt = ttmlToVtt(t); return vtt ? { format: 'vtt', text: vtt } : { format: 'unrecognised' }; }
  if (/^[[{<]/.test(t)) return { format: 'unrecognised' };
  return { format: 'text', text: t };
}

/** Turn what the frames returned into importable files. Reasons something was skipped go into `notes`. */
export function captionFiles(results, baseTitle, notes = []) {
  const files = [];
  for (const r of results) {
    for (const n of r?.notes ?? []) notes.push(n);
    for (const item of r?.items ?? []) {
      if (item.kind === 'mediasite') {
        const t = normalizeTranscript(item.raw);
        if (t.format === 'empty') { notes.push('The Mediasite transcript was empty.'); continue; }
        if (t.format === 'unrecognised') { notes.push('Mediasite returned a transcript in a format Klierly does not recognise yet. Nothing was imported; please share what its first few lines look like so support can be added.'); continue; }
        const timed = t.format === 'vtt' || t.format === 'srt';
        const n = files.length + 1;
        files.push({ title: `${item.title || baseTitle} — transcript`, filename: `mediasite-${n}.${t.format === 'text' ? 'txt' : t.format}`, mime: t.format === 'vtt' ? 'text/vtt' : t.format === 'srt' ? 'application/x-subrip' : 'text/plain', text: t.text, cues: timed ? (t.text.match(/-->/g) || []).length : 0, frame: r.frame, preview: t.text.replace(/WEBVTT|\d{1,2}:\d{2}:\d{2}[.,]\d+\s*-->\s*\d{1,2}:\d{2}:\d{2}[.,]\d+|^\d+$/gm, ' ').replace(/\s+/g, ' ').trim().slice(0, 200), source: 'mediasite' });
        continue;
      }
      const n = files.length + 1;
      const suffix = item.lang || item.label ? ` (${item.lang || item.label})` : '';
      if (item.kind === 'track') files.push({ title: `${baseTitle} — captions${suffix}`, filename: `captions-${n}.vtt`, mime: 'text/vtt', text: toVtt(item.cues), cues: item.cues.length, frame: r.frame, preview: item.cues.slice(0, 3).map((c) => c.t).join(' ') });
      else files.push({ title: `${baseTitle} — transcript`, filename: `transcript-${n}.txt`, mime: 'text/plain', text: item.text, cues: 0, frame: r.frame, preview: item.text.slice(0, 200) });
    }
  }
  return files;
}
