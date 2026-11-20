// Recovery phases. Different operations heal at different rates, so there is no shared timeline and no dates:
// every patient sees the same four-step journey, but what it takes to finish a phase depends on their operation,
// and only their physiotherapist can move them on (a sign-off). The camera can show that a target is met; it can
// never unlock a phase by itself. Each new phase brings a clearance ("Clear to jog"), the milestone patients work
// towards.
//
// The criteria are examples drawn from common published rehab protocols, written in plain words. They are not a
// clinical protocol: the physiotherapist adapts them and decides.
// Pure TypeScript (no database), shared by the dashboard, the patient's page and the coach.

/** A target the camera can check from the last 7 days of sessions. Anything without one, the physio checks in person. */
export type Measure =
  | { kind: "bend"; min: number }      // deepest knee bend, degrees (squat, sit-to-stand)
  | { kind: "days"; min: number }      // days with a session in the last 7
  | { kind: "quality"; min: number };  // average rep quality, 0 to 100

export type Criterion = { text: string; measure?: Measure };

export type Phase = {
  name: string;
  /** What the patient earns on entering this phase. The first phase has none: it is where everyone starts. */
  clearance: string | null;
  /** What the physio looks for before signing this phase off. */
  criteria: Criterion[];
  /** Real-life wins a patient in this phase can tap to log. */
  wins: string[];
};

export type Protocol = { key: string; label: string; phases: [Phase, Phase, Phase, Phase]; done: string };

/** Phase numbers run 1 to 4; 5 means every phase is signed off. */
export const PHASES = 4;
export const DONE = PHASES + 1;

const TKR: Protocol = {
  key: "tkr",
  label: "Knee replacement",
  done: "Rehab complete",
  phases: [
    {
      name: "Protect and move",
      clearance: null,
      criteria: [
        { text: "Knee straightens fully" },
        { text: "Knee bends to 90°", measure: { kind: "bend", min: 90 } },
        { text: "Walks safely with a walker" },
        { text: "Swelling is settling" },
      ],
      wins: ["Walked to the kitchen on my own", "Slept through the night", "Got in and out of the car"],
    },
    {
      name: "Strength and walking",
      clearance: "Clear to walk with a cane",
      criteria: [
        { text: "Knee bends to 105°", measure: { kind: "bend", min: 105 } },
        { text: "Walks indoors without a cane" },
        { text: "Stands up from a chair without using hands" },
        { text: "Exercises 4 days a week", measure: { kind: "days", min: 4 } },
      ],
      wins: ["Walked around the block", "First full turn on an exercise bike", "Climbed the stairs at home"],
    },
    {
      name: "Everyday life",
      clearance: "Clear for walks outside",
      criteria: [
        { text: "Knee bends to 115°", measure: { kind: "bend", min: 115 } },
        { text: "Takes the stairs one foot per step" },
        { text: "Walks 30 minutes without a limp" },
        { text: "Stands on the operated leg for 10 seconds" },
      ],
      wins: ["Walked to the shops", "Played with the grandkids", "Gardened for 20 minutes"],
    },
    {
      name: "Back to activity",
      clearance: "Clear for cycling and swimming",
      criteria: [
        { text: "Rep quality 80/100 or more", measure: { kind: "quality", min: 80 } },
        { text: "Leg strength close to the other side" },
        { text: "Back to the activities they care about" },
      ],
      wins: ["Rode a bike outside", "Swam a few lengths", "Danced at a party"],
    },
  ],
};

