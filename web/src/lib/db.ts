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

/**
 * How JSON parameters reach Postgres. The app writes JSON as text it has already built (`JSON.stringify(...)` into
 * `$n::jsonb`), which is what PGlite expects. The `postgres` driver would encode that text a second time, storing a
 * JSON *string* instead of an object (buttons and labels silently lost on Supabase), so text is sent as it is.
 */
export const jsonbAsText = {
  to: 3802,
  from: [114, 3802],
  serialize: (x: unknown) => (typeof x === "string" ? x : JSON.stringify(x)),
  parse: (x: string) => JSON.parse(x),
};

/** The driver settings the app uses for a cloud database (also used by scripts/db-remote.mjs to check them). */
export function postgresOptions(ssl: false | "require") {
  // prepare: false is required by Supabase's transaction pooler (port 6543), which serverless hosts should use.
  // max_pipeline: 1 sends one query at a time per connection. By default the driver pipelines extra queries onto
  // busy connections, and through Supabase's pooler those queries never get an answer: a page that runs more
  // queries at once than there are connections (the patient page runs 8, max is 5) hung until Vercel killed it
  // after 300 s (19 Nov 2026, "Add patient" stuck on "Saving…"). Extra queries now wait for a free connection.
  // query_timeout (seconds) is the backstop: a silent database gives an error page, never a five-minute spinner.
  return { prepare: false, max: 5, max_pipeline: 1, query_timeout: 20, idle_timeout: 20, ssl, types: { jsonbAsText } } as const;
}

async function connect(): Promise<Db> {
  const raw = databaseUrl();
  if (raw) {
    const { default: postgres } = await import("postgres");
    const { url, ssl } = cloudConnection(raw);
    const sql = postgres(url, postgresOptions(ssl));
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
