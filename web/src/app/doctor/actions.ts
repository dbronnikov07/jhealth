"use server";
// Everything the doctor can change. Each function runs on the server only.
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { assertUuid, requireDoctor } from "@/lib/auth";
import { getDb, pgCode, pgMessage } from "@/lib/db";
import { fictionalPhone } from "@/lib/demo-phone";
import { normalizePhone } from "@/lib/format";
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
  const values = { name, phone: typed, condition, side, demo: demo ? "on" : "" };
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

  let id: string;
  try {
    // No doctor_id: the database links the patient to the default doctor.
    const [row] = await db.query<{ id: string }>(
      "insert into patients (display_name, phone, condition, side, channel) values ($1, $2, $3, $4, $5) returning id",
      [name, phone, condition, ["left", "right", "both"].includes(side) ? side : null, demo ? "demo" : "whatsapp"],
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
