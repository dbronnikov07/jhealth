// Every read the dashboard makes (the Data Access Layer). Each one checks the caller may use the dashboard first:
// the proxy gate is not enough on its own (lib/auth-core.ts). Numbers are cast to int/float8 in SQL so both
// drivers return JS numbers.
import "server-only";
import { requireDoctor } from "./auth";
import { getDb } from "./db";

export type Status = "alert" | "stalling" | "inactive" | "new" | "no_plan" | "on_track";

export type Overview = {
  id: string;
  display_name: string;
  phone: string | null;
  is_simulated: boolean;
  condition: string;
  side: string | null;
  prescription_id: string | null;
  days_per_week: number | null;
  plan_age_days: number | null;
  days_active_7d: number;
  adherence_7d: number | null;
  quality_7d: number | null;
  quality_prev_7d: number | null;
  bend_7d: number | null;
  bend_prev_7d: number | null;
  last_session_at: Date | null;
  sessions_total: number;
  open_alerts: number;
  status: Status;
  status_reason: string;
};

const OVERVIEW_COLUMNS = `id, display_name, phone, is_simulated, condition, side, prescription_id, days_per_week,
  plan_age_days, days_active_7d, adherence_7d, quality_7d, quality_prev_7d, bend_7d, bend_prev_7d,
  last_session_at, sessions_total, open_alerts, status, status_reason`;

export async function getDoctor() {
  await requireDoctor();
  const db = await getDb();
  const [doctor] = await db.query<{ id: string; name: string; clinic: string | null }>(
    "select id, name, clinic from doctors where is_default",
  );
  return { doctor, mode: db.mode };
}

export async function listPatients() {
  await requireDoctor();
  const db = await getDb();
  return db.query<Overview>(`select ${OVERVIEW_COLUMNS} from patient_overview order by is_simulated, status_rank, display_name`);
}

export async function sessionsThisWeek() {
  await requireDoctor();
  const db = await getDb();
  const [row] = await db.query<{ n: number }>("select count(*)::int as n from sessions where started_at >= now() - interval '7 days'");
  return row.n;
}

export async function getPatient(id: string) {
  await requireDoctor();
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const db = await getDb();
  const [patient] = await db.query<Overview>(`select ${OVERVIEW_COLUMNS} from patient_overview where id = $1`, [id]);
  return patient ?? null;
}

export type PlanItem = {
  position: number;
  exercise_id: string;
  name: string;
  tracking: "camera" | "manual";
  sets: number;
  reps: number;
  notes: string | null;
};

export async function getActivePlan(patientId: string) {
  await requireDoctor();
  const db = await getDb();
  const [plan] = await db.query<{ id: string; days_per_week: number; starts_on: Date; notes: string | null }>(
    "select id, days_per_week, starts_on, notes from prescriptions where patient_id = $1 and status = 'active'",
    [patientId],
  );
  if (!plan) return null;
  const items = await db.query<PlanItem>(
    `select pe.position, e.id as exercise_id, e.name, e.tracking, pe.sets, pe.reps, pe.notes
       from prescription_exercises pe join exercises e on e.id = pe.exercise_id
      where pe.prescription_id = $1 order by pe.position`,
    [plan.id],
  );
  return { ...plan, items };
}

export type Exercise = {
  id: string;
  name: string;
  body_area: string;
  instructions: string;
  tracking: "camera" | "manual";
  default_sets: number;
  default_reps: number;
};

export async function listExercises() {
  await requireDoctor();
  const db = await getDb();
  return db.query<Exercise>(
    `select id, name, body_area, instructions, tracking, default_sets, default_reps
       from exercises order by (tracking = 'camera') desc, is_custom, name`,
  );
}

export async function recentSessions(patientId: string, limit = 30) {
  await requireDoctor();
  const db = await getDb();
  return db.query<{ started_at: Date; exercise: string; reps_done: number; reps_target: number | null; quality: number | null; bend: number | null; rom: number | null }>(
    `select s.started_at, e.name as exercise, s.reps_done, s.reps_target,
            s.quality_mean::float8 as quality, s.knee_bend_deg::float8 as bend, s.rom_deg::float8 as rom
       from sessions s join exercises e on e.id = s.exercise_id
      where s.patient_id = $1 order by s.started_at desc limit $2`,
    [patientId, limit],
  );
}

export async function listMemories(patientId: string) {
  await requireDoctor();
  const db = await getDb();
  return db.query<{ id: string; kind: string; fact: string; author: "coach" | "doctor"; created_at: Date; source: string | null }>(
    `select m.id, m.kind, m.fact, m.author, m.created_at, msg.body as source
       from memories m left join messages msg on msg.id = m.source_message_id
      where m.patient_id = $1 and m.superseded_by is null
      order by m.created_at desc`,
    [patientId],
  );
}

export async function listMessages(patientId: string, limit = 8) {
  await requireDoctor();
  const db = await getDb();
  return db.query<{
    id: string; direction: "in" | "out"; body: string | null; status: string; created_at: Date; error: string | null; error_code: string | null;
    type: string | null; start_button: boolean | null; coach_error: string | null;
  }>(
    // A chat follows when messages were actually sent (a plan held back by WhatsApp's 24-hour rule goes out later).
    `select id, direction, body, status, coalesce(sent_at, created_at) as created_at, error, error_code,
            payload->>'type' as type, (payload->>'start_button')::boolean as start_button, payload->>'error' as coach_error
       from messages
      where patient_id = $1
      order by coalesce(sent_at, created_at) desc limit $2`,
    [patientId, limit],
  );
}

/** The secret part of the patient's links ("Patient's page", "Demo phone") and how the coach reaches them. */
export async function patientLink(patientId: string) {
  await requireDoctor();
  const db = await getDb();
  const [row] = await db.query<{ session_token: string; channel: "whatsapp" | "demo" }>(
    "select session_token, channel from patients where id = $1",
    [patientId],
  );
  return row ? { token: row.session_token, channel: row.channel } : null;
}

export async function openAlerts(patientId: string) {
  await requireDoctor();
  const db = await getDb();
  return db.query<{ id: string; kind: string; detail: string; created_at: Date }>(
    "select id, kind, detail, created_at from alerts where patient_id = $1 and resolved_at is null order by created_at desc",
    [patientId],
  );
}
