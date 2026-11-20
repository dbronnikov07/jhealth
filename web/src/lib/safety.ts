// The pain rule: decides, from a patient's WhatsApp message, whether to stop coaching and alert the physiotherapist.
//
// It is plain code on purpose. A safety behaviour that depends on a language model following instructions
// will fail once in rehearsal and once on stage. Every outcome here can be read, tested and explained.
//
// Limits, said plainly:
//  - English only for now.
//  - Pattern matching, not understanding. It errs on the side of flagging: a false alarm costs a physio a
//    minute, a missed one could cost much more.
//  - The reply wording is a DRAFT. A clinician must review it before real patients use it.
//  - Health811 is Ontario's free health line (dial 811), which matches the pilot region.

export type SafetyLevel = "red_flag" | "high_pain";
export type SafetyResult = { level: SafetyLevel; score: number | null; reason: string; reply: string } | null;

const RED_FLAGS: [RegExp, string][] = [
  [/chest\s*pain|pain in (?:my|the) chest|chest (?:hurts|is tight)/i, "chest pain"],
  [/(?:can'?t|cannot|hard to|trouble|difficulty|struggling to)\s+breath(?:e|ing)|short(?:ness)? of breath|out of breath/i, "trouble breathing"],
  [/calf\b[^.!?\n]{0,30}\b(?:pain|hurt|swell|swollen|red|hot|warm|tender)|(?:swollen|painful|red|hot)\s+calf/i, "calf pain or swelling"],
  [/\bfever\b|\bchills\b/i, "fever or chills"],
  [/(?:wound|incision|scar|stitches|staples)[^.!?\n]{0,30}(?:pus|ooz|leak|bleed|open|smell|red|hot)/i, "a problem with the wound"],
  [/\b(?:fell|fallen) (?:down|over|off)\b|\bhad a fall\b|\bi fell\b(?! asleep)/i, "a fall"],
];

const PAIN_WORD = String.raw`(?:pain|painful|hurts?|hurting|sore|aches?|aching)`;
const SCORE = String.raw`(\d{1,2})\s*(?:\/|out of|of)\s*10(?!\s*(?:reps?|repetitions|times|squats|sets))`;
const SCORE_PATTERNS = [
  new RegExp(String.raw`${PAIN_WORD}[^\d.!?\n]{0,30}${SCORE}`, "gi"),        // "it hurts, like 7 out of 10"
  new RegExp(String.raw`${SCORE}[^\d.!?\n]{0,25}${PAIN_WORD}`, "gi"),        // "8/10 pain"
  new RegExp(String.raw`${PAIN_WORD}\s*(?:is|level|score|=|:|at|about|around)?\s*(\d{1,2})\b(?!\s*(?:\/|out of|of|reps?|times|squats|sets|days?|minutes?|mins?|hours?|%))`, "gi"), // "pain 8"
];
const SEVERE_WORDS = /\b(?:unbearable|excruciating|worst pain|severe pain|agony)\b|can'?t (?:walk|stand|move)[^.!?\n]{0,20}pain/i;
const HIGH_PAIN = 7;

export const RED_FLAG_REPLY =
  "Please stop exercising for now. What you describe can need urgent care.\n" +
  "If you have chest pain, trouble breathing, or a calf that is suddenly swollen and painful, call 911 now.\n" +
  "Otherwise call Health811 (dial 811) or go to the nearest emergency department.\n" +
  "I have told your physiotherapist.";

/** Sent to the chat after a possible fall or a spoken call for help during a camera session. */
export const FALL_REPLY =
  "Your exercise session noticed what looked like a fall, or you asked for help.\n" +
  "If you are hurt or cannot get up, call 911 now.\n" +
  "I have told your physiotherapist.";

export const HIGH_PAIN_REPLY =
  "Thank you for telling me. Please stop today's exercises.\n" +
  "I have told your physiotherapist so they can contact you.\n" +
  "If the pain gets worse, or comes with swelling, redness, fever or trouble breathing, call Health811 (dial 811) " +
  "or go to the nearest emergency department. In an emergency, call 911.";

/** The pain score the patient mentioned last (so "from 8/10 to 3/10" reads as 3), or null. */
export function painScore(text: string): number | null {
  let best: { index: number; score: number } | null = null;
  for (const pattern of SCORE_PATTERNS) {
    for (const m of text.matchAll(pattern)) {
      const score = Number(m[1]);
      if (score > 10 || m.index === undefined) continue;
      const index = m.index + m[0].indexOf(m[1]);
      if (!best || index > best.index) best = { index, score };
    }
  }
  if (!best) return null;
  // Once the message is clearly about pain, a later "N/10" continues the same story: "from 8/10 to 3/10" means 3.
  for (const m of text.matchAll(new RegExp(SCORE, "gi"))) {
    const score = Number(m[1]);
    const index = (m.index ?? 0) + m[0].indexOf(m[1]);
    if (score <= 10 && index > best.index) best = { index, score };
  }
  return best.score;
}

export function assessMessage(text: string): SafetyResult {
  for (const [pattern, reason] of RED_FLAGS) {
    if (pattern.test(text)) {
      return {
        level: "red_flag",
        score: painScore(text),
        reason,
        reply: RED_FLAG_REPLY,
      };
    }
  }
  const score = painScore(text);
  if ((score !== null && score >= HIGH_PAIN) || SEVERE_WORDS.test(text)) {
    return {
      level: "high_pain",
      score,
      reason: score !== null ? `pain ${score}/10` : "severe pain",
      reply: HIGH_PAIN_REPLY,
    };
  }
  return null;
}
