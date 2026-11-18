"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function ProcessingStatus() {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [router]);
  return <p className="notice mt-4" role="status">This source is being processed. Its excerpts will appear automatically.</p>;
}
