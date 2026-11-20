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
