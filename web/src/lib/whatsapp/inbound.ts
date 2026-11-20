// Handles what WhatsApp sends to our webhook: patients' messages and delivery receipts.
import { getDb } from "../db";
import {
  CONDITION_BUTTONS, quickReplyAction, setupQuestion, SIDE_BUTTONS, SIDE_QUESTION, starterPlan, starterPlanText, TIME_BUTTONS,
  TIME_QUESTION,
} from "../quick-replies";
import { assessMessage, HIGH_PAIN_REPLY } from "../safety";
import { raiseSafetyAlert } from "../safety-actions";
import { isConversational, isOurNumber } from "./filter";
import { AVAILABILITY, confirmText, VISIT_CALL_TEXT, VISIT_GONE_TEXT } from "../visits";

type Contact = { wa_id?: string; user_id?: string; profile?: { name?: string } };
type IncomingMessage = {
  id: string;
  from?: string;
  from_user_id?: string;
  timestamp?: string;
  type: string;
  text?: { body?: string };
  button?: { text?: string; payload?: string };
  interactive?: { button_reply?: { id?: string; title?: string }; list_reply?: { id?: string; title?: string } };
  audio?: { id?: string; mime_type?: string; voice?: boolean };
};

/** A voice note stored as "[voice message]", to be turned into text after the webhook has answered Meta. */
export type VoiceNoteJob = { patientId: string; messageId: string; mediaId: string; isNew: boolean };
type StatusUpdate = { id: string; status: string; errors?: { code?: number | string; title?: string; message?: string; error_data?: { details?: string } }[] };
type WebhookBody = {
  object?: string;
  entry?: { changes?: { field?: string; value?: {
    metadata?: { phone_number_id?: string; display_phone_number?: string };
    contacts?: Contact[]; messages?: IncomingMessage[]; statuses?: StatusUpdate[];
  } }[] }[];
};

function textOf(m: IncomingMessage): string {
  return (
    m.text?.body ??
    m.button?.text ??
    m.interactive?.button_reply?.title ??
    m.interactive?.list_reply?.title ??
    `[${m.type} message]`
  );
}

/**
 * Returns the patients who may now have messages to send (replies, or messages waiting for the 24-hour window),
 * and the ordinary messages the AI coach should answer (after the webhook has answered Meta).
 */
export async function handleWebhook(body: WebhookBody): Promise<{
  patients: string[]; toCoach: { patientId: string; messageId: string }[]; voiceNotes: VoiceNoteJob[];
}> {
  const db = await getDb();
  const touched = new Set<string>();
  const toCoach: { patientId: string; messageId: string }[] = [];
  const voiceNotes: VoiceNoteJob[] = [];

  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages" || !change.value) continue;
      // Another phone number on the same Meta account: not ours to store or answer.
      if (!isOurNumber(change.value.metadata, process.env.WHATSAPP_PHONE_NUMBER_ID)) continue;
      const { contacts = [], messages = [], statuses = [] } = change.value;

      for (const s of statuses) {
        const error = s.errors?.[0];
        await db.query("select apply_message_status($1, $2, $3, $4)", [
          s.id, s.status, error?.code != null ? String(error.code) : null,
          error ? (error.error_data?.details ?? error.message ?? error.title ?? "Delivery failed") : null,
        ]);
      }

      for (const m of messages) {
        if (!isConversational(m.type)) continue; // a reaction or system notice: nothing to answer
        const phone = m.from ? `+${m.from}` : null;
        const userId = m.from_user_id ?? null;
        if (!phone && !userId) continue;
        const contact = contacts.find((c) => (m.from && c.wa_id === m.from) || (userId && c.user_id === userId));

        // Who is this? Look the patient up by phone or WhatsApp user ID; a new person is created and,
        // through the database trigger, linked to the default doctor.
        let [patient] = await db.query<{ id: string; whatsapp_user_id: string | null }>(
          "select id, whatsapp_user_id from patients where phone = $1 or (whatsapp_user_id is not null and whatsapp_user_id = $2) limit 1",
          [phone, userId],
        );
        let isNew = false;
        if (!patient) {
          const name = contact?.profile?.name?.trim() || (phone ? `WhatsApp ${phone.slice(-4)}` : "WhatsApp user");
          [patient] = await db.query<{ id: string; whatsapp_user_id: string | null }>(
            `insert into patients (display_name, phone, whatsapp_user_id, condition)
             values ($1, $2, $3, 'Not assessed yet') returning id, whatsapp_user_id`,
            [name, phone, userId],
          );
          isNew = true;
        } else if (userId && !patient.whatsapp_user_id) {
          await db.query("update patients set whatsapp_user_id = $2 where id = $1", [patient.id, userId]);
        }

        // A voice note: stored now (so a second delivery is ignored), listened to after Meta has its answer.
        if (m.type === "audio" && m.audio?.id) {
          const [stored] = await db.query<{ id: string }>(
            `insert into messages (patient_id, direction, kind, body, payload, status, provider_id)
             values ($1, 'in', 'audio', '[voice message]', $2::jsonb, 'received', $3)
             on conflict (provider_id) do nothing returning id`,
            [patient.id, JSON.stringify({ type: "audio", voice: m.audio.voice ?? null, mime: m.audio.mime_type ?? null, whatsapp_timestamp: m.timestamp ?? null }), m.id],
          );
          if (!stored) continue;
          await db.query("select requeue_after_reply($1)", [patient.id]);
          touched.add(patient.id);
          voiceNotes.push({ patientId: patient.id, messageId: stored.id, mediaId: m.audio.id, isNew });
          continue;
        }

        const text = textOf(m);
        const result = await ingestMessage(db, {
          patientId: patient.id, isNew, providerId: m.id, kind: m.type === "text" ? "text" : "buttons", text,
          buttonId: m.interactive?.button_reply?.id ?? null,
          payload: { type: m.type, whatsapp_timestamp: m.timestamp ?? null },
        });
        if (!result.stored) continue; // duplicate delivery
        touched.add(patient.id);
        if (result.coachMessageId) toCoach.push({ patientId: patient.id, messageId: result.coachMessageId });
      }
    }
  }
  return { patients: [...touched], toCoach, voiceNotes };
}