const THR: Protocol = {
  key: "thr",
  label: "Hip replacement",
  done: "Rehab complete",
  phases: [
    {
      name: "Protect and move",
      clearance: null,
      criteria: [
        { text: "Follows the hip precautions" },
        { text: "Walks safely with a walker" },
        { text: "Gets in and out of bed on their own" },
        { text: "Stands up from a chair using the armrests" },
      ],
      wins: ["Got out of bed on my own", "Walked to the kitchen on my own", "Showered on my own"],
    },
    {
      name: "Strength and walking",
      clearance: "Clear to walk with a cane",
      criteria: [
        { text: "Walks indoors without a cane" },
        { text: "Stands up from a chair without using hands" },
        { text: "Lifts the leg to the side without leaning" },
        { text: "Exercises 4 days a week", measure: { kind: "days", min: 4 } },
      ],
      wins: ["Walked around the block", "Climbed the stairs at home", "Cooked a meal standing up"],
    },
    {
      name: "Everyday life",
      clearance: "Clear for walks outside",
      criteria: [
        { text: "Walks 30 minutes without a limp" },
        { text: "Takes the stairs one foot per step" },
        { text: "Puts on socks and shoes" },
        { text: "Stands on the operated leg for 10 seconds" },
      ],
      wins: ["Put my socks on by myself", "Walked to the shops", "Gardened for 20 minutes"],
    },
    {
      name: "Back to activity",
      clearance: "Clear for cycling and swimming",
      criteria: [
        { text: "Rep quality 80/100 or more", measure: { kind: "quality", min: 80 } },
        { text: "Hip strength close to the other side" },
        { text: "Back to the activities they care about" },
      ],
      wins: ["Rode a bike outside", "Swam a few lengths", "Back on the golf course"],
    },
  ],
};

const ACL: Protocol = {
  key: "acl",
  label: "ACL reconstruction",
  done: "Clear to return to sport",
  phases: [
    {
      name: "Calm the knee",
      clearance: null,
      criteria: [
        { text: "Knee straightens fully" },
        { text: "Straight-leg raise with no lag" },
        { text: "Knee bends to 90°", measure: { kind: "bend", min: 90 } },
        { text: "Walks without crutches" },
      ],
      wins: ["Walked without crutches", "Slept through the night", "Lifted my straight leg"],
    },
    {
      name: "Build strength",
      clearance: "Clear for the exercise bike",
      criteria: [
        { text: "Knee bends to 120°", measure: { kind: "bend", min: 120 } },
        { text: "Squats to a chair with good form", measure: { kind: "quality", min: 75 } },
        { text: "Stands on one leg for 30 seconds" },
        { text: "No swelling after exercise" },
      ],
      wins: ["First full turn on an exercise bike", "Took the stairs normally", "Stood on one leg for 30 seconds"],
    },
    {
      name: "Running",
      clearance: "Clear to jog",
      criteria: [
        { text: "Jogs 10 minutes with no pain or swelling" },
        { text: "Single-leg squat with the knee in line" },
        { text: "Hop tests at 70% of the other leg" },
      ],
      wins: ["First jog", "Jogged 10 minutes", "Hopped on the operated leg"],
    },
    {
      name: "Return to sport",
      clearance: "Clear for agility drills",
      criteria: [
        { text: "Hop and strength tests at 90% of the other leg" },
        { text: "Lands and changes direction with control" },
        { text: "Feels confident on the knee" },
      ],
      wins: ["Back at team training", "First sprint", "Played a full game"],
    },
  ],
};

