// What the coach said in the last few seconds. The microphone hears the coach too; instead of ignoring everything
// while the coach talks (which ignored the patient during every count), the coach's own words are removed from what
// was heard, and whatever is left is the patient. Tested in scripts/fall.test.ts.

const recentSaid: { words: Set<string>; at: number }[] = [];
const wordsOf = (text: string) => text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);

export function rememberSaid(text: string, at = Date.now()): void {
  recentSaid.push({ words: new Set(wordsOf(text)), at });
  while (recentSaid.length > 12) recentSaid.shift();
}

/** The heard text without the words the coach said in the last 8 seconds. */
export function withoutEcho(heard: string, now = Date.now()): string {
  const recent = new Set(recentSaid.filter((r) => now - r.at < 8000).flatMap((r) => [...r.words]));
  return wordsOf(heard).filter((w) => !recent.has(w)).join(" ");
}
