// The microphone can pick up the coach's own voice. The browser's echo cancellation removes almost all of it; this is
// the second guard: a sentence heard WHILE the coach was talking, made up mostly of words the coach just said, is the
// coach, not the patient. Anything said while the coach was silent is always the patient, even if it repeats the
// coach's words ("How are you?" answered with "Hi, how are you?"). Tested in scripts/fall.test.ts.

const recentSaid: { words: Set<string>; at: number }[] = [];
const NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen", "twenty"];
const wordsOf = (text: string) => text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean)
  .map((w) => (/^\d+$/.test(w) && Number(w) <= 20 ? NUMBER_WORDS[Number(w)] : w));       // "7" and "seven" are the same word

export function rememberSaid(text: string, at = Date.now()): void {
  recentSaid.push({ words: new Set(wordsOf(text)), at });
  while (recentSaid.length > 12) recentSaid.shift();
}

/** Are at least 70% of the heard words ones the coach said in the last 8 seconds? */
export function isEcho(heard: string, now = Date.now()): boolean {
  const recent = new Set(recentSaid.filter((r) => now - r.at < 8000).flatMap((r) => [...r.words]));
  const words = wordsOf(heard);
  if (!words.length) return true;
  return words.filter((w) => recent.has(w)).length / words.length >= 0.7;
}

/** What Whisper tends to write for a cough or a short noise. Dropped when the sound was short. */
export function looksLikeNoise(heard: string, seconds: number): boolean {
  const t = wordsOf(heard).join(" ");
  return seconds < 1.3 && ["you", "thank you", "thanks", "thanks for watching", "bye", "so", "oh", "the", "i"].includes(t);
}

const QUESTION_START = /^(so |and |but |ok |okay |hey |hi |hello |well |um |uh )*(what|how|why|when|where|who|which|can|could|should|would|will|do|does|did|is|are|am|was|were|may|shall|have|has)\b/;
const TO_THE_COACH = new RegExp("\\b(" + [
  "coach", "couch", "motiva", "you", "your",                                             // talking to it
  "tell me", "show me", "help me", "explain", "repeat", "say (that|it) again", "one more time", "count",
  "let's (start|go|begin|do|continue|stop)", "lets (start|go|begin|do|continue|stop)", "start", "stop", "next",
  "i'm (ready|done|tired|finished|back|good|fine|okay|ok|not|sore)", "i am (ready|done|tired|finished|back|good|fine|okay|ok|not|sore)",
  "i feel", "i can't", "i cannot", "i don't understand", "i need", "i want", "i did", "i think i",
  "thanks", "thank you",
  // what a session is about
  "reps?", "repetitions?", "squats?", "sit", "stand", "standing", "exercises?", "knees?", "hips?", "legs?", "back", "form", "counted", "counts?",
  "sets?", "deeper", "lower", "slower", "faster", "camera", "weather", "time", "pain", "hurts?", "tired", "break", "rest", "chair",
].join("|") + ")\\b");

/**
 * Is this sentence meant for the coach? The microphone hears the whole room: a friend talking, a video, someone on
 * the phone. In a live session on 20 November the coach answered all of it ("Roma cannot touch me." got "I am not
 * sure who Roma is, but let's focus on your knees"), talking over the patient. It now answers:
 *   - anything, right after the Talk button or when it has just asked a question itself;
 *   - a question ("can you hear me?", "how many are left");
 *   - a sentence that speaks to it or about the session ("coach, ...", "I'm ready", "that was a deep one", "my knee").
 * Everything else is shown on screen as heard and left alone.
 */
export function meantForCoach(heard: string, o: { justAsked: boolean; talkButton: boolean }): boolean {
  if (o.justAsked || o.talkButton) return true;
  const t = heard.toLowerCase().replace(/[’`]/g, "'").replace(/[^a-z0-9'? ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return false;
  if (t.endsWith("?") || QUESTION_START.test(t)) return true;
  return TO_THE_COACH.test(t);
}