type Db = Awaited<ReturnType<typeof getDb>>;

/**
 * Everything that happens to one incoming patient message, whatever the channel (WhatsApp, iMessage, demo phone):
 * store it once, reopen the reply window, handle a tapped quick reply in code, run the pain rule, welcome a new
 * patient, or hand the message to the AI coach (returned as coachMessageId; the caller runs the coach later).
 */
export async function ingestMessage(db: Db, m: {
  patientId: string; isNew: boolean; providerId: string; kind: "text" | "buttons"; text: string;
  buttonId: string | null; payload: Record<string, unknown>;
}): Promise<{ stored: boolean; coachMessageId: string | null }> {
  const patient = { id: m.patientId };
  const text = m.text;
  // Store the message. A channel may deliver the same message more than once: the unique provider id
  // makes the second copy a no-op.
  // created_at is when we received it (precise ordering); WhatsApp's own whole-second time is kept in payload.
  const [stored] = await db.query<{ id: string }>(
    `insert into messages (patient_id, direction, kind, body, payload, status, provider_id)
     values ($1, 'in', $2, $3, $4::jsonb, 'received', $5)
     on conflict (provider_id) do nothing returning id`,
    [patient.id, m.kind, text, JSON.stringify(m.payload), m.providerId],
  );
  if (!stored) return { stored: false, coachMessageId: null };

  // The patient just wrote, so the 24-hour window is open: re-queue anything WhatsApp refused for that reason.
  await db.query("select requeue_after_reply($1)", [patient.id]);
  return respondToMessage(db, { patientId: m.patientId, isNew: m.isNew, storedId: stored.id, text: m.text, buttonId: m.buttonId });
}

/**
 * What happens to a stored patient message: a tapped quick reply is handled in code, then the pain rule, then
 * sign-up, then the AI coach (returned as coachMessageId; the caller runs the coach). Also used for a voice note,
 * once it has been turned into text.
 */
