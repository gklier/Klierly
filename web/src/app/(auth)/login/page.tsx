import { redirect } from "next/navigation";
import { getUser } from "@/lib/auth";
import { PasskeyForm } from "@/components/passkey-form";

export const metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";
export default async function LoginPage() {
  if (await getUser()) redirect("/");
  return <>
    <h1 className="text-2xl font-semibold">Sign in to Klierly</h1>
    <PasskeyForm />
    <p className="mt-6 text-sm">To request an account or recover access, email <a className="link" href="mailto:gabriel.klier@ufl.edu?subject=Klierly%20account%20request">gabriel.klier@ufl.edu</a> from the address you want to use.</p>
  </>;
}
