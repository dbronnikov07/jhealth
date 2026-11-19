// WhatsApp quick-reply buttons and what happens when the patient taps one. Pure, unit-tested.
//   - At welcome: "When would you like your daily reminder?"  Morning / Afternoon / Evening
//   - After 3 days away: "What got in the way?"  I forgot / It hurt / No time
// A tap is handled by code, not the AI: it is fast, predictable, and "It hurt" always reaches the physiotherapist.
// Wording is a DRAFT for the demo; a physiotherapist should review it.

export type Button = { id: string; title: string };

export const TIME_BUTTONS: Button[] = [
  { id: "time_morning", title: "Morning" },
  { id: "time_afternoon", title: "Afternoon" },
  { id: "time_evening", title: "Evening" },
];

export const WHY_BUTTONS: Button[] = [
  { id: "why_forgot", title: "I forgot" },
  { id: "why_pain", title: "It hurt" },
  { id: "why_time", title: "No time" },
];

const HOURS: Record<string, { hour: number; words: string }> = {
  time_morning: { hour: 9, words: "in the morning, around 9 am" },
  time_afternoon: { hour: 14, words: "in the afternoon, around 2 pm" },
  time_evening: { hour: 18, words: "in the evening, around 6 pm" },
};

export type QuickReplyAction =
  | { kind: "set_time"; hour: number; reply: string }
  | { kind: "pain" }
  | { kind: "reply"; reply: string; buttons?: Button[]; startButton?: boolean };

export function quickReplyAction(id: string | undefined | null): QuickReplyAction | null {
  if (!id) return null;
  const time = HOURS[id];
  if (time) {
    return { kind: "set_time", hour: time.hour, reply: `Perfect, I'll remind you ${time.words}. You can change it any time, just tell me.` };
  }
  switch (id) {
    case "why_pain":
      return { kind: "pain" };
    case "why_forgot":
      return { kind: "reply", reply: "That happens to everyone! Would a different reminder time help?", buttons: TIME_BUTTONS };
    case "why_time":
      return {
        kind: "reply",
        reply: "Totally understandable. Even five minutes counts: try just the first exercise today, and that's a win. Tap Start when you have a moment.",
        startButton: true,
      };
    default:
      return null;
  }
}
