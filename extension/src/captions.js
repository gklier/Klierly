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
  return { frame: location.origin + location.pathname, title: document.title, media: media.length, items };
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

/** Turn what the frames returned into importable files. */
export function captionFiles(results, baseTitle) {
  const files = [];
  for (const r of results) {
    for (const item of r?.items ?? []) {
      const n = files.length + 1;
      const suffix = item.lang || item.label ? ` (${item.lang || item.label})` : '';
      if (item.kind === 'track') files.push({ title: `${baseTitle} — captions${suffix}`, filename: `captions-${n}.vtt`, mime: 'text/vtt', text: toVtt(item.cues), cues: item.cues.length, frame: r.frame, preview: item.cues.slice(0, 3).map((c) => c.t).join(' ') });
      else files.push({ title: `${baseTitle} — transcript`, filename: `transcript-${n}.txt`, mime: 'text/plain', text: item.text, cues: 0, frame: r.frame, preview: item.text.slice(0, 200) });
    }
  }
  return files;
}
