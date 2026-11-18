"use client";

import { useState } from "react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { authenticate, authenticationOptions, registrationOptions, registerPasskey } from "@/app/actions/passkeys";

export function PasskeyForm({ enroll = false, add = false }: { enroll?: boolean; add?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run() {
    setBusy(true);
    setError("");
    try {
      if (enroll || add) {
        const invitation = enroll ? new URLSearchParams(location.hash.slice(1)).get("token") : null;
        if (enroll && !invitation) throw new Error("Open the complete enrollment link provided by the administrator.");
        const options = await registrationOptions(invitation);
        const response = await startRegistration({ optionsJSON: options });
        await registerPasskey(response, "Passkey");
        history.replaceState(null, "", location.pathname);
      } else {
        const options = await authenticationOptions();
        await authenticate(await startAuthentication({ optionsJSON: options }));
      }
      location.assign(add ? "/settings" : "/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Passkey sign-in failed. Please try again.");
      setBusy(false);
    }
  }
  return <div className="mt-6 space-y-3">
    <button type="button" className="btn btn-primary" disabled={busy} onClick={run}>{busy ? "Waiting for your passkey…" : enroll || add ? "Create a passkey" : "Sign in with a passkey"}</button>
    {error && <p role="alert" className="notice notice-warn">{error}</p>}
  </div>;
}
