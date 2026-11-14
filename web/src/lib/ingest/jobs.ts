import { eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { log } from "@/lib/log";
import { WorkerError } from "@/lib/worker";

type State = { running: boolean; timer: NodeJS.Timeout | null; pending: boolean };
const g = globalThis as unknown as { __clJobs?: State };
const state = (g.__clJobs ??= { running: false, timer: null, pending: false });

const BACKOFF_SEC = [5, 30, 120];

async function claim() {
  const res = await db.execute<{ id: string; document_id: string; attempts: number; max_attempts: number }>(sql`
    update import_jobs set status = 'running', attempts = attempts + 1, updated_at = now(),
      log = log || jsonb_build_array(jsonb_build_object('at', now(), 'msg', 'Started attempt ' || (attempts + 1)))
    where id = (
      select id from import_jobs
      where (status = 'queued' and run_after <= now())
         or (status = 'running' and updated_at < now() - interval '5 minutes')
      order by created_at limit 1 for update skip locked)
    returning id, document_id, attempts, max_attempts`);
  return res.rows[0] ?? null;
}

const appendLog = (msg: string) => sql`log || jsonb_build_array(jsonb_build_object('at', now(), 'msg', ${msg}::text))`;

export async function runOneJob(): Promise<boolean> {
  const job = await claim();
  if (!job) return false;
  const { processDocument } = await import("./pipeline");
  try {
    const r = await processDocument(job.document_id);
    await db.update(schema.importJobs).set({ status: "done", lastError: null, updatedAt: new Date(), log: appendLog(`Done: ${r.chunks} chunks via ${r.parser} parser`) as never })
      .where(eq(schema.importJobs.id, job.id));
  } catch (e) {
    const permanent = e instanceof WorkerError && e.permanent;
    // Only WorkerError messages are written for the user; anything else stays generic so internals and contents never leak.
    const message = e instanceof WorkerError ? e.message : "Processing failed unexpectedly.";
    const exhausted = permanent || job.attempts >= job.max_attempts;
    if (!(e instanceof WorkerError)) log("error", "import.unexpected", { jobId: job.id, error: e instanceof Error ? e.name : "unknown" });
    if (exhausted) {
      await db.update(schema.importJobs).set({ status: "failed", lastError: message, updatedAt: new Date(), log: appendLog(`Failed: ${message}`) as never }).where(eq(schema.importJobs.id, job.id));
      await db.update(schema.sourceDocuments).set({ status: "failed", error: message }).where(eq(schema.sourceDocuments.id, job.document_id));
    } else {
      const delay = BACKOFF_SEC[Math.min(job.attempts - 1, BACKOFF_SEC.length - 1)];
      await db.update(schema.importJobs).set({
        status: "queued", lastError: message, updatedAt: new Date(), runAfter: new Date(Date.now() + delay * 1000),
        log: appendLog(`Attempt failed (${message}) — retrying in ${delay}s`) as never,
      }).where(eq(schema.importJobs.id, job.id));
      await db.update(schema.sourceDocuments).set({ status: "queued", error: `${message} Retrying automatically.` }).where(eq(schema.sourceDocuments.id, job.document_id));
    }
    log("warn", "import.failed", { jobId: job.id, permanent, attempts: job.attempts, code: e instanceof WorkerError ? e.code : "unexpected" });
  }
  return true;
}

async function drain() {
  if (state.running) { state.pending = true; return; }
  state.running = true;
  try {
    do {
      state.pending = false;
      while (await runOneJob()) { /* keep going */ }
    } while (state.pending);
  } catch (e) {
    log("error", "jobs.loop", { error: e instanceof Error ? e.message : "unknown" });
  } finally {
    state.running = false;
  }
}

/** Wake the runner now (called right after a job is queued). */
export function kickJobs() { void drain(); }

/** Start the polling loop once per process (see instrumentation.ts). */
export function startJobLoop(intervalMs = 4000) {
  if (state.timer) return;
  state.timer = setInterval(kickJobs, intervalMs);
  state.timer.unref?.();
  kickJobs();
}

export async function retryDocument(userId: string, documentId: string): Promise<boolean> {
  const res = await db.execute(sql`
    update import_jobs set status = 'queued', attempts = 0, run_after = now(), updated_at = now(),
      log = log || jsonb_build_array(jsonb_build_object('at', now(), 'msg', 'Retry requested'))
    where document_id = ${documentId} and user_id = ${userId} and status in ('failed', 'queued')`);
  if (!res.rowCount) return false;
  await db.update(schema.sourceDocuments).set({ status: "queued", error: null }).where(eq(schema.sourceDocuments.id, documentId));
  kickJobs();
  return true;
}