export async function respondToMessage(db: Db, r: {
  patientId: string; isNew: boolean; storedId: string; text: string; buttonId: string | null;
}): Promise<{ stored: boolean; coachMessageId: string | null }> {
  const patient = { id: r.patientId };
  const stored = { id: r.storedId };
  const isNew = r.isNew;
  const text = r.text;
  const m = { buttonId: r.buttonId };

  // A tapped quick-reply button (reminder time, "what got in the way?") is handled by code, not the AI.
  const tapped = quickReplyAction(m.buttonId);
  // A check-up visit: the patient tapped one of the offered times, or asked for a call.
  if (tapped && !isNew && (tapped.kind === "visit_pick" || tapped.kind === "visit_call")) {
    const [v] = await db.query<{ id: string; options: string[]; doctor: string | null; clinic: string | null; first_name: string }>(
      `select v.id, v.options, d.name as doctor, d.clinic, split_part(trim(p.display_name), ' ', 1) as first_name
         from visits v join patients p on p.id = v.patient_id left join doctors d on d.id = v.doctor_id
        where v.patient_id = $1 and v.status = 'proposed' order by v.created_at desc limit 1`,
      [patient.id],
    );
    let reply = VISIT_GONE_TEXT;
    const slot = v && tapped.kind === "visit_pick" ? v.options[tapped.index] : null;
    if (v && tapped.kind === "visit_call") {
      await db.query("update visits set status = 'call_requested', answered_at = now() where id = $1 and status = 'proposed'", [v.id]);
      reply = VISIT_CALL_TEXT;
    } else if (v && slot) {
      // Only a time the clinic offered can be booked: the slot comes from the stored proposal, never from the message.
      await db.query("update visits set status = 'confirmed', chosen_at = $2, answered_at = now() where id = $1 and status = 'proposed'", [v.id, slot]);
      reply = confirmText({ firstName: v.first_name, doctor: v.doctor, clinic: v.clinic, slot: new Date(slot) });
    }
    await db.query(
      "insert into messages (patient_id, direction, kind, body, payload, status) values ($1, 'out', 'text', $2, $3::jsonb, 'queued')",
      [patient.id, reply, JSON.stringify({ type: "visit_answer", in_reply_to: stored.id })],
    );
    return { stored: true, coachMessageId: null };
  }
  // Sign-up taps: what they are recovering from, then which side. Then a starter plan goes out.
  if (tapped && !isNew && (tapped.kind === "set_condition" || tapped.kind === "set_side")) {
    if (tapped.kind === "set_condition") {
      await db.query("update patients set condition = $2 where id = $1", [patient.id, tapped.condition]);
      if (tapped.askSide) {
        await db.query(
          "insert into messages (patient_id, direction, kind, body, payload, status) values ($1, 'out', 'buttons', $2, $3::jsonb, 'queued')",
          [patient.id, SIDE_QUESTION, JSON.stringify({ type: "signup_side", quick_replies: SIDE_BUTTONS })],
        );
        return { stored: true, coachMessageId: null };
      }
    } else {
      await db.query("update patients set side = $2 where id = $1", [patient.id, tapped.side]);
    }
    await sendStarterPlan(db, patient.id);
    return { stored: true, coachMessageId: null };
  }
  if (tapped && !isNew) {
    if (tapped.kind === "set_time") {
      await db.query("update patients set reminder_hour = $2 where id = $1", [patient.id, tapped.hour]);
    }
    if (tapped.kind === "pain") {
      await raiseSafetyAlert({ patientId: patient.id, level: "high_pain",
        reason: "pain as the reason for missing sessions", reply: HIGH_PAIN_REPLY, sourceMessageId: stored.id });
    } else if (tapped.kind === "set_time" || tapped.kind === "reply") {
      // After a pain report, exercise is on hold until the physio reviews it: no Start button, whatever was tapped.
      const [hold] = await db.query<{ n: number }>(
        "select count(*)::int as n from alerts where patient_id = $1 and resolved_at is null and kind in ('pain', 'red_flag')",
        [patient.id],
      );
      const onHold = hold.n > 0;
      const reply = tapped.kind === "reply" && tapped.startButton && onHold
        ? "Totally understandable. Your physiotherapist will check in about your pain first; until then, rest is the right call."
        : tapped.reply;
      await db.query(
        "insert into messages (patient_id, direction, kind, body, payload, status) values ($1, 'out', 'buttons', $2, $3::jsonb, 'queued')",
        [patient.id, reply, JSON.stringify({ type: "quick_reply_answer", in_reply_to: stored.id,
          quick_replies: tapped.kind === "reply" ? tapped.buttons : undefined,
          start_button: tapped.kind === "reply" && !onHold ? tapped.startButton : undefined })],
      );
    }
    return { stored: true, coachMessageId: null };
  }

  // The pain rule (code, not a language model) decides first. A message it flags never reaches the AI coach.
  const safety = assessMessage(text);
  if (safety) {
    await raiseSafetyAlert({ patientId: patient.id, ...safety, sourceMessageId: stored.id });
  } else if (isNew || (await needsSetup(db, patient.id))) {
    // Someone who found Motiva on their own (the website's WhatsApp button): sign them up in three taps.
    const [p] = await db.query<{ first_name: string | null }>(
      "select nullif(split_part(trim(display_name), ' ', 1), 'WhatsApp') as first_name from patients where id = $1",
      [patient.id],
    );
    await db.query(
      "insert into messages (patient_id, direction, kind, body, payload, status) values ($1, 'out', 'buttons', $2, $3::jsonb, 'queued')",
      [patient.id, setupQuestion(p?.first_name ?? null, !isNew), JSON.stringify({ type: "welcome", quick_replies: CONDITION_BUTTONS })],
    );
  } else {
    // While a check-up proposal is waiting, words about when they can come ("mornings don't work, after three is
    // fine") are kept next to it for the clinic. The coach still answers the message.
    if (AVAILABILITY.test(text)) {
      await db.query(
        `update visits set patient_note = $2
          where id = (select id from visits where patient_id = $1 and status = 'proposed' order by created_at desc limit 1)`,
        [patient.id, text.slice(0, 500)],
      );
    }
    return { stored: true, coachMessageId: stored.id };
  }
  return { stored: true, coachMessageId: null };
}

