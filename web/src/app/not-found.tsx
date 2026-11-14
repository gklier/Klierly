import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="mt-2 text-muted">This page does not exist, was deleted, or belongs to a different account.</p>
      <p className="mt-5"><Link className="btn btn-primary" href="/">Go to your courses</Link></p>
    </main>
  );
}
