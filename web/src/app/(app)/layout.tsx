import Link from "next/link";
import { logout } from "@/app/actions/auth";
import { Icon } from "@/components/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 btn">Skip to content</a>
      <header className="sticky top-0 z-30 border-b border-line backdrop-blur-md" style={{ background: "var(--nav)" }}>
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-1 px-3 sm:px-6">
          <Link href="/" className="mr-1 text-[1.05rem] font-semibold tracking-tight sm:mr-3" aria-label="Klierly — your courses">Klierly</Link>
          <nav aria-label="Main" className="flex items-center gap-1">
            <Link href="/" className="btn btn-quiet btn-sm max-sm:hidden">Courses</Link>
            <Link href="/settings" className="btn btn-quiet btn-sm">Settings</Link>
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <ThemeToggle />
            <span className="hidden text-sm text-muted sm:inline" title={user.email}>{user.name}</span>
            <form action={logout}><button className="btn btn-quiet btn-sm" type="submit">Sign out</button></form>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-20 pt-7 sm:px-6">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-8 text-xs text-muted sm:px-6">
        A study tool, not a way to complete graded work. <Link className="link" href="/privacy">Privacy and data flows</Link>
        <span className="sr-only"><Icon name="book" /></span>
      </footer>
    </>
  );
}
