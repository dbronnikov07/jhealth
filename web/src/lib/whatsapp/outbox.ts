// The outbox: every message to a patient is first written to the database as 'queued' (for example by
// prescribe()), then sent from here. If sending fails, nothing is lost: the row says why, and it can be retried.
import { getDb, pgMessage } from "../db";
import { sendToWhatsApp, whatsappConfig, WhatsAppError } from "./client";
import { buttonsPayload, ctaPayload, textPayload } from "./payloads";

type Claimed = {
  id: string;
  kind: string;
  body: string | null;
  payload: { type?: string; start_button?: boolean; quick_replies?: { id: string; title: string }[] } | null;
  phone: string | null;
  whatsapp_user_id: string | null;
  session_token: string;
  channel: "whatsapp" | "demo";
};

/** The link the "Start session" button opens. */
export function sessionUrl(token: string): string | null {
  const base = process.env.PUBLIC_APP_URL?.replace(/\/$/, "");
  return base ? `${base}/s/${token}` : null;
}

export async function processOutbox(patientId?: string) {
  const cfg = whatsappConfig();
  const db = await getDb();
  if (!cfg) {
    // Without WhatsApp only the demo phone can receive messages, so only claim a demo patient's queue.
    if (!patientId) return { sent: 0, failed: 0, notConfigured: true };
    const [p] = await db.query<{ channel: string }>("select channel from patients where id = $1", [patientId]);
    if (p?.channel !== "demo") return { sent: 0, failed: 0, notConfigured: true };
  }

  const claimed = await db.query<Claimed>(
    `select m.id, m.kind, m.body, m.payload, p.phone, p.whatsapp_user_id, p.session_token, p.channel
       from claim_outbox($1::uuid) m join patients p on p.id = m.patient_id
      order by m.created_at`,
    [patientId ?? null],
  );

  let sent = 0;
  let failed = 0;
  for (const m of claimed) {
    if (m.channel === "demo") {
      // The demo phone (/s/<token>/phone) reads messages straight from the database: handing it over is the delivery.
      await db.query(
        "update messages set status = 'delivered', provider_id = $2, sent_at = now(), error = null, error_code = null where id = $1",
        [m.id, `demo.${m.id}`],
      );
      sent++;
      continue;
    }
    if (!cfg) {
      await db.query("update messages set status = 'queued' where id = $1", [m.id]); // not ours to send
      continue;
    }
    const to = { phone: m.phone, userId: m.whatsapp_user_id };
    const url = sessionUrl(m.session_token);
    let providerId: string;
    try {
      const quick = m.payload?.quick_replies;
      const payload =
        quick?.length
          ? buttonsPayload(to, m.body ?? "", quick)     // tappable answers: reminder time, "what got in the way?"
          : // A new plan, or a message inviting the patient to start now, carries the Start button.
            (m.payload?.type === "new_plan" || m.payload?.start_button === true) && url
            ? ctaPayload(to, m.body ?? "", "Start session", url, "jHealth · your physiotherapist's plan")
            : textPayload(to, m.body ?? "");
      providerId = await sendToWhatsApp(cfg, payload);
    } catch (error) {
      const code = error instanceof WhatsAppError ? error.code : "internal";
      const text = error instanceof Error ? error.message : "Unknown error";
      // A network hiccup goes back in the queue; anything else is reported as failed.
      await db.query(
        "update messages set status = $2, error_code = $3, error = $4 where id = $1",
        [m.id, code === "network" ? "queued" : "failed", code, text],
      );
      failed++;
      continue;
    }
    // WhatsApp has accepted the message. Whatever happens while recording it, it must never be sent twice,
    // so it is marked sent even if storing WhatsApp's id fails (then only delivery receipts are lost).
    try {
      await db.query(
        "update messages set status = 'sent', provider_id = $2, sent_at = now(), error = null, error_code = null where id = $1",
        [m.id, providerId],
      );
    } catch (error) {
      await db.query(
        "update messages set status = 'sent', sent_at = now(), error_code = 'receipt', error = $2 where id = $1",
        [m.id, `Sent, but WhatsApp's message id could not be saved (${pgMessage(error)}), so read receipts will not show.`],
      ).catch(() => {});
    }
    sent++;
  }
  return { sent, failed, notConfigured: false };
}
