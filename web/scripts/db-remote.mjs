// The hosted (Supabase) database, run from this laptop. The address is read from a file, never typed or printed:
//   node scripts/db-remote.mjs migrate      apply new supabase/migrations, then the seed (safe to repeat)
//   node scripts/db-remote.mjs reset-demo   delete the SIMULATED patients and create them again with today's dates
//   node scripts/db-remote.mjs check        prove the database is locked: RLS everywhere, no rights for the web API
// Env file: ENV_FILE (default ~/jhealth-cache/production.env, from `vercel env pull`; kept outside the project so
// Next.js never loads it by accident). Prefers the direct (non-pooling)
// address for migrations.
import { readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const here = path.dirname(fileURLToPath(import.meta.url));
const supa = path.resolve(here, "..", "..", "supabase");
const envFile = process.env.ENV_FILE ?? path.join(os.homedir(), "jhealth-cache", "production.env");

const env = Object.fromEntries(
  readFileSync(envFile, "utf8").split("\n")
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map(([, k, v]) => [k, v.replace(/^"(.*)"$/, "$1")]),
);
const raw = env.POSTGRES_URL_NON_POOLING || env.DATABASE_URL || env.POSTGRES_URL;
if (!raw) {
  console.error(`No database address in ${envFile}.`);
  process.exit(1);
}
const url = new URL(raw);
console.log(`Database: ${url.hostname} (port ${url.port || 5432})`);   // the host only; never the password
url.search = "";
const sql = postgres(url.toString(), { ssl: "require", max: 1, prepare: false, onnotice: () => {} });

async function migrate() {
  await sql.unsafe(`create schema if not exists jhealth_private;
    create table if not exists jhealth_private.migrations (name text primary key, applied_at timestamptz default now());
    revoke all on schema jhealth_private from public;`);
  const done = new Set((await sql`select name from jhealth_private.migrations`).map((r) => r.name));
  const files = readdirSync(path.join(supa, "migrations")).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (done.has(file)) continue;
    const text = readFileSync(path.join(supa, "migrations", file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into jhealth_private.migrations (name) values (${file})`;
    });
    console.log(`  applied ${file}`);
  }
  await sql.unsafe(readFileSync(path.join(supa, "seed.sql"), "utf8"));
  console.log("  applied seed.sql");
  await counts();
}

async function resetDemo() {
  const [{ n }] = await sql`select count(*)::int n from patients where is_simulated`;
  await sql.begin(async (tx) => {
    await tx`delete from patients where is_simulated`;
    await tx.unsafe(readFileSync(path.join(supa, "seed.sql"), "utf8"));
  });
  console.log(`  replaced ${n} simulated patients with fresh ones dated from today`);
  await counts();
}

async function counts() {
  const [c] = await sql`select (select count(*)::int from patients where is_simulated) simulated,
                               (select count(*)::int from patients where not is_simulated) real,
                               (select count(*)::int from exercises) exercises`;
  console.log(`  patients: ${c.simulated} simulated, ${c.real} real; exercises: ${c.exercises}`);
}

async function check() {
  let bad = 0;
  const say = (ok, what) => { console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}`); if (!ok) bad++; };
  const noRls = await sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                          where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
  say(noRls.length === 0, `row level security on every table${noRls.length ? ": missing on " + noRls.map((r) => r.relname).join(", ") : ""}`);
  const policies = await sql`select count(*)::int n from pg_policies where schemaname = 'public'`;
  say(policies[0].n === 0, "no policies, so the web API can read no rows");
  const rights = await sql`select table_name, grantee, privilege_type from information_schema.role_table_grants
                           where table_schema = 'public' and grantee in ('anon', 'authenticated')`;
  say(rights.length === 0, `the web API roles have no rights on any table or view${rights.length ? ` (${rights.length} found)` : ""}`);
  const fns = await sql`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                        where n.nspname = 'public' and (has_function_privilege('anon', p.oid, 'execute')
                                                    or has_function_privilege('authenticated', p.oid, 'execute'))`;
  say(fns.length === 0, `the web API roles can run no function${fns.length ? ": " + fns.map((r) => r.proname).join(", ") : ""}`);
  const views = await sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
                          where n.nspname = 'public' and c.relkind = 'v'
                            and not coalesce('security_invoker=true' = any(c.reloptions), false)`;
  say(views.length === 0, `every view obeys row level security${views.length ? ": not " + views.map((r) => r.relname).join(", ") : ""}`);
  const [tls] = await sql`select ssl from pg_stat_ssl where pid = pg_backend_pid()`;
  say(tls?.ssl === true, "this connection is encrypted (TLS)");
  if (bad) process.exitCode = 1;
}

const command = process.argv[2];
try {
  if (command === "migrate") await migrate();
  else if (command === "reset-demo") await resetDemo();
  else if (command === "check") await check();
  else { console.error("Use: migrate | reset-demo | check"); process.exitCode = 2; }
} catch (error) {
  console.error("Failed:", String(error.message).split("\n")[0]);
  process.exitCode = 1;
} finally {
  await sql.end();
}
