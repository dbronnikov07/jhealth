// The one place the app talks to the database. Server-side only.
//
// DATABASE_URL set   -> Supabase (any Postgres), through the `postgres` driver.
// DATABASE_URL empty -> PGlite: real Postgres running inside this Node process, stored in
//                       ~/jhealth-cache/pglite-dev, built from the same supabase/ SQL files.
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export type Db = {
  mode: "supabase" | "local";
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
};

const shared = globalThis as unknown as { __jhealthDb?: Promise<Db> };

export function getDb(): Promise<Db> {
  shared.__jhealthDb ??= connect().catch((error) => {
    shared.__jhealthDb = undefined; // let the next request try again
    throw error;
  });
  return shared.__jhealthDb;
}

/** The cloud database address: DATABASE_URL, or POSTGRES_URL as Vercel's Supabase integration names it. */
export function databaseUrl(env: Record<string, string | undefined> = process.env): string | undefined {
  return env.DATABASE_URL || env.POSTGRES_URL || undefined;
}

/**
 * Connection options for a cloud Postgres URL. Integration URLs carry extra parameters meant for other drivers
 * (Prisma's `pgbouncer`, Supabase's `supa`); Postgres would reject them as unknown settings, so only the address
 * is kept. Anything that is not this computer is reached over TLS only.
 */
export function cloudConnection(raw: string): { url: string; ssl: false | "require" } {
  const url = new URL(raw);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  url.search = "";
  return { url: url.toString(), ssl: local ? false : "require" };
}

async function connect(): Promise<Db> {
  const raw = databaseUrl();
  if (raw) {
    const { default: postgres } = await import("postgres");
    const { url, ssl } = cloudConnection(raw);
    // prepare: false is required by Supabase's transaction pooler (port 6543), which serverless hosts should use.
    const sql = postgres(url, { prepare: false, max: 5, idle_timeout: 20, ssl });
    return {
      mode: "supabase",
      query: async <T,>(text: string, params: unknown[] = []) =>
        (await sql.unsafe(text, params as never[])) as unknown as T[],
    };
  }

  // A hosted deployment must never silently fall back to an empty throwaway database.
  if (process.env.VERCEL) throw new Error("DATABASE_URL (or POSTGRES_URL) is not set on this deployment");
  const { PGlite } = await import("@electric-sql/pglite");
  const dir = process.env.PGLITE_DIR ?? path.join(os.homedir(), "jhealth-cache", "pglite-dev");
  mkdirSync(dir, { recursive: true });
  const pg = new PGlite(dir);
  await migrateLocal(pg);
  return {
    mode: "local",
    query: async <T,>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows,
  };
}

type PGliteLike = {
  exec(sql: string): Promise<unknown>;
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(fn: (tx: { exec(sql: string): Promise<unknown>; query(sql: string, params?: unknown[]): Promise<unknown> }) => Promise<T>): Promise<T>;
};

/** Apply any supabase/migrations not yet applied to the local database, then the (repeatable) seed. */
async function migrateLocal(pg: PGliteLike) {
  const supabaseDir = process.env.SUPABASE_DIR ?? path.resolve(process.cwd(), "..", "supabase");
  await pg.exec("create table if not exists _local_migrations (name text primary key, applied_at timestamptz default now())");
  const done = new Set((await pg.query<{ name: string }>("select name from _local_migrations")).rows.map((r) => r.name));
  const files = readdirSync(path.join(supabaseDir, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const sql = readFileSync(path.join(supabaseDir, "migrations", file), "utf8");
    await pg.transaction(async (tx) => {
      await tx.exec(sql);
      await tx.query("insert into _local_migrations (name) values ($1)", [file]);
    });
  }
  await pg.exec(readFileSync(path.join(supabaseDir, "seed.sql"), "utf8"));
}

/** Postgres error code, e.g. 23505 for "unique value already exists". */
export function pgCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : undefined;
}

/** First line of a Postgres error, safe to show to the doctor. */
export function pgMessage(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] : "Something went wrong";
}