const KNEE_OA: Protocol = {
  key: "oa",
  label: "Osteoarthritis",
  done: "Graduated to the home program",
  phases: [
    {
      name: "Calm the joint",
      clearance: null,
      criteria: [
        { text: "Pain after exercise settles within a day" },
        { text: "Exercises 3 days a week", measure: { kind: "days", min: 3 } },
        { text: "Knows how to pace a flare-up" },
      ],
      wins: ["Walked to the mailbox without stopping", "Got up from the sofa easily", "Slept through the night"],
    },
    {
      name: "Build strength",
      clearance: "Clear for longer walks",
      criteria: [
        { text: "Stands up from a chair 10 times without hands" },
        { text: "Rep quality 70/100 or more", measure: { kind: "quality", min: 70 } },
        { text: "Walks 20 minutes" },
      ],
      wins: ["Walked around the block", "Climbed the stairs without the rail", "First full turn on an exercise bike"],
    },
    {
      name: "Everyday life",
      clearance: "Clear for cycling and swimming",
      criteria: [
        { text: "Takes the stairs one foot per step" },
        { text: "Walks 30 minutes" },
        { text: "Exercises 4 days a week", measure: { kind: "days", min: 4 } },
      ],
      wins: ["Walked to the shops", "Gardened for 20 minutes", "Swam a few lengths"],
    },
    {
      name: "Stay strong",
      clearance: "Clear for hiking and dancing",
      criteria: [
        { text: "Keeps exercising without reminders" },
        { text: "Knows what to do in a flare-up" },
      ],
      wins: ["Went on a hike", "Danced at a party", "Kept up my exercises on holiday"],
    },
  ],
};

const GENERAL: Protocol = {
  key: "general",
  label: "Rehab",
  done: "Rehab complete",
  phases: [
    {
      name: "Protect and move",
      clearance: null,
      criteria: [
        { text: "Pain is settling" },
        { text: "Exercises 3 days a week", measure: { kind: "days", min: 3 } },
        { text: "Moves safely around the home" },
      ],
      wins: ["Walked to the kitchen on my own", "Slept through the night", "Got dressed on my own"],
    },
    {
      name: "Build strength",
      clearance: "Clear for daily activities",
      criteria: [
        { text: "Rep quality 70/100 or more", measure: { kind: "quality", min: 70 } },
        { text: "Exercises 4 days a week", measure: { kind: "days", min: 4 } },
        { text: "Walks 20 minutes" },
      ],
      wins: ["Walked around the block", "Climbed the stairs at home", "Cooked a meal standing up"],
    },
    {
      name: "Everyday life",
      clearance: "Clear for longer walks",
      criteria: [
        { text: "Walks 30 minutes without pain" },
        { text: "Back to daily tasks" },
      ],
      wins: ["Walked to the shops", "Gardened for 20 minutes", "Played with the grandkids"],
    },
    {
      name: "Back to activity",
      clearance: "Clear for sport and hobbies",
      criteria: [
        { text: "Strength close to the other side" },
        { text: "Back to the activities they care about" },
      ],
      wins: ["Rode a bike outside", "Swam a few lengths", "Back to my hobby"],
    },
  ],
};

/** The protocol for a condition as typed on the patient record ("Total knee replacement", "ACL reconstruction"…). */
export function protocolFor(condition: string | null | undefined): Protocol {
  const c = (condition ?? "").toLowerCase();
  if (/\bacl\b|anterior cruciate/.test(c)) return ACL;
  if (/hip/.test(c) && /replace|arthroplasty|\bthr\b|\btha\b/.test(c)) return THR;
  if (/knee/.test(c) && /replace|arthroplasty|\btkr\b|\btka\b/.test(c)) return TKR;
  if (/\btkr\b|\btka\b/.test(c)) return TKR;
  if (/\bthr\b|\btha\b/.test(c)) return THR;
  if (/osteoarthritis|arthritis|\boa\b/.test(c)) return KNEE_OA;
  return GENERAL;
}

export const PROTOCOLS = [TKR, THR, ACL, KNEE_OA, GENERAL];

/** Keep a stored phase number inside 1..5. */
export function clampPhase(n: unknown): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.min(DONE, Math.max(1, v)) : 1;
}

/** The phase a number points at, or null once rehab is complete. */
export function phaseAt(p: Protocol, phase: number): Phase | null {
  return phase >= 1 && phase <= PHASES ? p.phases[phase - 1] : null;
}

/** What the physio would sign off next: the clearance the patient gets on moving on. */
export function nextClearance(p: Protocol, phase: number): string | null {
  if (phase >= DONE) return null;
  return phase === PHASES ? p.done : p.phases[phase].clearance;
}

