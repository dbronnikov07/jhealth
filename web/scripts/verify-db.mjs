// Builds a brand-new database from supabase/migrations + supabase/seed.sql in PGlite (real Postgres,
// running inside Node) and checks every rule the app relies on. Run:  npm run db:verify
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const here = path.dirname(fileURLToPath(import.meta.url));
const supa = path.resolve(here, "..", "..", "supabase");
const db = new PGlite();
let passed = 0;
let failed = 0;

const ok = (cond, what) => {
  if (cond) { passed++; console.log(`  ok    ${what}`); }
  else { failed++; console.log(`  FAIL  ${what}`); }
};
const rows = async (text, params = []) => (await db.query(text, params)).rows;
const one = async (text, params = []) => (await rows(text, params))[0];
const rejects = async (text, params, what) => {
  try { await db.query(text, params); ok(false, `${what} (was accepted)`); }
  catch (e) { ok(true, `${what}  [${String(e.message).split("\n")[0].slice(0, 70)}]`); }
};

console.log("schema");
for (const f of readdirSync(path.join(supa, "migrations")).filter((f) => f.endsWith(".sql")).sort()) {
  await db.exec(readFileSync(path.join(supa, "migrations", f), "utf8"));
  console.log(`  applied ${f}`);
}
await db.exec(readFileSync(path.join(supa, "seed.sql"), "utf8"));
await db.exec(readFileSync(path.join(supa, "seed.sql"), "utf8"));   // a second run must change nothing
console.log("  applied seed.sql twice");

console.log("\nseed");
ok((await one("select count(*)::int n from doctors where is_default")).n === 1, "exactly one default doctor");
ok((await one("select count(*)::int n from exercises")).n === 5, "five exercises in the library (four of them camera-scored)");
ok((await one("select count(*)::int n from exercises where tracking = 'camera'")).n === 4, "squat, sit-to-stand, seated knee extension and arm raise are camera-scored");
ok((await one("select model_key from exercises where id = 'sit_to_stand'")).model_key === "sit_to_stand", "sit-to-stand asks for its own model");
ok((await one("select count(*)::int n from patients where is_simulated")).n === 20, "20 simulated patients after two seed runs");
const overview = await rows("select display_name, status, status_reason from patient_overview order by display_name");
const status = Object.fromEntries(overview.map((r) => [r.display_name.slice(-2), r.status]));
ok(status["06"] === "stalling" && status["13"] === "stalling", `patients 06 and 13 are stalling (got ${status["06"]}, ${status["13"]})`);
ok(status["17"] === "inactive", `patient 17 is inactive (got ${status["17"]})`);
ok(status["20"] === "new", `patient 20 is new (got ${status["20"]})`);
ok(status["09"] === "alert", `patient 09 has a pain alert (got ${status["09"]})`);
const others = Object.entries(status).filter(([k]) => !["06", "13", "17", "20", "09"].includes(k));
ok(others.every(([, s]) => s === "on_track"), `the other 15 are on track (${others.filter(([, s]) => s !== "on_track").map(([k, s]) => k + "=" + s).join(", ") || "all"})`);
for (const r of overview.filter((r) => r.status !== "on_track")) console.log(`        ${r.display_name}: ${r.status}, "${r.status_reason}"`);

console.log("\nrules the database enforces");
const me = await one("insert into patients (display_name, phone, condition, side) values ('Demo Patient', '+14165550100', 'Total knee replacement', 'right') returning id, doctor_id");
const doc = await one("select id from doctors where is_default");
ok(me.doctor_id === doc.id, "a new patient without a doctor is linked to the default doctor");
await rejects("insert into patients (display_name, phone, condition) values ('X', '4165550101', 'knee')", [], "phone without + and country code is refused");
await rejects("insert into patients (display_name, condition) values ('X', 'knee')", [], "a real patient without a phone is refused");
await rejects("insert into patients (display_name, phone, condition) values ('Y', '+14165550100', 'knee')", [], "the same phone twice is refused");
await rejects("insert into exercise_videos (exercise_id, url, source, prompt, status) values ('sit_to_stand', 'x.mp4', 'generated', 'p', 'approved')", [], "an 'approved' video without who approved it is refused");
await rejects("insert into exercise_videos (exercise_id, url, source) values ('sit_to_stand', 'x.mp4', 'generated')", [], "a generated video without its prompt is refused");
await rejects("insert into exercises (id, name, body_area, instructions, tracking) values ('x', 'X', 'knee', 'do it', 'camera')", [], "a camera-tracked exercise without a model is refused");

