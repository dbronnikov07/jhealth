// The AI coach's turn: after a patient's ordinary WhatsApp message (the pain rule found nothing), gather what the
// coach should know, ask the model, check the answer, then save the reply, any new facts and any flag for
// the physiotherapist. Runs after the webhook has already answered Meta (see app/api/whatsapp/route.ts).
import { coachLine, protocolFor } from "../phases";
import { visitCoachLine } from "../visits";
import { getDb, type Db } from "../db";
import { currentStreak } from "../engagement";
import { adaptionConfig, AdaptionError, chatJson } from "./adaption";
import { buildMessages, FALLBACK_REPLY, parseCoachOutput, REPLY_SCHEMA, type CoachContext } from "./prompt";
import { signupReply, type SignupRun } from "./signup";

const TZ = "America/Toronto";

function when(d: Date | string, withYear = false): string {
  return new Date(d).toLocaleString("en-CA", {
    timeZone: TZ, weekday: "short", day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}),
    hour: "numeric", minute: "2-digit",
  });
}

/** Everything the coach should know about one patient, or null if a newer message has arrived since. */
export async function loadContext(db: Db, patientId: string, messageId: string): Promise<{ ctx: CoachContext; memoryIds: Map<string, string> } | null> {
  const [latest] = await db.query<{ id: string; body: string | null }>(
    "select id, body from messages where patient_id = $1 and direction = 'in' order by created_at desc limit 1",
    [patientId],
  );
  if (!latest || latest.id !== messageId) return null; // the newer message gets its own reply

  const [patient] = await db.query<{ first_name: string; condition: string; side: string | null; language: string; phase: number }>(
    "select split_part(trim(display_name), ' ', 1) as first_name, condition, side, language, phase from patients where id = $1",
    [patientId],
  );
  if (!patient) return null;

  const [plan] = await db.query<{ id: string; days_per_week: number; starts_on: Date; notes: string | null }>(
    "select id, days_per_week, starts_on, notes from prescriptions where patient_id = $1 and status = 'active'",
    [patientId],
  );
  const exercises = plan
    ? await db.query<{ name: string; tracking: "camera" | "manual"; sets: number; reps: number; notes: string | null; instructions: string }>(
        `select e.name, e.tracking, pe.sets, pe.reps, pe.notes, e.instructions
           from prescription_exercises pe join exercises e on e.id = pe.exercise_id
          where pe.prescription_id = $1 order by pe.position`,
        [plan.id],
      )
    : [];

  const sessions = await db.query<{ started_at: Date; exercise: string; reps_done: number; reps_target: number | null; quality: number | null; bend: number | null }>(
    `select s.started_at, e.name as exercise, s.reps_done, s.reps_target,
            s.quality_mean::float8 as quality, s.knee_bend_deg::float8 as bend
       from sessions s join exercises e on e.id = s.exercise_id
      where s.patient_id = $1 order by s.started_at desc limit 6`,
    [patientId],
  );

  const memories = await db.query<{ id: string; kind: string; fact: string; author: "coach" | "doctor" }>(
    `select id, kind, fact, author from memories
      where patient_id = $1 and superseded_by is null order by created_at desc limit 30`,
    [patientId],
  );
  const memoryIds = new Map<string, string>();
  const coachMemories = memories.filter((m) => m.author === "coach").map((m, i) => {
    const ref = `m${i + 1}`;
    memoryIds.set(ref, m.id);
    return { ref, kind: m.kind, fact: m.fact };
  });

  const alerts = await db.query<{ kind: string; detail: string; created_at: Date }>(
    "select kind, detail, created_at from alerts where patient_id = $1 and resolved_at is null order by created_at desc limit 5",
    [patientId],
  );

  // The conversation before this message, as the patient saw it (never-sent messages left out).
  const chat = await db.query<{ id: string; direction: "in" | "out"; body: string | null; at: Date }>(
    `select id, direction, body, coalesce(sent_at, created_at) as at from messages
      where patient_id = $1 and status not in ('failed', 'cancelled') and id <> $2 and body is not null
      order by coalesce(sent_at, created_at) desc limit 12`,
    [patientId, messageId],
  );

  const [openVisit] = await db.query<{ status: string; options: string[]; chosen_at: Date | null }>(
    `select status, options, chosen_at from visits
      where patient_id = $1 and (status in ('proposed', 'call_requested') or (status = 'confirmed' and chosen_at > now() - interval '2 hours'))
      order by created_at desc limit 1`,
    [patientId],
  );
  const now = new Date();
  const ctx: CoachContext = {
    now: `${when(now, true)} (Toronto time)`,
    patient: { firstName: patient.first_name, condition: patient.condition, side: patient.side, language: patient.language },
    recovery: coachLine(protocolFor(patient.condition), patient.phase ?? 1),
    visit: openVisit ? visitCoachLine({ status: openVisit.status, options: openVisit.options, chosenAt: openVisit.chosen_at ? new Date(openVisit.chosen_at) : null }) : null,
    plan: plan
      ? { daysPerWeek: plan.days_per_week, startsOn: new Date(plan.starts_on).toISOString().slice(0, 10), notes: plan.notes, exercises }
      : null,
    sessions: sessions.map((s) => ({
      when: when(s.started_at),
      exercise: s.exercise,
      reps: s.reps_target ? `${s.reps_done} of ${s.reps_target}` : String(s.reps_done),
      quality: s.quality,
      bend: s.bend,
    })),
    doctorNotes: memories.filter((m) => m.author === "doctor").map((m) => m.fact),
    memories: coachMemories,
    openAlerts: alerts.map((a) => `${when(a.created_at)}: ${a.detail}`),
    exerciseOnHold: alerts.some((a) => a.kind === "pain" || a.kind === "red_flag"),
    streak: currentStreak(
      [...new Set((await db.query<{ started_at: Date }>("select started_at from sessions where patient_id = $1 order by started_at desc limit 60", [patientId]))
        .map((s) => new Date(s.started_at).toLocaleDateString("en-CA", { timeZone: TZ })))],
      now.toLocaleDateString("en-CA", { timeZone: TZ }),
    ),
    chat: chat.reverse().map((m) => ({ who: m.direction === "in" ? "patient" : "coach", when: when(m.at), text: m.body ?? "" })),
    latest: latest.body ?? "",
  };
  return { ctx, memoryIds };
}

