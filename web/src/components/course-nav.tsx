"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";

const ITEMS = [
  { slug: "", label: "Overview", icon: "home" },
  { slug: "/study", label: "Study", icon: "spark" },
  { slug: "/learn", label: "Learn", icon: "spark" },
  { slug: "/materials", label: "Materials", icon: "file" },
  { slug: "/plan", label: "Study plan", icon: "calendar" },
  { slug: "/practice", label: "Practice", icon: "target" },
  { slug: "/library", label: "Class library", icon: "users" },
  { slug: "/progress", label: "Progress", icon: "chart" },
  { slug: "/settings", label: "Settings", icon: "settings" },
];

export function CourseNav({ courseId, pendingSuggestions }: { courseId: string; pendingSuggestions: number }) {
  const pathname = usePathname();
  const base = `/courses/${courseId}`;
  const mobile = ITEMS.filter(it => ["/study", "/plan", "/practice", "/materials"].includes(it.slug));
  return (
    <>
    <nav aria-label="Course" className="hidden gap-1 lg:flex lg:flex-col">
      {ITEMS.map((it) => {
        const href = base + it.slug;
        const active = it.slug === "" ? pathname === base : pathname.startsWith(href);
        return (
          <Link key={it.slug} href={href} aria-current={active ? "page" : undefined}
            className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${active ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-ink"}`}>
            <Icon name={it.icon} />{it.label}
            {it.slug === "/materials" && pendingSuggestions > 0 && <span className="badge badge-accent ml-auto" title="Suggestions waiting for review">{pendingSuggestions}</span>}
          </Link>
        );
      })}
    </nav>
    <nav aria-label="Mobile course" className="mobile-course-nav fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 lg:hidden">
      {mobile.map(it => <Link key={it.slug} href={base+it.slug} aria-current={pathname.startsWith(base+it.slug) ? "page" : undefined} className={`flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[.65rem] font-medium ${pathname.startsWith(base+it.slug) ? "text-accent" : "text-muted"}`}><Icon name={it.icon} size={21}/>{it.label === "Study plan" ? "Plan" : it.label}</Link>)}
      <details className="group relative"><summary className="flex min-h-16 cursor-pointer list-none flex-col items-center justify-center gap-1 px-1 text-[.65rem] font-medium text-muted"><Icon name="settings" size={21}/>More</summary><div className="absolute bottom-full right-2 mb-2 w-56 rounded-xl border border-line bg-surface p-2 shadow-xl">{ITEMS.filter(it=>!mobile.includes(it)).map(it=><Link key={it.slug} href={base+it.slug} className="flex min-h-12 items-center gap-3 rounded-lg px-3 text-sm hover:bg-surface-2"><Icon name={it.icon}/>{it.label}</Link>)}</div></details>
    </nav>
    </>
  );
}