console.log("\nprescribe()");
const items = JSON.stringify([
  { exercise_id: "sit_to_stand", sets: 2, reps: 10 },
  { exercise_id: "seated_knee_extension", sets: 3, reps: 12 },
  { exercise_id: "seated_knee_flexion" },
]);
const rx1 = (await one("select prescribe($1, $2::jsonb, 5, 'Go easy the first week') as id", [me.id, items])).id;
ok((await one("select count(*)::int n from prescription_exercises where prescription_id = $1", [rx1])).n === 3, "stores the three exercises");
ok((await one("select sets, reps from prescription_exercises where prescription_id = $1 and position = 3", [rx1])).reps === 10, "missing sets/reps fall back to the library defaults");
const msg = await one("select status, direction, body from messages where patient_id = $1 order by created_at desc limit 1", [me.id]);
ok(msg?.status === "queued" && msg?.direction === "out", "queues the WhatsApp message in the same transaction");
console.log("        message: " + msg.body.replace(/\n/g, " | "));
const rx2 = (await one("select prescribe($1, $2::jsonb, 4) as id", [me.id, JSON.stringify([{ exercise_id: "sit_to_stand" }])])).id;
const active = await rows("select id from prescriptions where patient_id = $1 and status = 'active'", [me.id]);
ok(active.length === 1 && active[0].id === rx2, "a new plan replaces the old one (exactly one active)");
const before = (await one("select count(*)::int n from prescriptions")).n;
await rejects("select prescribe($1, $2::jsonb)", [me.id, JSON.stringify([{ exercise_id: "sit_to_stand" }, { exercise_id: "moonwalk" }])], "an unknown exercise is refused");
ok((await one("select count(*)::int n from prescriptions")).n === before, "...and nothing half-written is left behind");
ok((await rows("select id from prescriptions where patient_id = $1 and status = 'active'", [me.id]))[0]?.id === rx2, "...and the current plan is still active");
await rejects("select prescribe($1, '[]'::jsonb)", [me.id], "an empty plan is refused");
ok((await one("select status from patient_overview where id = $1", [me.id])).status === "new", "the new patient shows up as 'new' on the dashboard");

console.log("\nWhatsApp");
const tokens = await rows("select session_token from patients");
ok(tokens.every((t) => /^[0-9a-f]{64}$/.test(t.session_token)) && new Set(tokens.map((t) => t.session_token)).size === tokens.length,
   "every patient has its own 64-character session link token");
const bsuid = await one("insert into patients (display_name, whatsapp_user_id, condition) values ('Username user', 'CA.1234567890123456', 'Not assessed yet') returning id");
ok(!!bsuid.id, "a WhatsApp user known only by user ID (no phone) can be stored");
await rejects("insert into patients (display_name, condition) values ('Nobody', 'knee')", [], "a real patient with no phone and no WhatsApp ID is still refused");
const queued = (await one("select count(*)::int n from messages where status = 'queued' and patient_id = $1", [me.id])).n;
const claim1 = await rows("select id from claim_outbox($1)", [me.id]);
const claim2 = await rows("select id from claim_outbox($1)", [me.id]);
ok(claim1.length === queued && queued > 0 && claim2.length === 0, `claim_outbox hands each queued message out exactly once (${claim1.length}, then ${claim2.length})`);
await db.query("update messages set status = 'sent', provider_id = 'wamid.TEST1' where id = $1", [claim1[0].id]);
for (const st of ["read", "delivered", "sent"]) await db.query("select apply_message_status('wamid.TEST1', $1)", [st]);
ok((await one("select status from messages where provider_id = 'wamid.TEST1'")).status === "read", "status only moves forward: read, then a late 'delivered' and 'sent', stays read");
await db.query("select apply_message_status('wamid.TEST1', 'failed', '131000', 'x')");
ok((await one("select status from messages where provider_id = 'wamid.TEST1'")).status === "read", "a 'failed' report after 'read' is ignored");
await db.query("update messages set status = 'failed', error_code = '131047' where id = $1", [claim1[1]?.id ?? claim1[0].id]);
await db.query("insert into messages (patient_id, direction, body, status, error_code) values ($1, 'out', 'other failure', 'failed', '131030')", [me.id]);
ok((await one("select requeue_after_reply($1) as n", [me.id])).n === 1, "after the patient replies, only the 24-hour-window failure is queued again");

const fresh = await one("insert into patients (display_name, phone, condition) values ('Plan Twice', '+14165550177', 'knee') returning id");
await db.query("select prescribe($1, $2::jsonb)", [fresh.id, JSON.stringify([{ exercise_id: "sit_to_stand" }])]);
await db.query("update messages set status = 'failed', error_code = '131047' where patient_id = $1", [fresh.id]);
await db.query("select prescribe($1, $2::jsonb)", [fresh.id, JSON.stringify([{ exercise_id: "seated_knee_flexion" }])]);
const planMsgs = await rows("select status, body from messages where patient_id = $1 order by created_at", [fresh.id]);
// (Both messages can carry the same timestamp, so check which plan each one belongs to, not their order.)
const oldMsg = planMsgs.find((m) => /Sit-to-stand/.test(m.body));
const newMsg = planMsgs.find((m) => /flexion/i.test(m.body));
ok(planMsgs.length === 2 && oldMsg?.status === "cancelled" && newMsg?.status === "queued",
   `saving a newer plan cancels the old unsent plan message (old ${oldMsg?.status}, new ${newMsg?.status})`);
await db.query("select requeue_after_reply($1)", [fresh.id]);
ok((await one("select count(*)::int n from messages where patient_id = $1 and status = 'queued'", [fresh.id])).n === 1,
   "a cancelled plan message is never re-sent after the patient replies");

console.log("\nsecurity");
const noRls = await rows("select relname from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and not relrowsecurity");
ok(noRls.length === 0, `row level security is on for every table${noRls.length ? " (missing: " + noRls.map((r) => r.relname).join(", ") + ")" : ""}`);
const view = await one("select reloptions from pg_class where relname = 'patient_overview'");
ok(String(view.reloptions).includes("security_invoker=true"), "the dashboard view obeys row level security (security_invoker)");
const pub = await one("select has_function_privilege('public', 'prescribe(uuid, jsonb, int, text)', 'execute') as can");
ok(pub.can === false, "nobody but the server can call prescribe()");
for (const fn of ["claim_outbox(uuid, int)", "apply_message_status(text, text, text, text)", "requeue_after_reply(uuid)"]) {
  ok((await one(`select has_function_privilege('public', '${fn}', 'execute') as can`)).can === false, `nobody but the server can call ${fn.split("(")[0]}()`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
