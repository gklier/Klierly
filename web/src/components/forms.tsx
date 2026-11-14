"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

export type ActionState = { error?: string; ok?: string } | null;
type Action = (prev: ActionState, formData: FormData) => Promise<ActionState>;

export function Submit({ children, className = "btn btn-primary", pendingText, disabled }: { children: React.ReactNode; className?: string; pendingText?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending || disabled} aria-busy={pending}>
      {pending && <span className="spinner" aria-hidden="true" />}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}

/** A form bound to a server action that reports `{ error }` or `{ ok }` inline. */
export function ActionForm({ action, children, className, resetOnOk }: { action: Action; children: React.ReactNode; className?: string; resetOnOk?: boolean }) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => { if (state?.ok && resetOnOk) ref.current?.reset(); }, [state, resetOnOk]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      <div aria-live="polite">
        {state?.error && <p role="alert" className="notice notice-bad mt-3">{state.error}</p>}
        {state?.ok && <p className="notice notice-good mt-3">{state.ok}</p>}
      </div>
    </form>
  );
}

/** Two-step destructive button: the action only runs after an explicit confirmation. */
export function ConfirmAction({ action, label, confirmLabel, description, hidden, className = "btn btn-danger btn-sm" }: {
  action: Action; label: React.ReactNode; confirmLabel: string; description: string; hidden?: Record<string, string>; className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction] = useActionState(action, null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>{label}</button>
      <dialog ref={dialog} onClose={() => setOpen(false)} className="m-auto w-[min(92vw,26rem)] rounded-2xl border border-line bg-surface p-5 text-ink backdrop:bg-black/40">
        <h2 className="text-base font-semibold">{confirmLabel}?</h2>
        <p className="mt-2 text-sm text-muted">{description}</p>
        {state?.error && <p role="alert" className="notice notice-bad mt-3">{state.error}</p>}
        <form action={formAction} className="mt-5 flex justify-end gap-2">
          {Object.entries(hidden ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
          <Submit className="btn btn-danger" pendingText="Deleting…">{confirmLabel}</Submit>
        </form>
      </dialog>
    </>
  );
}
