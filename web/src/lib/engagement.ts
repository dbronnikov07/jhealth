// Keeping people going: streaks, milestones, reminders and nudges. Pure functions (no database, no network), so
// every message a patient can receive from here is unit-tested (scripts/engagement.test.ts).
//
// Tone rules for everything in this file (they match the AI coach's rules):
//   - celebrate effort and small wins, never scold; a missed day is "no worries", never "you failed";
//   - one short idea per message, plain words, at most one emoji;
//   - always say what to do next ("Tap Start when you're ready"), and that the physiotherapist can see progress;
//   - use the patient's own goal when we know it ("closer to walking the dog") — goals keep people going.
// Wording is a DRAFT for the demo; a physiotherapist should review it before real patients use it.

/** Consecutive days with at least one session, ending today or yesterday (a streak survives until tonight). */
export function currentStreak(sessionDays: string[], today: string): number {
  const days = new Set(sessionDays);
  const step = (d: string, n: number) => {
    const t = new Date(`${d}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() + n);
    return t.toISOString().slice(0, 10);
  };
  let day = days.has(today) ? today : step(today, -1);
  let streak = 0;
  while (days.has(day)) {
    streak++;
    day = step(day, -1);
  }
  return streak;
}

export type SessionFacts = {
  firstName: string;
  totalSessions: number;          // including the one just finished
  streak: number;                 // including today
  streakBefore: number;           // the streak before this session (to know if today extended it)
  measureLabel: string | null;    // "deepest knee bend", "highest arm angle", ...
  measure: number | null;         // this session's best, degrees
  previousBest: number | null;    // best before this session, same exercise
  firstMeasure: number | null;    // the first session's value, same exercise
  quality: number | null;         // 0..1
  previousBestQuality: number | null;
};

/** "This week: 2 of 5 planned days" after a session, and a cheer when the weekly goal is reached today. */
export function weeklyLine(daysThisWeek: number, planned: number, reachedToday: boolean): string {
  if (planned <= 0) return "";
  if (reachedToday && daysThisWeek >= planned) return `Weekly goal reached: ${daysThisWeek} of ${planned} days! 🎉`;
  return `This week: ${Math.min(daysThisWeek, 7)} of ${planned} planned days.`;
}

/** At most two short celebration lines after a session, biggest news first. */
export function celebrations(f: SessionFacts): string[] {
  const out: string[] = [];
  if (f.totalSessions === 1) out.push("Your first session is done. That's the hardest one! 🎉");
  const streakMarks = [3, 5, 7, 14, 21, 30];
  if (f.streak > f.streakBefore && streakMarks.includes(f.streak)) out.push(`${f.streak} days in a row. Wonderful consistency! 🔥`);
  const totalMarks = [5, 10, 25, 50, 100];
  if (totalMarks.includes(f.totalSessions)) out.push(`That's ${f.totalSessions} sessions so far. Every one counts.`);
  if (f.measure !== null && f.previousBest !== null && f.measure >= f.previousBest + 2 && f.measureLabel) {
    out.push(`New personal best: ${Math.round(f.measure)}° ${f.measureLabel}!`);
  } else if (f.measure !== null && f.firstMeasure !== null && f.measure - f.firstMeasure >= 5 && f.measureLabel && f.totalSessions % 5 === 0) {
    out.push(`Since your first session, your ${f.measureLabel} has improved by ${Math.round(f.measure - f.firstMeasure)}°.`);
  }
  if (f.quality !== null && f.previousBestQuality !== null && f.quality >= 0.8 && f.quality > f.previousBestQuality + 0.03) {
    out.push(`Your smoothest session yet (${Math.round(f.quality * 100)}/100).`);
  }
  return out.slice(0, 2);
}

export type ReminderKind = "reminder" | "comeback" | "weekly";

export type ReminderContext = {
  firstName: string;
  goal: string | null;            // the coach's saved goal, e.g. "Wants to walk the dog around the block again"
  exercises: string[];            // today's plan, names
  streak: number;                 // current streak (sessions up to yesterday)
  daysSinceLastSession: number | null;
  dayNumber: number;              // days since the epoch, to vary the wording from day to day
};

/** "Wants to walk the dog around the block again" -> "walking the dog around the block again". */
export function goalPhrase(goal: string | null): string | null {
  if (!goal) return null;
  const g = goal.trim().replace(/\.$/, "");
  const m = g.match(/^(?:wants|hopes|would like|wishes|aims)\s+to\s+(.+)$/i);
  if (!m) return null;
  const [verb, ...rest] = m[1].split(" ");
  const ing = verb.endsWith("e") && !verb.endsWith("ee") ? verb.slice(0, -1) + "ing"
    : /^(get|run|swim|sit|stop|jog)$/i.test(verb) ? verb + verb.slice(-1) + "ing" : verb + "ing";
  return [ing.toLowerCase(), ...rest].join(" ");
}

const pick = <T,>(items: T[], n: number) => items[((n % items.length) + items.length) % items.length];

/** Which message a patient gets today, or null for none. */
export function reminderKind(c: { daysSinceLastSession: number | null; sessionToday: boolean; weekday: number }): ReminderKind | null {
  if (c.sessionToday) return null;
  if (c.daysSinceLastSession !== null && c.daysSinceLastSession >= 3) return "comeback";
  if (c.weekday === 0 && c.daysSinceLastSession !== null) return "weekly"; // Sunday
  return "reminder";
}

export function reminderText(kind: ReminderKind, c: ReminderContext, week?: { sessions: number; planned: number; best: string | null }): string {
  const goal = goalPhrase(c.goal);
  const plan = c.exercises.length ? `${c.exercises.length} short exercise${c.exercises.length === 1 ? "" : "s"}` : "your exercises";
  if (kind === "comeback") {
    return pick([
      `Hi ${c.firstName}, no worries about the last few days. Life gets busy, and a short session still counts.`,
      `Hi ${c.firstName}! Good to check in. Today is a great day to pick it up again, even with just a few reps.`,
    ], c.dayNumber) + (goal ? ` You're working towards ${goal}.` : "") + " What got in the way? Tap below.";
  }
  if (kind === "weekly") {
    const w = week ?? { sessions: 0, planned: 0, best: null };
    return `Your week, ${c.firstName}: ${w.sessions} of ${w.planned} planned days done` +
      (w.best ? `, and ${w.best}` : "") + ". " +
      (w.sessions >= w.planned && w.planned > 0 ? "A full week, brilliant! " : "Thank you for showing up. ") +
      "Your physiotherapist can see your progress. Ready for a fresh week?";
  }
  const streakLine = c.streak >= 2 ? ` You're on a ${c.streak}-day streak. Let's keep it going! 🔥` : "";
  const opener = pick([
    `Hi ${c.firstName}! Time for today's ${plan}.`,
    `Good to see you, ${c.firstName}. Today's ${plan} take about 10 minutes.`,
    `Hi ${c.firstName}, today's ${plan} are ready. Your future self will thank you.`,
  ], c.dayNumber);
  const why = goal ? ` Every session brings you closer to ${goal}.` : "";
  return `${opener}${streakLine}${why} Tap Start when you're ready.`;
}
