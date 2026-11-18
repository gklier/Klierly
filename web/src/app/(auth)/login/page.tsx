import Link from "next/link";
import { redirect } from "next/navigation";
import { login, registrationMode } from "@/app/actions/auth";
import { ActionForm, Submit } from "@/components/forms";
import { getUser } from "@/lib/auth";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getUser()) redirect("/");
  const mode = await registrationMode();
  return (
    <>
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-2 text-muted">Study from your own course material: practice questions, a day-by-day plan, and honest progress tracking.</p>
      <ActionForm action={login} className="mt-7 space-y-4">
        <div><label className="label" htmlFor="email">Email</label><input className="input" id="email" name="email" type="email" autoComplete="username" required /></div>
        <div><label className="label" htmlFor="password">Password</label><input className="input" id="password" name="password" type="password" autoComplete="current-password" required /></div>
        <Submit pendingText="Signing in…">Sign in</Submit>
      </ActionForm>
      {mode !== "closed" && (
        <p className="mt-6 text-sm">
          {mode === "first-user" ? "No account exists on this server yet. " : "Have an invite code? "}
          <Link className="link" href="/register">Create an account</Link>
        </p>
      )}
    </>
  );
}
