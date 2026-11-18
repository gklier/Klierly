"use client";
import { useRef, useState, type ReactNode, type FormEvent, type Ref } from "react";
import { confirmationScope } from "@/lib/approval-scope";
import { startAuthentication } from "@simplewebauthn/browser";
import { authenticationOptions, authenticate } from "@/app/actions/passkeys";

export async function confirmWithPasskey(scope: string) {
  const options = await authenticationOptions(scope);
  await authenticate(await startAuthentication({ optionsJSON: options }));
}

export function PasskeyApprovalForm({ action, scope, children, className, formRef }: { formRef?: Ref<HTMLFormElement>; action: (form: FormData) => void; scope?: string; children: ReactNode; className?: string }) {
  const authorized = useRef(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    if (!scope || authorized.current) { authorized.current = false; return; }
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    setError(""); setBusy(true);
    try {
      await confirmWithPasskey(await confirmationScope(scope, new FormData(form)));
      authorized.current = true;
      form.requestSubmit();
    } catch (error) {
      authorized.current = false;
      setError(error instanceof Error ? error.message : "Passkey confirmation failed.");
    } finally { setBusy(false); }
  }
  return <form ref={formRef} action={action} onSubmit={submit} className={className}>
    {children}
    {busy && <p role="status">Confirm this change with your passkey…</p>}
    {error && <p role="alert" className="notice notice-warn">{error}</p>}
  </form>;
}
