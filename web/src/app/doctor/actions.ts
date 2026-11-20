"use server";
// Everything the doctor can change. Each function runs on the server only.
import { refresh, revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { assertUuid, requireDoctor } from "@/lib/auth";
import { getDb, pgCode, pgMessage } from "@/lib/db";
import { fictionalPhone } from "@/lib/demo-phone";
import { normalizePhone } from "@/lib/format";
import { clampPhase, DONE, protocolFor, signOffMessage } from "@/lib/phases";
import { cancelText, clinicTimeToUtc, proposalText, visitButtons } from "@/lib/visits";
import { processOutbox } from "@/lib/whatsapp/outbox";

// values: what was typed, sent back on an error so the form can refill itself (React clears forms after submit).
export type FormState = { error: string | null; values?: Record<string, string> };

export async function createPatient(_prev: FormState, form: FormData): Promise<FormState> {
  await requireDoctor();
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  const typed = String(form.get("phone") ?? "").slice(0, 40);
  const demo = form.get("demo") === "on";
  const condition = String(form.get("condition") ?? "").trim().slice(0, 120);
  const side = String(form.get("side") ?? "");
  const emergencyName = String(form.get("emergency_name") ?? "").trim().slice(0, 80);
  const emergencyTyped = String(form.get("emergency_phone") ?? "").slice(0, 40);
  const values = { name, phone: typed, condition, side, demo: demo ? "on" : "", emergency_name: emergencyName, emergency_phone: emergencyTyped };
  if (!name) return { error: "Enter the patient's name.", values };
  const db = await getDb();
  let phone = normalizePhone(typed);
  if (demo && !typed.trim()) {
    // The demo phone needs no real number: take a free fictional one (+1 416 555 0100 to 0199).
    const taken = await db.query<{ phone: string }>("select phone from patients where phone like '+1416555%'");
    phone = fictionalPhone(taken.map((r) => r.phone));
    if (!phone) return { error: "All 100 fictional demo numbers are in use. Type a number instead.", values };
  }
  if (!phone) return { error: "Enter the phone number with country code, for example +1 416 555 0123.", values };
  if (!condition) return { error: "Choose the condition.", values };
  const emergencyPhone = emergencyTyped.trim() ? normalizePhone(emergencyTyped) : null;
  if (emergencyTyped.trim() && !emergencyPhone) return { error: "Enter the emergency contact's number with country code, for example +1 416 555 0123.", values };
  if (emergencyPhone && !emergencyName) return { error: "Enter the emergency contact's name, for example Mom.", values };

  let id: string;
  try {
    // No doctor_id: the database links the patient to the default doctor.
    const [row] = await db.query<{ id: string }>(
      "insert into patients (display_name, phone, condition, side, channel, emergency_name, emergency_phone) values ($1, $2, $3, $4, $5, $6, $7) returning id",
      [name, phone, condition, ["left", "right", "both"].includes(side) ? side : null, demo ? "demo" : "whatsapp",
        emergencyPhone ? emergencyName : null, emergencyPhone],
    );
    id = row.id;
  } catch (error) {
    if (pgCode(error) === "23505") {
      const [existing] = await db.query<{ id: string; display_name: string }>(
        "select id, display_name from patients where phone = $1",
        [phone],
      );
      return { error: `This number already belongs to ${existing?.display_name ?? "another patient"}.`, values };
    }
    return { error: pgMessage(error), values };
  }
  redirect(`/doctor/patients/${id}`);
}

/**
 * Delete a patient and everything about them: plan, sessions and repetitions, messages, memories, alerts and the
 * spoken conversation (every table refers to the patient with ON DELETE CASCADE). It cannot be undone, so the
 * physiotherapist types the patient's first name to confirm.
 */
export async function deletePatient(patientId: string, _prev: FormState, form: FormData): Promise<FormState> {
  await requireDoctor();
  assertUuid(patientId);
  const typed = String(form.get("confirm") ?? "").trim().toLowerCase();
  const db = await getDb();
  const [patient] = await db.query<{ first_name: string }>(
    "select split_part(trim(display_name), ' ', 1) as first_name from patients where id = $1",
    [patientId],
  );
  if (!patient) redirect("/doctor");
  if (!typed || typed !== patient.first_name.trim().toLowerCase()) {
    return { error: `Type ${patient.first_name} to confirm.`, values: { confirm: String(form.get("confirm") ?? "") } };
  }
  await db.query("delete from patients where id = $1", [patientId]);
  revalidatePath("/doctor");
  redirect("/doctor");
}

/** The patient record's "Emergency contact" form. Both empty removes the contact. */
export async function saveEmergencyContact(patientId: string, _prev: FormState, form: FormData): Promise<FormState> {
  await requireDoctor();
  assertUuid(patientId);
  const name = String(form.get("emergency_name") ?? "").trim().slice(0, 80);
  const typed = String(form.get("emergency_phone") ?? "").slice(0, 40);
  const values = { emergency_name: name, emergency_phone: typed };
  const phone = typed.trim() ? normalizePhone(typed) : null;
  if (typed.trim() && !phone) return { error: "Enter the number with country code, for example +1 416 555 0123.", values };
  if (phone && !name) return { error: "Enter the contact's name, for example Mom.", values };
  if (name && !phone) return { error: "Enter the contact's phone number.", values };
  const db = await getDb();
  await db.query("update patients set emergency_name = $2, emergency_phone = $3 where id = $1", [patientId, name || null, phone]);
  revalidatePath(`/doctor/patients/${patientId}`);
  return { error: null, values };
}

export async function savePlan(patientId: string, _prev: FormState, form: FormData): Promise<FormState> {
  await requireDoctor();
  assertUuid(patientId);
  const chosen = [...new Set(form.getAll("exercise").map(String))].filter((id) => /^[a-z0-9_]{1,60}$/.test(id)).slice(0, 12);
  if (chosen.length === 0) return { error: "Choose at least one exercise." };
  const items = chosen.map((id) => ({
    exercise_id: id,
    sets: Number(form.get(`sets_${id}`)) || undefined,
    reps: Number(form.get(`reps_${id}`)) || undefined,
  }));
  const days = Math.min(7, Math.max(1, Number(form.get("days_per_week")) || 5));
  const notes = String(form.get("notes") ?? "").slice(0, 1000);

  const db = await getDb();
  try {
    // One transaction in the database: replaces the old plan, stores the new one, queues the WhatsApp message.
    await db.query("select prescribe($1, $2::jsonb, $3, $4)", [patientId, JSON.stringify(items), days, notes]);
  } catch (error) {
    return { error: pgMessage(error) };
  }
  after(() => processOutbox(patientId)); // send the queued WhatsApp message once the page has answered
  redirect(`/doctor/patients/${patientId}`);
}

export async function addNote(patientId: string, form: FormData) {
  await requireDoctor();
  assertUuid(patientId);
  const fact = String(form.get("fact") ?? "").trim();
  if (fact.length < 3) return;
  const db = await getDb();
  await db.query(
    "insert into memories (patient_id, kind, fact, author) values ($1, 'clinical_note', $2, 'doctor')",
    [patientId, fact.slice(0, 500)],
  );
  refresh();
}

/** Put failed messages back in the queue and try to send them now. */
export async function retryMessages(patientId: string) {
  await requireDoctor();
  assertUuid(patientId);
  const db = await getDb();
  await db.query(
    "update messages set status = 'queued', error = null, error_code = null, attempts = 0 where patient_id = $1 and direction = 'out' and status = 'failed'",
    [patientId],
  );
  await processOutbox(patientId);
  refresh();
}

export async function resolveAlert(alertId: string) {
  await requireDoctor();
  assertUuid(alertId);
  const db = await getDb();
  await db.query(
    "update alerts set resolved_at = now(), resolved_by = (select id from doctors where is_default) where id = $1 and resolved_at is null",
    [alertId],
  );
  refresh();
}

/**
 * The physiotherapist signs a phase off (or steps back one). Only this moves a patient between phases: the camera
 * can show a target is met, never decide. `from` is the phase the page showed, so a double click or a second tab
 * cannot move the patient twice. The patient gets a message with the milestone they reached.
 */
export async function changePhase(patientId: string, direction: "next" | "back", form: FormData) {
  await requireDoctor();
  assertUuid(patientId);
  if (direction !== "next" && direction !== "back") return;
  const from = clampPhase(form.get("from"));
  const to = direction === "next" ? from + 1 : from - 1;
  if (to < 1 || to > DONE) return;
  const note = String(form.get("note") ?? "").trim().slice(0, 500) || null;
  const db = await getDb();
  const [moved] = await db.query<{ first_name: string; condition: string }>(
    `with moved as (
       update patients set phase = $3, phase_since = now() where id = $1 and phase = $2
       returning id, split_part(trim(display_name), ' ', 1) as first_name, condition
     ), logged as (
       insert into phase_signoffs (patient_id, from_phase, to_phase, doctor_id, note)
       select id, $2, $3, (select id from doctors where is_default), $4 from moved
       returning id
     )
     select m.first_name, m.condition from moved m, logged`,
    [patientId, from, to, note],
  );
  if (moved) {
    await db.query(
      "insert into messages (patient_id, direction, kind, body, payload, status) values ($1, 'out', 'text', $2, $3::jsonb, 'queued')",
      [patientId, signOffMessage(protocolFor(moved.condition), moved.first_name, from, to), JSON.stringify({ type: "phase_signoff", from, to })],
    );
    after(() => processOutbox(patientId));
  }
  refresh();
}

/** A real-life win the physio heard about ("First full turn on an exercise bike"), for the patient's wins log. */
export async function addWin(patientId: string, form: FormData) {
  await requireDoctor();
  assertUuid(patientId);
  const text = String(form.get("win") ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120);
  if (text.length < 2) return;
  const db = await getDb();
  await db.query("insert into wins (patient_id, text, author) values ($1, $2, 'doctor')", [patientId, text]);
  refresh();
}

/**
 * The physiotherapist proposes a check-up visit: one or two times, typed in clinic time. The patient gets a message
 * with a button per time and "Call me instead". An earlier proposal that was never answered is withdrawn.
 */
export async function proposeVisit(patientId: string, _prev: FormState, form: FormData): Promise<FormState> {
  await requireDoctor();
  assertUuid(patientId);
  const typed = [String(form.get("slot1") ?? ""), String(form.get("slot2") ?? "")];
  const reason = String(form.get("reason") ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120) || null;
  const values = { slot1: typed[0], slot2: typed[1], reason: reason ?? "" };
  const now = Date.now();
  const slots: Date[] = [];
  for (const t of typed) {
    if (!t.trim()) continue;
    const at = clinicTimeToUtc(t);
    if (!at) return { error: "Choose a date and a time.", values };
    if (at.getTime() < now + 10 * 60_000) return { error: "Choose a time in the future.", values };
    if (at.getTime() > now + 120 * 86_400_000) return { error: "Choose a time within the next four months.", values };
    if (!slots.some((s) => s.getTime() === at.getTime())) slots.push(at);
  }
  if (slots.length === 0) return { error: "Offer at least one time.", values };
  slots.sort((a, b) => a.getTime() - b.getTime());

  const db = await getDb();
  const [p] = await db.query<{ first_name: string; doctor_id: string; doctor: string | null; clinic: string | null }>(
    `select split_part(trim(p.display_name), ' ', 1) as first_name, p.doctor_id, d.name as doctor, d.clinic
       from patients p left join doctors d on d.id = p.doctor_id where p.id = $1`,
    [patientId],
  );
  if (!p) return { error: "Patient not found.", values };
  await db.query("update visits set status = 'cancelled', closed_at = now() where patient_id = $1 and status in ('proposed', 'call_requested')", [patientId]);
  await db.query(
    "insert into visits (patient_id, doctor_id, options, reason) values ($1, $2, $3::jsonb, $4)",
    [patientId, p.doctor_id, JSON.stringify(slots.map((s) => s.toISOString())), reason],
  );
  await db.query(
    "insert into messages (patient_id, direction, kind, body, payload, status) values ($1, 'out', 'buttons', $2, $3::jsonb, 'queued')",
    [patientId, proposalText({ firstName: p.first_name, doctor: p.doctor, clinic: p.clinic, slots, reason }),
      JSON.stringify({ type: "visit_proposal", quick_replies: visitButtons(slots) })],
  );
  after(() => processOutbox(patientId));
  revalidatePath(`/doctor/patients/${patientId}`);
  return { error: null };
}

/** After the visit (it happened, or the patient did not come), or to cancel one. A cancelled booking tells the patient. */
export async function closeVisit(visitId: string, to: "done" | "missed" | "cancelled") {
  await requireDoctor();
  assertUuid(visitId);
  if (!["done", "missed", "cancelled"].includes(to)) return;
  const db = await getDb();
  const from = to === "cancelled" ? ["proposed", "confirmed", "call_requested"] : ["confirmed"];
  const [v] = await db.query<{ patient_id: string; was: string; chosen_at: Date | null; first_name: string }>(
    `with before as (select id, status from visits where id = $1)
     update visits v set status = $2, closed_at = now()
       from before b, patients p
      where v.id = b.id and p.id = v.patient_id and b.status in (${from.map((_, i) => `$${i + 3}`).join(", ")})
      returning v.patient_id, b.status as was, v.chosen_at, split_part(trim(p.display_name), ' ', 1) as first_name`,
    [visitId, to, ...from],
  );
  if (v && to === "cancelled" && v.was === "confirmed" && v.chosen_at) {
    await db.query(
      "insert into messages (patient_id, direction, kind, body, payload, status) values ($1, 'out', 'text', $2, $3::jsonb, 'queued')",
      [v.patient_id, cancelText(v.first_name, new Date(v.chosen_at)), JSON.stringify({ type: "visit_cancelled" })],
    );
    after(() => processOutbox(v.patient_id));
  }
  refresh();
}
