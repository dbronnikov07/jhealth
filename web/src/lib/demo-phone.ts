// The demo phone: a chat page on our own site that stands in for WhatsApp (for example on stage, while Meta's account
// is unavailable). Pure helpers, unit-tested in scripts/demo-phone.test.ts.
//
// How it stays identical to WhatsApp: a message typed on the demo phone is turned into the same webhook body Meta
// would send, and handled by the same code (pain rule, quick replies, AI coach). Replies go through the same outbox,
// which hands them to the demo phone instead of calling Meta.
//
// Security: the page and its API take the patient's 64-character session token (the same key as the exercise page)
// and only work for patients the physiotherapist put on the demo channel. Input is length-limited, only the coach's
// own buttons can be tapped, and each patient may send at most RATE.perTenMinutes messages per 10 minutes and
// RATE.perDay per day, which also caps what the AI coach can spend.
import { quickReplyAction, TIME_BUTTONS, WHY_BUTTONS, type Button } from "./quick-replies.ts";

export const MAX_TEXT = 1000;
export const RATE = { perTenMinutes: 20, perDay: 200 };
const KNOWN_BUTTONS: Button[] = [...TIME_BUTTONS, ...WHY_BUTTONS];

export type DemoRequest =
  | { ok: true; token: string; action: "list" }
  | { ok: true; token: string; action: "send"; text: string; button: null }
  | { ok: true; token: string; action: "send"; text: null; button: Button }
  | { ok: false; status: 400; error: string };

const bad = (error: string): DemoRequest => ({ ok: false, status: 400, error });

/** Checks everything the browser sent. Never trusts it: unknown fields are ignored, wrong ones refused. */
export function parseDemoRequest(raw: unknown): DemoRequest {
  if (typeof raw !== "object" || raw === null) return bad("Expected a JSON object.");
  const r = raw as Record<string, unknown>;
  if (typeof r.token !== "string" || !/^[0-9a-f]{64}$/.test(r.token)) return bad("Invalid link.");
  if (r.action === "list") return { ok: true, token: r.token, action: "list" };
  if (r.action !== "send") return bad("Unknown action.");
  const hasText = r.text !== undefined && r.text !== null;
  const hasButton = r.button !== undefined && r.button !== null;
  if (hasText === hasButton) return bad("Send either a text or a button.");
  if (hasButton) {
    const button = KNOWN_BUTTONS.find((b) => b.id === r.button);
    if (!button || !quickReplyAction(button.id)) return bad("Unknown button.");
    return { ok: true, token: r.token, action: "send", text: null, button };
  }
  if (typeof r.text !== "string") return bad("The message must be text.");
  // Control characters (other than line breaks and tabs) have no business in a chat message.
  const text = r.text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!text) return bad("Type a message first.");
  if (text.length > MAX_TEXT) return bad(`Keep it under ${MAX_TEXT} characters.`);
  return { ok: true, token: r.token, action: "send", text, button: null };
}

/** The webhook body WhatsApp would send for this message, so the same code handles it. */
export function demoWebhook(phone: string, input: { text: string; button: null } | { text: null; button: Button }, id: string, now = new Date()) {
  const from = phone.replace(/^\+/, "");
  const timestamp = String(Math.floor(now.getTime() / 1000));
  const message = input.button
    ? { id, from, timestamp, type: "interactive", interactive: { type: "button_reply", button_reply: { id: input.button.id, title: input.button.title } } }
    : { id, from, timestamp, type: "text", text: { body: input.text } };
  return { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messages: [message] } }] }] };
}

export type PhoneMessage = {
  id: string;
  mine: boolean;                 // true: the patient wrote it (right side); false: the coach (left side)
  text: string;
  at: string;                    // ISO time
  buttons: Button[];             // quick replies the patient can tap
  start: boolean;                // shows the "Start session" button
  ai: boolean;                   // written by the AI coach (labelled, as on the dashboard)
};

export type MessageRow = {
  id: string;
  direction: "in" | "out";
  body: string | null;
  at: Date | string;
  payload: { type?: string; start_button?: boolean; quick_replies?: { id?: unknown; title?: unknown }[] } | null;
};

/** What the demo phone shows for a stored message. Only the coach's own buttons survive; the link is never taken
 *  from the message (the page builds it from the token). */
export function toPhoneMessage(row: MessageRow): PhoneMessage {
  const payload = row.payload ?? {};
  const mine = row.direction === "in";
  const buttons = mine ? [] : (payload.quick_replies ?? [])
    .map((q) => KNOWN_BUTTONS.find((b) => b.id === q.id))
    .filter((b): b is Button => !!b)
    .slice(0, 3);
  return {
    id: row.id,
    mine,
    text: row.body ?? "",
    at: new Date(row.at).toISOString(),
    buttons,
    start: !mine && (payload.type === "new_plan" || payload.start_button === true),
    ai: !mine && payload.type === "coach_reply",
  };
}

/** A fictional number for a demo patient: +1 416 555 0100 to 0199 are reserved for fiction and never ring anyone. */
export function fictionalPhone(taken: Iterable<string>): string | null {
  const used = new Set(taken);
  for (let n = 100; n <= 199; n++) {
    const phone = `+1416555${String(n).padStart(4, "0")}`;
    if (!used.has(phone)) return phone;
  }
  return null;
}
