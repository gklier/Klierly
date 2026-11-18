"use client";

import { useActionState } from "react";
import { createExtensionToken } from "@/app/actions/settings";
import { Submit } from "./forms";

export function TokenForm() {
  const [state, action] = useActionState(createExtensionToken, null);
  return (
    <form action={action} className="mt-3">
      <div className="flex flex-wrap items-end gap-2">
        <div><label className="label" htmlFor="tok-label">Name for this browser</label><input id="tok-label" name="label" className="input w-56" maxLength={60} placeholder="Laptop Chrome" /></div>
        <Submit className="btn" pendingText="Creating…">Create pairing token</Submit>
      </div>
      {state?.error && <p role="alert" className="notice notice-bad mt-3">{state.error}</p>}
      {state?.token && (
        <div className="notice notice-good mt-3">
          <p className="font-semibold">Copy this token into the extension&apos;s options now. It will not be shown again.</p>
          <code className="mt-2 block select-all break-all rounded bg-surface px-2 py-1.5 text-sm" data-testid="ext-token">{state.token}</code>
        </div>
      )}
    </form>
  );
}
