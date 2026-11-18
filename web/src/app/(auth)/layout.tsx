import Link from "next/link";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-5 py-10">
      <p className="mb-8 text-lg font-semibold tracking-tight">Klierly</p>
      {children}
      <p className="mt-10 text-sm text-muted">
        A private study tool. Your course material stays in your account. <Link className="link" href="/privacy">How your data is handled</Link>
      </p>
    </main>
  );
}
