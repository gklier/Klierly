"use client";

import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
      <h1 className="text-2xl font-semibold">Something went wrong</h1>
      <p className="mt-2 text-muted">The page could not be loaded. Your data has not been changed. Try again; if it keeps happening, check that the database and the parsing service are running.</p>
      {error.digest && <p className="mt-2 text-xs text-muted">Reference: {error.digest}</p>}
      <p className="mt-5 flex gap-2"><button className="btn btn-primary" onClick={reset}>Try again</button><Link className="btn" href="/">Go to your courses</Link></p>
    </main>
  );
}
