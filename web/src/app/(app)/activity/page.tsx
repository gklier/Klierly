import Link from "next/link";
import { and, desc, eq, like, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { clearActivityAction } from "@/app/actions/settings";
import { ConfirmAction } from "@/components/forms";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Activity" };

const GROUPS: [string, string, string | null][] = [["all", "Everything", null], ["source", "Imports", "source."], ["extension", "Extension", "extension."], ["ai", "AI", "ai."], ["practice", "Practice", "practice."], ["plan", "Plan", "plan."], ["suggestions", "Suggestions", "suggestions."], ["settings", "Settings", "settings."]];
const LABEL: Record<string, string> = {
  "source.created": "Imported a source", "source.updated": "Re-imported a changed source", "source.unchanged": "Source already up to date", "source.processed": "Source processed", "source.failed": "Source could not be processed",
  "extension.discovery.scan": "Scanned a course (extension)", "extension.discovery.run": "Imported from a course (extension)", "extension.captions.read": "Looked for lecture captions (extension)", "extension.capture.blocked": "Extension refused a page",
  "capture.blocked": "Server refused a capture", "ai.call": "AI request", "ai.questions": "Generated questions", "ai.topics": "Suggested topics", "practice.started": "Started practice", "practice.finished": "Finished practice",
  "plan.saved": "Saved study plan", "suggestions.accepted": "Accepted suggestions", "suggestions.dismissed": "Dismissed suggestions", "course.created": "Created a course", "course.deleted": "Deleted a course",
  "settings.provider_saved": "Saved AI provider", "settings.provider_tested": "Tested AI provider", "settings.provider_removed": "Removed AI provider", "settings.token_created": "Created extension token", "settings.token_revoked": "Revoked extension token",
  "auth.login": "Signed in", "auth.register": "Created account",
};
const short = (v: unknown): string => (v && typeof v === "object" ? JSON.stringify(v) : String(v));

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ g?: string }> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const g = GROUPS.find(([k]) => k === sp.g) ?? GROUPS[0];
  const [events, courses, [total]] = await Promise.all([
    db.select().from(schema.activityLog).where(and(eq(schema.activityLog.userId, user.id), g[2] ? like(schema.activityLog.event, `${g[2]}%`) : undefined)).orderBy(desc(schema.activityLog.at)).limit(300),
    db.select({ id: schema.courses.id, name: schema.courses.name }).from(schema.courses).where(eq(schema.courses.userId, user.id)),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.activityLog).where(eq(schema.activityLog.userId, user.id)),
  ]);
  const name = new Map(courses.map((c) => [c.id, c.name]));
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Activity</h1>
          <p className="mt-1 max-w-2xl text-muted">A record of what you did in Klierly and what it did for you: imports, extension runs, AI requests, practice, settings. <strong className="text-ink">Events, counts and the titles of what you imported</strong> — never what your documents say, prompts, your answers, passwords or keys. It belongs to your account and is deleted with it.</p>
        </div>
        <div className="flex gap-2">
          <a className="btn" href="/api/activity/export" download>Download diagnostics (JSON)</a>
          <ConfirmAction action={clearActivityAction} label="Clear log" confirmLabel="Clear the activity log" description={`All ${total?.n ?? 0} recorded events will be permanently deleted. Your courses and results are not affected.`} className="btn btn-danger" />
        </div>
      </div>
      <p className="notice text-sm">If something looks wrong — an import that failed, a course page that was skipped — download the diagnostics file and share it with whoever is helping you. It holds events, counts and the titles of your sources and topics, not their contents, so it is meant to be shared — but read it first if in doubt.</p>
      <nav aria-label="Filter" className="flex flex-wrap gap-1.5">
        {GROUPS.map(([key, label]) => <Link key={key} href={key === "all" ? "/activity" : `/activity?g=${key}`} aria-current={g[0] === key ? "page" : undefined} className={`btn btn-sm ${g[0] === key ? "!border-accent !bg-accent-soft !text-accent" : ""}`}>{label}</Link>)}
      </nav>
      {events.length === 0 ? <p className="notice">Nothing recorded {g[2] ? "in this category " : ""}yet.</p> : (
        <ul className="panel divide-y divide-line" data-testid="activity-list">
          {events.map((e) => {
            const failed = e.event === "source.failed" || (e.event === "ai.call" && e.details.ok === false);
            return (
              <li key={e.id} className="px-4 py-2.5 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  <span className="tnum w-36 shrink-0 text-muted">{e.at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" })}</span>
                  <span className={`font-medium ${failed ? "text-bad" : ""}`}>{LABEL[e.event] ?? e.event}</span>
                  {e.courseId && name.get(e.courseId) && <span className="text-muted">· {name.get(e.courseId)}</span>}
                  <span className="badge ml-auto">{e.source}</span>
                </div>
                {Object.keys(e.details).length > 0 && (
                  <p className="mt-1 break-words text-xs text-muted">{Object.entries(e.details).filter(([, v]) => v !== undefined && v !== null).map(([k, v]) => `${k}: ${short(v)}`).join(" · ").slice(0, 600)}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
