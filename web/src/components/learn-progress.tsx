"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** While a build is running, re-read the server state every few seconds. Stops by itself when the page no longer renders it. */
export function BuildPoller({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(t);
  }, [active, router]);
  return null;
}
