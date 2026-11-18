import { NextResponse } from "next/server";
import { desc, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { getUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { workerHealth } from "@/lib/worker";

export const dynamic = "force-dynamic";

/**
 * A diagnostics file for the signed-in user: recent activity plus counts per course.
 * Contains source and topic titles but no document text, prompts, answers, passwords, keys or email address.
 * Meant to be handed to whoever is helping debug (for example pasted into a Claude session).
 */
export async function GET() {
  const user = await getUser();
  if (!user) return NextResponse.json({ error: { code: "unauthorized", message: "Sign in first." } }, { status: 401 });
  const [events, courses, [acct]] = await Promise.all([
    db.select({ at: schema.activityLog.at, source: schema.activityLog.source, event: schema.activityLog.event, courseId: schema.activityLog.courseId, details: schema.activityLog.details })
      .from(schema.activityLog).where(eq(schema.activityLog.userId, user.id)).orderBy(desc(schema.activityLog.at)).limit(1000),
    db.execute<{ id: string; name: string; term: string | null; sample: boolean; allow_ai: boolean; docs: Record<string, number>; chunks: number; topics: number; objectives: number; questions: Record<string, number>; sessions: number; answers: number; correct: number }>(sql`
      select c.id, c.name, c.term, c.is_sample as sample, c.allow_external_ai as allow_ai,
        coalesce((select jsonb_object_agg(status, n) from (select status, count(*)::int n from source_documents where course_id = c.id group by status) d), '{}') as docs,
        (select count(*)::int from source_chunks where course_id = c.id) as chunks,
        (select count(*)::int from topics where course_id = c.id) as topics,
        (select count(*)::int from learning_objectives where course_id = c.id) as objectives,
        coalesce((select jsonb_object_agg(k, n) from (select origin || '/' || status as k, count(*)::int n from questions where course_id = c.id group by 1) q), '{}') as questions,
        (select count(*)::int from practice_sessions where course_id = c.id) as sessions,
        (select count(*)::int from answers where course_id = c.id and is_correct is not null) as answers,
        (select count(*)::int from answers where course_id = c.id and is_correct) as correct
      from courses c where c.user_id = ${user.id} order by c.created_at`),
    db.select({ createdAt: schema.users.createdAt }).from(schema.users).where(eq(schema.users.id, user.id)).limit(1),
  ]);
  const body = {
    format: "klierly-diagnostics/1",
    generatedAt: new Date().toISOString(),
    note: "Events, counts and the titles of sources and topics. No document text, prompts, answers, passwords, API keys or email addresses are included.",
    environment: { managedAiConfigured: Boolean(env.managedAi), managedAiModels: env.managedAi ? { routine: env.managedAi.model, strong: env.managedAi.strongModel } : null, workerReachable: await workerHealth(), accountCreatedAt: acct?.createdAt },
    courses: courses.rows,
    events,
  };
  return new NextResponse(JSON.stringify(body, null, 2), {
    headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="klierly-diagnostics-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "private, no-store" },
  });
}
