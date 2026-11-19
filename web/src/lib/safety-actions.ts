// What happens when the pain rule fires, wherever it fired (a WhatsApp message or the "It hurts" button):
// an alert for the physiotherapist, a remembered fact, and the safety reply queued for WhatsApp.
import { getDb } from "./db";
import type { SafetyLevel } from "./safety";

export async function raiseSafetyAlert(opts: {
  patientId: string;
  level: SafetyLevel;
  reason: string;
  reply: string;
  sourceMessageId?: string | null;
}) {
  const db = await getDb();
  const detail = opts.level === "red_flag" ? `Possible red flag: ${opts.reason}` : `Reported ${opts.reason}`;
  await db.query(
    "insert into alerts (patient_id, kind, detail, source_message_id) values ($1, $2, $3, $4)",
    [opts.patientId, opts.level === "red_flag" ? "red_flag" : "pain", detail, opts.sourceMessageId ?? null],
  );
  await db.query(
    "insert into memories (patient_id, kind, fact, source_message_id, author) values ($1, 'pain', $2, $3, 'coach')",
    [opts.patientId, `Reported ${opts.reason}`, opts.sourceMessageId ?? null],
  );
  await db.query(
    "insert into messages (patient_id, direction, kind, body, payload, status) values ($1, 'out', 'text', $2, $3::jsonb, 'queued')",
    [opts.patientId, opts.reply, JSON.stringify({ type: "safety_reply", level: opts.level })],
  );
}
