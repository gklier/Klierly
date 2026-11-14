"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";

const ITEMS = [
  { slug: "", label: "Overview", icon: "home" },
  { slug: "/materials", label: "Materials", icon: "file" },
  { slug: "/plan", label: "Study plan", icon: "calendar" },
  { slug: "/practice", label: "Practice", icon: "target" },
  { slug: "/progress", label: "Progress", icon: "chart" },
  { slug: "/settings", label: "Settings", icon: "settings" },
];

export function CourseNav({ courseId, pendingSuggestions }: { courseId: string; pendingSuggestions: number }) {
  const pathname = usePathname();
  const base = `/courses/${courseId}`;
  return (
    <nav aria-label="Course" className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-2 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
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
  );
}
