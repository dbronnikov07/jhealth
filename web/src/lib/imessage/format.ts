// iMessage has no buttons, so the coach's tappable answers become numbered replies, and the Start button becomes a
// link (iMessage shows it as a preview card). Pure functions, unit-tested in scripts/imessage.test.ts.
import type { Button } from "../quick-replies.ts";

/** The patient's iMessage address in one canonical form: +E.164 for phone numbers, lower-case for email. */
export function normalizeHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(s)) return s.toLowerCase();
  const digits = s.replace(/[\s().-]/g, "");
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  if (/^1\d{10}$/.test(digits)) return `+${digits}`;          // North American number with the 1
  if (/^\d{10}$/.test(digits)) return `+1${digits}`;          // ...or without it
  return null;
}

/** A short, privacy-friendly form for logs and the dashboard: +1 ••• ••• 0142, m•••@icloud.com */
export function maskHandle(handle: string): string {
  if (handle.includes("@")) {
    const [user, domain] = handle.split("@");
    return `${user.slice(0, 1)}•••@${domain}`;
  }
  return `${handle.slice(0, 2)} ••• ••• ${handle.slice(-4)}`;
}

export type OutPayload = { type?: string; start_button?: boolean; quick_replies?: { id: string; title: string }[] } | null;

/** The text the bridge sends: the message, then numbered answers or the session link. */
export function formatForIMessage(body: string, payload: OutPayload, sessionLink: string | null): string {
  const parts = [body.trim()];
  const buttons = (payload?.quick_replies ?? []).slice(0, 3);
  if (buttons.length) {
    parts.push(`Reply with a number:\n${buttons.map((b, i) => `${i + 1}. ${b.title}`).join("\n")}`);
  }
  const wantsStart = payload?.type === "new_plan" || payload?.start_button === true;
  if (wantsStart && sessionLink) parts.push(`Start today's session: ${sessionLink}`);
  return parts.join("\n\n").slice(0, 4000);
}

/** Which of the coach's offered answers this reply means: "2", "2.", "Afternoon", "afternoon!" ... or none. */
export function matchQuickReply(text: string, offered: Button[]): Button | null {
  const t = text.trim().toLowerCase().replace(/[.!?)\s]+$/g, "");
  if (!t || t.length > 40) return null;
  if (/^[1-3]$/.test(t)) return offered[Number(t) - 1] ?? null;
  return offered.find((b) => b.title.toLowerCase() === t) ?? null;
}

/** The link that opens Messages with Motiva Health's address and a first message already typed (iPhone, iPad, Mac). */
export function textUsLink(address: string, body = "Hi Motiva! My physio asked me to text you."): string {
  return `sms:${address}?&body=${encodeURIComponent(body)}`;
}
