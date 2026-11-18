"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { pasteText } from "@/app/actions/courses";
import { ActionForm, Submit } from "./forms";
import { Icon } from "./icons";

type Item = { key: string; name: string; progress: number; state: "uploading" | "queued" | "duplicate" | "error"; message?: string };
type Module = { id: string; name: string };
const ACCEPT = ".pdf,.docx,.pptx,.txt,.md,.markdown,.html,.htm,.csv,.xlsx,.srt,.vtt";

export function ImportPanel({ courseId, modules, maxMb, pendingAtLoad }: { courseId: string; modules: Module[]; maxMb: number; pendingAtLoad: number }) {
  const router = useRouter();
  const [tab, setTab] = useState<"upload" | "paste">("upload");
  const [permission, setPermission] = useState(false);
  const [moduleId, setModuleId] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [dragging, setDragging] = useState(false);
  const [polling, setPolling] = useState(pendingAtLoad > 0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (pendingAtLoad > 0) setPolling(true); }, [pendingAtLoad]);

  // While anything is processing, check the count of pending imports and refresh the server-rendered
  // list only when that count changes. (Refreshing on every tick re-rendered the whole page every
  // 1.5 s, and a refresh landing while the page was still hydrating caused React hydration errors.)
  useEffect(() => {
    if (!polling) return;
    let stop = false;
    let lastSeen = pendingAtLoad;
    const tick = async () => {
      try {
        const r = await fetch(`/api/courses/${courseId}/status`, { cache: "no-store" });
        const { pending } = (await r.json()) as { pending: number };
        if (stop) return;
        if (pending !== lastSeen) { lastSeen = pending; router.refresh(); }
        if (pending === 0) setPolling(false);
      } catch { /* try again on the next tick */ }
    };
    const t = setInterval(tick, 1500);
    return () => { stop = true; clearInterval(t); };
  }, [polling, courseId, router, pendingAtLoad]);

  const uploadOne = useCallback((file: File) => {
    const key = `${file.name}-${file.size}-${Date.now()}-${Math.random()}`;
    const patch = (p: Partial<Item>) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));
    setItems((list) => [{ key, name: file.name, progress: 0, state: "uploading" }, ...list]);
    if (file.size > maxMb * 1048576) { patch({ state: "error", message: `Larger than the ${maxMb} MB limit.` }); return; }
    const body = new FormData();
    body.set("file", file); body.set("permission", "yes"); body.set("moduleId", moduleId);
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/courses/${courseId}/upload`);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) patch({ progress: Math.round((e.loaded / e.total) * 100) }); };
    xhr.onerror = () => patch({ state: "error", message: "The upload was interrupted. Check your connection and try again." });
    xhr.onload = () => {
      let json: { duplicate?: boolean; error?: { message?: string } } = {};
      try { json = JSON.parse(xhr.responseText); } catch { /* handled below */ }
      if (xhr.status >= 200 && xhr.status < 300) {
        patch(json.duplicate ? { state: "duplicate", progress: 100, message: "Already in this course — not imported again." } : { state: "queued", progress: 100, message: "Uploaded. Extracting text…" });
        setPolling(true);
        router.refresh();
      } else patch({ state: "error", message: json.error?.message ?? `Upload failed (${xhr.status}).` });
    };
    xhr.send(body);
  }, [courseId, moduleId, maxMb, router]);

  const add = (files: FileList | null) => { if (files && permission) Array.from(files).slice(0, 30).forEach(uploadOne); };

  return (
    <section className="panel p-4 sm:p-5" aria-labelledby="import-h">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="import-h" className="text-base font-semibold">Add material</h2>
        <div role="tablist" aria-label="Import method" className="flex rounded-lg bg-surface-2 p-0.5 text-sm">
          {(["upload", "paste"] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={`rounded-md px-3 py-1.5 font-medium ${tab === t ? "bg-surface shadow-sm" : "text-muted"}`}>
              {t === "upload" ? "Upload files" : "Paste text"}
            </button>
          ))}
        </div>
      </div>

      {tab === "upload" ? (
        <div className="mt-4" role="tabpanel">
          <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-1 size-4 accent-[var(--accent)]" checked={permission} onChange={(e) => setPermission(e.target.checked)} />
              <span>I am allowed to use this material for my own study, and it is not an exam, quiz or answer key that I am not permitted to keep.</span>
            </label>
            {modules.length > 0 && (
              <div>
                <label className="label" htmlFor="up-module">Module</label>
                <select id="up-module" className="input" value={moduleId} onChange={(e) => setModuleId(e.target.value)}>
                  <option value="">Decide automatically</option>
                  {modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <div
            onDragOver={(e) => { e.preventDefault(); if (permission) setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files); }}
            className={`mt-3 rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors ${dragging ? "border-accent bg-accent-soft" : "border-line"} ${permission ? "" : "opacity-60"}`}>
            <input ref={input} type="file" multiple accept={ACCEPT} className="sr-only" id="file-input" onChange={(e) => { add(e.target.files); e.target.value = ""; }} disabled={!permission} />
            <button type="button" className="btn btn-primary" disabled={!permission} onClick={() => input.current?.click()}><Icon name="upload" />Choose files</button>
            <p className="mt-2 text-sm text-muted">{permission ? "or drop them here" : "Tick the box above to enable uploads"}</p>
            <p className="mt-1 text-xs text-muted">PDF, DOCX, PPTX, TXT, Markdown, HTML, CSV, XLSX, SRT, VTT · up to {maxMb} MB each · scanned PDFs without a text layer are not supported</p>
          </div>
          {items.length > 0 && (
            <ul className="mt-3 space-y-2" aria-live="polite">
              {items.map((i) => (
                <li key={i.key} className="rounded-lg border border-line px-3 py-2 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate font-medium">{i.name}</span>
                    <span className={`badge ${i.state === "error" ? "badge-bad" : i.state === "uploading" ? "" : i.state === "duplicate" ? "badge-warn" : "badge-good"}`}>
                      {i.state === "uploading" ? `${i.progress}%` : i.state === "queued" ? "Uploaded" : i.state === "duplicate" ? "Duplicate" : "Failed"}
                    </span>
                  </div>
                  {i.state === "uploading" && <div className="mt-2 h-1 overflow-hidden rounded bg-surface-2"><div className="h-full bg-accent transition-[width]" style={{ width: `${i.progress}%` }} /></div>}
                  {i.message && <p className={`mt-1 ${i.state === "error" ? "text-bad" : "text-muted"}`}>{i.message}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <ActionForm action={pasteText} className="mt-4 space-y-3" resetOnOk>
          <input type="hidden" name="courseId" value={courseId} />
          <div className="grid gap-3 sm:grid-cols-2">
            <div><label className="label" htmlFor="p-title">Title</label><input id="p-title" name="title" className="input" maxLength={200} placeholder="Week 5 lecture notes" required /></div>
            <div>
              <label className="label" htmlFor="p-module">Module</label>
              <select id="p-module" name="moduleId" className="input" defaultValue="">
                <option value="">{modules.length ? "Decide automatically" : "No modules yet"}</option>
                {modules.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label" htmlFor="p-text">Text</label>
            <textarea id="p-text" name="text" className="input font-serif" rows={8} required placeholder="Paste the text of a course page, reading or your own notes" />
          </div>
          <div>
            <label className="label" htmlFor="p-url">Page address <span className="font-normal text-muted">(optional, kept as the source link)</span></label>
            <input id="p-url" name="url" type="url" className="input" placeholder="https://…" />
          </div>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" name="permission" className="mt-1 size-4 accent-[var(--accent)]" required />
            <span>I am allowed to use this material for my own study, and it is not an exam, quiz or answer key that I am not permitted to keep.</span>
          </label>
          <Submit pendingText="Adding…">Add text</Submit>
        </ActionForm>
      )}
      {polling && <p className="mt-3 flex items-center gap-2 text-sm text-muted" role="status"><span className="spinner" />Processing imports…</p>}
    </section>
  );
}
