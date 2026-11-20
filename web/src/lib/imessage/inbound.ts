// An iMessage from a patient, as forwarded by the Mac bridge. Runs the same code as WhatsApp (ingestMessage):
// pain rule first, then welcome, quick replies or the AI coach. Someone texting Motiva for the first time becomes a
// patient on the iMessage channel, linked to the default doctor.
import { getDb } from "../db";
import { CONDITION_BUTTONS, quickReplyAction, SIDE_BUTTONS, TIME_BUTTONS, WHY_BUTTONS, type Button } from "../quick-replies";
import { ingestMessage } from "../whatsapp/inbound";
import { JOIN_WORD, matchQuickReply, normalizeHandle } from "./format";

const KNOWN: Button[] = [...CONDITION_BUTTONS, ...SIDE_BUTTONS, ...TIME_BUTTONS, ...WHY_BUTTONS];

export type IncomingIMessage = { handle: string; text: string; guid: string };


export async function handleIMessage(raw: IncomingIMessage): Promise<{ patientId: string; coachMessageId: string | null } | null> {
  const handle = normalizeHandle(raw.handle);
  const text = raw.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, 2000);
  if (!handle || !text || !/^[\w.:@+\-/]{6,120}$/.test(raw.guid)) return null;

  const db = await getDb();
  let [patient] = await db.query<{ id: string }>("select id from patients where imessage_handle = $1", [handle]);
  let isNew = false;
  if (!patient) {
    if (!JOIN_WORD.test(text)) return null;
    const isPhone = handle.startsWith("+");
    // A phone number already used by another patient (say, on WhatsApp) stays with them; this record keeps only the handle.
    const [taken] = isPhone ? await db.query<{ n: number }>("select count(*)::int as n from patients where phone = $1", [handle]) : [{ n: 0 }];
    const name = isPhone ? `iMessage ${handle.slice(-4)}` : `iMessage ${handle.split("@")[0].slice(0, 24)}`;
    [patient] = await db.query<{ id: string }>(
      `insert into patients (display_name, phone, imessage_handle, channel, condition)
       values ($1, $2, $3, 'imessage', 'Not assessed yet') returning id`,
      [name, isPhone && taken.n === 0 ? handle : null, handle],
    );
    isNew = true;
  }

  // "2" or "Afternoon" only counts as an answer if the coach's last message offered those answers.
  const [last] = await db.query<{ payload: { quick_replies?: { id?: string }[] } | null }>(
    "select payload from messages where patient_id = $1 and direction = 'out' order by created_at desc limit 1",
    [patient.id],
  );
  const offered = (last?.payload?.quick_replies ?? [])
    .map((q) => KNOWN.find((b) => b.id === q.id))
    .filter((b): b is Button => !!b);
  const tapped = offered.length ? matchQuickReply(text, offered) : null;
  const buttonId = tapped && quickReplyAction(tapped.id) ? tapped.id : null;

  const result = await ingestMessage(db, {
    patientId: patient.id, isNew, providerId: `imsg.in.${raw.guid}`, kind: buttonId ? "buttons" : "text", text,
    buttonId, payload: { type: "imessage" },
  });
  if (!result.stored) return null; // the bridge sent this one before
  return { patientId: patient.id, coachMessageId: result.coachMessageId };
}
