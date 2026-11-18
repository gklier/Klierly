import Link from "next/link";
import { redirect } from "next/navigation";
import { register, registrationMode } from "@/app/actions/auth";
import { ActionForm, Submit } from "@/components/forms";
import { getUser } from "@/lib/auth";

export const metadata = { title: "Create account" };
export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  if (await getUser()) redirect("/");
  const mode = await registrationMode();
  return (
    <>
      <h1 className="text-2xl font-semibold">Create your account</h1>
      {mode === "closed" ? (
        <p className="notice mt-5">Registration is closed on this server. The owner can set an invite code (INVITE_CODE) to let others in.</p>
      ) : (
        <>
          <p className="mt-2 text-muted">
            {mode === "first-user" ? "You are setting up the first account on this server. After this, new accounts need an invite code." : "This server is invite-only."}
          </p>
          <ActionForm action={register} className="mt-7 space-y-4">
            <div><label className="label" htmlFor="name">Name</label><input className="input" id="name" name="name" autoComplete="name" required maxLength={80} /></div>
            <div><label className="label" htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" autoComplete="username" required /></div>
            <div>
              <label className="label" htmlFor="password">Password</label>
              <input className="input" id="password" name="password" type="password" autoComplete="new-password" required minLength={10} aria-describedby="pw-help" />
              <p className="help" id="pw-help">At least 10 characters. Stored only as a salted hash.</p>
            </div>
            {mode === "invite" && <div><label className="label" htmlFor="invite">Invite code</label><input className="input" id="invite" name="invite" required autoComplete="off" /></div>}
            <Submit pendingText="Creating account…">Create account</Submit>
          </ActionForm>
        </>
      )}
      <p className="mt-6 text-sm">Already have an account? <Link className="link" href="/login">Sign in</Link></p>
    </>
  );
}