/** Signed up by themselves and not finished: no condition chosen yet and no plan from a physiotherapist. */
async function needsSetup(db: Db, patientId: string): Promise<boolean> {
  const [row] = await db.query<{ needs: boolean }>(
    `select p.condition = 'Not assessed yet'
            and not exists (select 1 from prescriptions r where r.patient_id = p.id and r.status = 'active') as needs
       from patients p where p.id = $1`,
    [patientId],
  );
  return row?.needs === true;
}

/**
 * The end of sign-up: a gentle starter plan with the Start button, a note for the physiotherapist, then the reminder
 * time question. A plan the physiotherapist already set is never replaced.
 */
async function sendStarterPlan(db: Db, patientId: string) {
  const [p] = await db.query<{ first_name: string; condition: string; has_plan: boolean }>(
    `select split_part(trim(display_name), ' ', 1) as first_name, condition,
            exists (select 1 from prescriptions r where r.patient_id = patients.id and r.status = 'active') as has_plan
       from patients where id = $1`,
    [patientId],
  );
  if (!p) return;
  if (p.has_plan) {
    await db.query(
      "insert into messages (patient_id, direction, kind, body, payload, status) values ($1, 'out', 'text', $2, $3::jsonb, 'queued')",
      [patientId, "You already have a plan from your physiotherapist. Tap Start session when you are ready.", JSON.stringify({ type: "signup_done", start_button: true })],
    );
    return;
  }
  const items = starterPlan(p.condition);
  const days = 5;
  const [{ rx }] = await db.query<{ rx: string }>(
    "select prescribe($1, $2::jsonb, $3, $4) as rx",
    [patientId, JSON.stringify(items.map(({ exercise_id, sets, reps }) => ({ exercise_id, sets, reps }))), days,
      "Starter plan sent automatically when the patient signed up on WhatsApp. Please review it."],
  );
  const first = p.first_name && p.first_name !== "WhatsApp" ? p.first_name : "there";
  // prescribe() words its message as the physiotherapist's plan; this one is a starter plan, so say so.
  await db.query(
    "update messages set body = $2 where patient_id = $1 and direction = 'out' and status = 'queued' and payload->>'prescription_id' = $3",
    [patientId, starterPlanText(first, items, days), rx],
  );
  await db.query(
    "insert into memories (patient_id, kind, fact, author) values ($1, 'history', $2, 'coach')",
    [patientId, `Signed up on WhatsApp (${p.condition}). A starter plan was sent automatically: please review it.`],
  );
  await db.query(
    "insert into messages (patient_id, direction, kind, body, payload, status) values ($1, 'out', 'buttons', $2, $3::jsonb, 'queued')",
    [patientId, TIME_QUESTION, JSON.stringify({ type: "signup_time", quick_replies: TIME_BUTTONS })],
  );
}