/** Every clearance already earned, in order. */
export function earnedClearances(p: Protocol, phase: number): string[] {
  const out: string[] = [];
  for (let i = 2; i <= Math.min(phase, PHASES); i++) {
    const c = p.phases[i - 1].clearance;
    if (c) out.push(c);
  }
  if (phase >= DONE) out.push(p.done);
  return out;
}

export type Readings = { bend: number | null; days: number | null; quality: number | null };
export type CheckedCriterion = Criterion & { met: boolean | null; reading: string | null };

/** Each criterion with what the camera saw this week. met is null when only the physio can check it. */
export function checkCriteria(phase: Phase, r: Readings): CheckedCriterion[] {
  return phase.criteria.map((c) => {
    if (!c.measure) return { ...c, met: null, reading: null };
    const m = c.measure;
    const value = m.kind === "bend" ? r.bend : m.kind === "days" ? r.days : r.quality;
    if (value === null || value === undefined) return { ...c, met: false, reading: "not measured yet" };
    const reading = m.kind === "bend" ? `${Math.round(value)}°` : m.kind === "days" ? `${value} of 7 days` : `${Math.round(value)}/100`;
    return { ...c, met: value >= m.min, reading };
  });
}

/** True when the phase has camera targets and all of them are met: worth the physio's look. */
export function cameraTargetsMet(checked: CheckedCriterion[]): boolean {
  const measured = checked.filter((c) => c.met !== null);
  return measured.length > 0 && measured.every((c) => c.met);
}

/** The message the patient gets when their physio signs a phase off. Plain text, every channel. */
export function signOffMessage(p: Protocol, firstName: string, from: number, to: number): string {
  if (to < from) {
    const now = phaseAt(p, to);
    return `Hi ${firstName}, your physiotherapist has moved your plan back to phase ${to}${now ? `: ${now.name}` : ""}. ` +
      "That is normal in recovery: some weeks need a gentler step. Keep going, and tell me how it feels.";
  }
  const left = phaseAt(p, from);
  if (to >= DONE) {
    return `Congratulations ${firstName}! Your physiotherapist signed off the last phase${left ? ` (${left.name})` : ""}. ` +
      `${p.done}. Keep moving the way you have learned.`;
  }
  const next = phaseAt(p, to)!;
  const lines = [
    `Great news, ${firstName}! Your physiotherapist signed off phase ${from}${left ? ` (${left.name})` : ""}.`,
    next.clearance ? `Milestone reached: ${next.clearance.charAt(0).toLowerCase()}${next.clearance.slice(1)}.` : "",
    `You are now in phase ${to} of ${PHASES}: ${next.name}.`,
    "Every recovery moves at its own pace. Your physiotherapist decides when you are ready for the next step.",
  ];
  return lines.filter(Boolean).join("\n");
}

/** One line for the AI coach, so it can encourage the patient towards their next milestone without promising it. */
export function coachLine(p: Protocol, phase: number): string {
  const now = phaseAt(p, phase);
  if (!now) return `RECOVERY: all ${PHASES} phases signed off by their physiotherapist (${p.done}).`;
  const next = nextClearance(p, phase);
  return `RECOVERY: phase ${phase} of ${PHASES}, "${now.name}". Next milestone: ${next}. ` +
    "Only their physiotherapist decides when they move on: never promise or predict a date, never say they are cleared.";
}

export type SignOff = { at: Date; from: number; to: number; note: string | null };

/** Forward sign-offs that still stand: a later "move back" takes back the ones above where the patient now is. */
export function standingSignOffs(signoffs: SignOff[]): SignOff[] {
  const kept: SignOff[] = [];
  for (const s of [...signoffs].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (s.to > s.from) kept.push(s);
    else while (kept.length && kept[kept.length - 1].to > s.to) kept.pop();
  }
  return kept;
}
