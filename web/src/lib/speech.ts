/** Browser-native speech for the exercise coach.
 *
 * We deliberately do not send a patient's coaching text to a cloud TTS
 * provider.  The browser already has an on-device voice; this ranks the more
 * natural macOS/iOS voices first and otherwise preserves the user's system
 * voice.
 */
export type CoachVoice = Pick<SpeechSynthesisVoice, "name" | "lang" | "localService">;

const NATURAL_VOICE_NAMES = [
  "eddy", "flo", "reed", "sandy", "shelley", // current Apple neural voices
  "ava", "zoe", "allison", "nicky", "oliver", "daniel", "moira", "karen", "samantha",
];

/** Pick a local English voice without assuming a particular phone or laptop. */
export function coachVoice<T extends CoachVoice>(voices: T[]): T | null {
  const english = voices.filter((voice) => /^en(?:[-_]|$)/i.test(voice.lang));
  if (!english.length) return null;
  const score = (voice: CoachVoice) => {
    const name = voice.name.toLowerCase();
    // macOS names its current voices like "Eddy (English (US))"; iOS often
    // uses the bare name.  Recognise both without accidentally matching part
    // of an unrelated name.
    const named = NATURAL_VOICE_NAMES.findIndex((candidate) =>
      new RegExp(`^${candidate}(?:[\\s(]|$)`, "i").test(voice.name),
    );
    // A native voice is usually better than the small fallback Chrome voices.
    // Keep the user's Canadian English voice slightly ahead when no known
    // neural voice is present.
    return (named >= 0 ? 10_000 - named : 0)
      + (voice.localService ? 300 : 0)
      + (/^en[-_]ca/i.test(voice.lang) ? 80 : 0)
      + (/^en[-_](us|gb|au|nz)/i.test(voice.lang) ? 40 : 0)
      - (/(compact|google|microsoft)/i.test(name) ? 500 : 0);
  };
  return english.reduce((best, voice) => (score(voice) > score(best) ? voice : best));
}

/** Natural short phrases are easier to follow than isolated counted digits. */
export function repSpokenText(rep: number, fault: string | null, cue: string | null): string {
  if (fault && cue) return `Rep ${rep}. ${cue}.`;
  return rep === 1 ? "Nice. That's one." : `Nice. That's ${rep}.`;
}
