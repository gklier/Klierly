import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as core from "./schema";
import * as authSchema from "./passkeys";
const schema = { ...core, ...authSchema };
import { env } from "@/lib/env";

type Db = NodePgDatabase<typeof schema>;
const g = globalThis as unknown as { __clPool?: Pool; __clDb?: Db };

export function getPool(): Pool {
  if (!g.__clPool) {
    g.__clPool = new Pool({ connectionString: env.databaseUrl, max: 10 });
    // An idle connection dropped by the database must not crash the process.
    g.__clPool.on("error", () => {});
  }
  return g.__clPool;
}

export function getDb(): Db {
  if (!g.__clDb) g.__clDb = drizzle(getPool(), { schema });
  return g.__clDb;
}

/** Lazy proxy so importing this module never opens a connection at build time. */
export const db: Db = new Proxy({} as Db, {
  get(_t, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export { schema };