export type CoachRun =
  | { status: "skipped"; reason: "not_configured" | "newer_message" }
  | { status: "replied"; model: string; ms: number; startButton: boolean; memories: number; flagged: boolean }
  | { status: "fallback"; error: string };

export async function coachReply(patientId: string, messageId: string): Promise<CoachRun | SignupRun> {
  const db = await getDb();
  // Still signing up (lib/whatsapp/inbound.ts marked the message): answer it and ask what is missing.
  const [marked] = await db.query<{ signup: boolean }>("select coalesce((payload->>'signup')::boolean, false) as signup from messages where id = $1", [messageId]);
  if (marked?.signup) return signupReply(patientId, messageId, db);
  const cfg = adaptionConfig();
  if (!cfg) return { status: "skipped", reason: "not_configured" };
  const loaded = await loadContext(db, patientId, messageId);
  if (!loaded) return { status: "skipped", reason: "newer_message" };
  const { ctx, memoryIds } = loaded;

  let error = "";
  let result: Awaited<ReturnType<typeof chatJson>> | null = null;
  let out = null;
  try {
    result = await chatJson(cfg, buildMessages(ctx), REPLY_SCHEMA);
    out = parseCoachOutput(result.content, ctx);
    if (!out) error = "The model's answer could not be read";
  } catch (e) {
    error = e instanceof AdaptionError ? e.message : String(e);
  }

  if (!out) {
    // The patient is never left without an answer; the reason is kept for the dashboard and debugging.
    await db.query(
      "insert into messages (patient_id, direction, kind, body, payload, status) values ($1, 'out', 'text', $2, $3::jsonb, 'queued')",
      [patientId, FALLBACK_REPLY, JSON.stringify({ type: "coach_fallback", in_reply_to: messageId, error })],
    );
    console.warn(`[coach] fallback for patient ${patientId}: ${error}`);
    return { status: "fallback", error };
  }

  for (const m of out.memories) {
    const [saved] = await db.query<{ id: string }>(
      "insert into memories (patient_id, kind, fact, source_message_id, author) values ($1, $2, $3, $4, 'coach') returning id",
      [patientId, m.kind, m.fact, messageId],
    );
    const old = m.replaces ? memoryIds.get(m.replaces) : undefined;
    if (old) {
      await db.query(
        "update memories set superseded_by = $3 where id = $1 and patient_id = $2 and author = 'coach' and superseded_by is null",
        [old, patientId, saved.id],
      );
    }
  }

  if (out.flagForPhysio) {
    await db.query(
      "insert into alerts (patient_id, kind, detail, source_message_id) values ($1, 'coach', $2, $3)",
      [patientId, `Coach: ${out.flagForPhysio}`, messageId],
    );
  }

  await db.query(
    "insert into messages (patient_id, direction, kind, body, payload, status) values ($1, 'out', $2, $3, $4::jsonb, 'queued')",
    [
      patientId,
      out.startButton ? "buttons" : "text",
      out.reply,
      JSON.stringify({
        type: "coach_reply", in_reply_to: messageId, start_button: out.startButton,
        model: result?.model, ms: result?.ms, usage: result?.usage,
      }),
    ],
  );
  return {
    status: "replied", model: result?.model ?? cfg.model, ms: result?.ms ?? 0,
    startButton: out.startButton, memories: out.memories.length, flagged: !!out.flagForPhysio,
  };
}
