import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { workerHealth } from "@/lib/worker";

export const dynamic = "force-dynamic";

export async function GET() {
  let database = false;
  try { await db.execute(sql`select 1`); database = true; } catch { /* reported below */ }
  const worker = await workerHealth();
  const ok = database && worker;
  return NextResponse.json({ status: ok ? "ok" : "degraded", database, worker }, { status: ok ? 200 : 503 });
}
