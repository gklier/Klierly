"use client";
import { useActionState } from "react";
import { approveAccount, recoverAccount, type AccountState } from "@/app/actions/accounts";

export function AccountInvitationForm({ userId }: { userId?: string }) {
  const [state, action, pending] = useActionState<AccountState, FormData>(userId ? recoverAccount : approveAccount, {});
  return <form action={action} className="space-y-3">
    {userId ? <>
      <input name="userId" type="hidden" value={userId} />
      <label className="text-sm"><input type="checkbox" name="verified" required /> I verified this request through the approved email address. Revoke existing passkeys and issue a new enrollment link.</label>
    </> : <div className="flex flex-wrap gap-3">
      <label className="text-sm">Name<input name="name" className="input" required maxLength={80} /></label>
      <label className="text-sm">Email<input name="email" type="email" className="input" required maxLength={200} /></label>
    </div>}
    <button className="btn btn-sm" disabled={pending}>{pending ? "Saving…" : userId ? "Issue enrollment / recovery link" : "Approve account"}</button>
    {state?.error && <p role="alert">{state.error}</p>}
    {state?.ok && <p role="status">{state.ok}</p>}
    {state?.enrollmentUrl && <input className="input" aria-label="Private enrollment link" readOnly value={state.enrollmentUrl} onFocus={(e) => e.target.select()} />}
  </form>;
}
