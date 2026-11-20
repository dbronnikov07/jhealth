// What happens after a patient's message has been stored, for WhatsApp and the demo phone alike: send what is ready
// now (safety replies, welcome, plans released by the 24-hour window), turn voice notes into text and handle them
// like typed messages, then let the AI coach answer the ordinary messages and send its replies. Runs after the HTTP
// response (next/server `after`).
import { coachReply } from "../coach/reply";
import { getDb } from "../db";
import { whatsappConfig } from "./client";
import { respondToMessage, type VoiceNoteJob } from "./inbound";
import { processOutbox } from "./outbox";
import { MAX_VOICE_SECONDS, transcribeVoiceNote } from "./voice-note";

const VOICE_FAILED = "Sorry, I couldn't make out that voice message. Could you send it again, a little closer to the phone, or type it?";
const VOICE_FORMAT = "Sorry, I can only listen to voice notes recorded in WhatsApp (hold the microphone button). Could you record one, or type it?";

/** A voice note: listen, store the words in place of "[voice message]", then handle it like a typed message. */
async function handleVoiceNote(v: VoiceNoteJob): Promise<string | null> {
  const db = await getDb();
  const cfg = whatsappConfig();
  const heard = cfg ? await transcribeVoiceNote(cfg, v.mediaId) : { text: null, reason: "download" as const, seconds: 0 };
  if (!heard.text) {
    await db.query("update messages set body = $2, payload = payload || $3::jsonb where id = $1",
      [v.messageId, "[voice message, could not be transcribed]", JSON.stringify({ transcribed: false, reason: heard.reason })]);
    await db.query(
      "insert into messages (patient_id, direction, kind, body, payload, status) values ($1, 'out', 'text', $2, $3::jsonb, 'queued')",
      [v.patientId, heard.reason === "format" ? VOICE_FORMAT : VOICE_FAILED, JSON.stringify({ type: "voice_failed", in_reply_to: v.messageId })],
    );
    return null;
  }
  const cut = heard.seconds > MAX_VOICE_SECONDS;
  await db.query("update messages set body = $2, payload = payload || $3::jsonb where id = $1",
    [v.messageId, heard.text.slice(0, 2000), JSON.stringify({ transcribed: true, seconds: Math.round(heard.seconds), cut })]);
  const r = await respondToMessage(db, { patientId: v.patientId, isNew: v.isNew, storedId: v.messageId, text: heard.text, buttonId: null });
  return r.coachMessageId;
}

export async function deliverAndCoach(
  patients: string[],
  toCoach: { patientId: string; messageId: string }[],
  voiceNotes: VoiceNoteJob[] = [],
) {
  for (const id of patients) await processOutbox(id);
  for (const v of voiceNotes) {
    try {
      const coachId = await handleVoiceNote(v);
      if (coachId) toCoach.push({ patientId: v.patientId, messageId: coachId });
    } catch (error) {
      console.error("[whatsapp] voice note failed:", error instanceof Error ? error.message : error);
    }
    await processOutbox(v.patientId);
  }
  for (const { patientId, messageId } of toCoach) {
    try {
      await coachReply(patientId, messageId);
    } catch (error) {
      console.error("[coach] failed:", error);
    }
    await processOutbox(patientId);
  }
}
