// WhatsApp quick-reply buttons and what happens when the patient taps one. Pure, unit-tested.
//   - Sign-up (someone who found Motiva on the website): "What are you recovering from?"  Knee replacement /
//     Hip replacement / Something else, then "Which side?"  Left / Right / Both, then a starter plan is sent.
//   - After sign-up: "When would you like your daily reminder?"  Morning / Afternoon / Evening
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

/** Sign-up, step 1. Three buttons is WhatsApp's limit (and iMessage shows them as 1, 2, 3). */
export const CONDITION_BUTTONS: Button[] = [
  { id: "reg_knee", title: "Knee replacement" },
  { id: "reg_hip", title: "Hip replacement" },
  { id: "reg_other", title: "Something else" },
];

/** Sign-up, step 2 (knee and hip only). */
export const SIDE_BUTTONS: Button[] = [
  { id: "reg_side_left", title: "Left" },
  { id: "reg_side_right", title: "Right" },
  { id: "reg_side_both", title: "Both" },
];

const CONDITIONS: Record<string, { condition: string; askSide: boolean }> = {
  reg_knee: { condition: "Total knee replacement", askSide: true },
  reg_hip: { condition: "Total hip replacement", askSide: true },
  reg_other: { condition: "Other", askSide: false },
};

const SIDES: Record<string, "left" | "right" | "both"> = { reg_side_left: "left", reg_side_right: "right", reg_side_both: "both" };

/** The first message to someone new, and to anyone who has not finished signing up. */
export function setupQuestion(firstName: string | null, again = false): string {
  if (again) return "Let's finish setting you up first, it only takes a moment. What are you recovering from?";
  return `Hi${firstName ? ` ${firstName}` : ""}! I'm the Motiva coach. I help you do your rehab exercises at home: your phone ` +
    "camera counts every rep and corrects your form out loud, and your physiotherapist sees how it's going.\n\n" +
    "Let's set you up, it takes three taps. What are you recovering from?";
}

export const SIDE_QUESTION = "Got it. Which side was it?";
export const TIME_QUESTION = "Last thing: when would you like your daily reminder?";

export type StarterItem = { exercise_id: string; name: string; sets: number; reps: number };

/**
 * A gentle starter plan so a new patient can begin today, from their phone. Camera-scored exercises only, fewer reps
 * than usual. Their physiotherapist is told and can change it at any time. No chair squat after a hip replacement
 * (deep hip bends are usually restricted early on).
 */
export function starterPlan(condition: string): StarterItem[] {
  const sit = { exercise_id: "sit_to_stand", name: "Sit-to-stand", sets: 2, reps: 8 };
  if (/knee/i.test(condition)) return [sit, { exercise_id: "squat", name: "Chair squat", sets: 2, reps: 8 }];
  return [sit, { exercise_id: "arm_raise", name: "Arm raise to the side", sets: 2, reps: 8 }];
}

export function starterPlanText(firstName: string, items: StarterItem[], daysPerWeek: number): string {
  return [
    `All set, ${firstName}! Here is your starter plan, ${daysPerWeek} days a week:`,
    ...items.map((e, i) => `${i + 1}. ${e.name}: ${e.sets} x ${e.reps}`),
    "Your physiotherapist will review it and can change it any time.",
    "Tap Start session: your phone camera counts your reps, and the video stays on your phone.",
  ].join("\n");
}

const HOURS: Record<string, { hour: number; words: string }> = {
  time_morning: { hour: 9, words: "in the morning, around 9 am" },
  time_afternoon: { hour: 14, words: "in the afternoon, around 2 pm" },
  time_evening: { hour: 18, words: "in the evening, around 6 pm" },
};

export type QuickReplyAction =
  | { kind: "set_condition"; condition: string; askSide: boolean }
  | { kind: "set_side"; side: "left" | "right" | "both" }
  | { kind: "set_time"; hour: number; reply: string }
  | { kind: "pain" }
  | { kind: "reply"; reply: string; buttons?: Button[]; startButton?: boolean };

export function quickReplyAction(id: string | undefined | null): QuickReplyAction | null {
  if (!id) return null;
  const condition = CONDITIONS[id];
  if (condition) return { kind: "set_condition", ...condition };
  const side = SIDES[id];
  if (side) return { kind: "set_side", side };
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
