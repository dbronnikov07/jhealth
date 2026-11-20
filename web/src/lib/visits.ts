// Check-up visits: times as the clinic's clock shows them, and the words the patient reads. Pure (no database).
// The clinic is in Toronto; every time typed or shown is Toronto time, whatever the server's or the phone's zone.

export const CLINIC_TZ = "America/Toronto";

type Parts = { y: number; mo: number; d: number; h: number; mi: number; weekday: string; month: string };

function partsIn(date: Date, tz = CLINIC_TZ): Parts {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  const names = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long" }).formatToParts(date);
  return {
    y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute),
    weekday: names.find((x) => x.type === "weekday")!.value, month: names.find((x) => x.type === "month")!.value,
  };
}

/** "2026-11-26T15:00" as typed at the clinic (a datetime-local field) -> that instant. Null if it is not a time. */
export function clinicTimeToUtc(local: string, tz = CLINIC_TZ): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local.trim());
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // The zone's offset at an instant: what its clock shows there, read as if it were UTC, minus the instant.
  const offset = (t: number) => {
    const p = partsIn(new Date(t), tz);
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - t;
  };
  let t = wall - offset(wall);
  t = wall - offset(t);                 // a second pass settles the hours around a clock change
  return new Date(t);
}

/** The instant as a datetime-local value on the clinic's clock: "2026-11-26T15:00". */
export function clinicInputValue(date: Date, tz = CLINIC_TZ): string {
  const p = partsIn(date, tz);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${p.y}-${two(p.mo)}-${two(p.d)}T${two(p.h)}:${two(p.mi)}`;
}

const clock = (p: Parts) => `${p.h % 12 === 0 ? 12 : p.h % 12}:${String(p.mi).padStart(2, "0")} ${p.h < 12 ? "am" : "pm"}`;

/** "Thursday 26 November at 3:00 pm" */
export function slotLong(date: Date, tz = CLINIC_TZ): string {
  const p = partsIn(date, tz);
  return `${p.weekday} ${p.d} ${p.month} at ${clock(p)}`;
}

/** "Thu 26, 3:00 pm": short enough for a WhatsApp button (20 characters at most). */
export function slotShort(date: Date, tz = CLINIC_TZ): string {
  const p = partsIn(date, tz);
  return `${p.weekday.slice(0, 3)} ${p.d}, ${clock(p)}`;
}

/** Two times to start from: the next two working days at 10:00 am and 3:00 pm, clinic time. */
export function defaultSlots(now = new Date(), tz = CLINIC_TZ): [string, string] {
  const out: string[] = [];
  const hours = ["10:00", "15:00"];
  for (let add = 1; out.length < 2 && add < 10; add++) {
    const day = new Date(now.getTime() + add * 86_400_000);
    const p = partsIn(day, tz);
    if (p.weekday === "Saturday" || p.weekday === "Sunday") continue;
    out.push(`${p.y}-${String(p.mo).padStart(2, "0")}-${String(p.d).padStart(2, "0")}T${hours[out.length]}`);
  }
  return [out[0], out[1]];
}

export type VisitButton = { id: string; title: string };

/** The buttons under the proposal: one per offered time, and "Call me instead". Three is WhatsApp's limit. */
export function visitButtons(slots: Date[]): VisitButton[] {
  return [...slots.slice(0, 2).map((s, i) => ({ id: `visit_${i + 1}`, title: slotShort(s) })), { id: "visit_call", title: "Call me instead" }];
}

export function proposalText(o: { firstName: string; doctor: string | null; clinic: string | null; slots: Date[]; reason: string | null }): string {
  const who = o.doctor ?? "Your physiotherapist";
  const where = o.clinic ? ` at ${o.clinic}` : "";
  const why = o.reason ? ` (${o.reason})` : "";
  const times = o.slots.slice(0, 2).map((s, i) => (o.slots.length > 1 ? `${i + 1}. ${slotLong(s)}` : slotLong(s)));
  return [
    `Hi ${o.firstName}, ${who} would like to see you for a check-up${where}${why}.`,
    o.slots.length > 1 ? "Which time works for you?" : "Does this time work for you?",
    ...times,
    "Tap a time, or tap Call me instead and the clinic will phone you.",
  ].join("\n");
}

export function confirmText(o: { firstName: string; doctor: string | null; clinic: string | null; slot: Date }): string {
  return `Booked, ${o.firstName}: ${slotLong(o.slot)}${o.doctor ? ` with ${o.doctor}` : ""}${o.clinic ? ` at ${o.clinic}` : ""}. ` +
    "If you can't make it, tell me here and I'll let the clinic know.";
}

export const VISIT_CALL_TEXT = "No problem. I've asked the clinic to call you to find a time that works.";
export const VISIT_GONE_TEXT = "That check-up is no longer open. Your physiotherapist will send a new time if one is needed.";

export function cancelText(firstName: string, slot: Date): string {
  return `Hi ${firstName}, the clinic has cancelled your check-up on ${slotLong(slot)}. They will be in touch about a new time.`;
}

/** Does a typed or spoken message talk about when they can come? Then the clinic should see it next to the proposal. */
export const AVAILABILITY =
  /\b(can't|cannot|can not|won't|doesn't work|don't work|not free|busy|another time|different time|other time|reschedul|morning|afternoon|evening|after \w+|before \w+|monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week|drive me|a ride|o'clock|\d ?(am|pm))\b/i;

/** What the AI coach is told about the patient's visit, so it never invents a time or confirms a booking itself. */
export function visitCoachLine(v: { status: string; options: string[]; chosenAt: Date | null }): string | null {
  if (v.status === "proposed") {
    return `CHECK-UP VISIT: their physiotherapist offered ${v.options.map((o) => slotLong(new Date(o))).join(" or ")}; they have not chosen yet (they choose by tapping a time under that message). ` +
      "If they say the times do not work or ask for another, say you have passed that on to the clinic, who will offer new times or call. Never invent a time; never say it is booked.";
  }
  if (v.status === "confirmed" && v.chosenAt) {
    return `CHECK-UP VISIT: booked for ${slotLong(v.chosenAt)}. If they cannot come, say you will let the clinic know (flag it for the physiotherapist); you cannot move it yourself.`;
  }
  if (v.status === "call_requested") return "CHECK-UP VISIT: they asked the clinic to call them to find a time. The clinic will phone; you cannot book it.";
  return null;
}
