// The camera exercises (three in the demo; seated knee extension is kept for old data but is self-reported now):
// how a repetition is counted, what is shown and stored, and which plain rules name
// a mistake. Same definitions as ml/exercises.py (keep them in step).
//
// Every exercise is counted by the same RepCounter: a repetition is a DIP in one "rep signal".
//   squat, sit_to_stand      knee angle (both knees)                 standing ~170 -> dip
//   seated_knee_extension    360 - the straighter knee's angle       sitting ~270 -> straight leg ~190
//   arm_raise                180 - the higher arm's shoulder angle   arm down ~165 -> arm up ~60
//
// The rules assume the camera sees the whole body. Thresholds are first guesses from the public data and
// physiotherapy guidance; tune them on your own clips (ml/train_own.py prints suggestions).
import { jointAngle, type Frame, type Vec } from "./features.ts";
import { DEFAULT_REP_OPTIONS, type CompletedRep, type RepCounterOptions } from "./reps.ts";

export type Fault =
  | "knees_in" | "not_deep" | "not_upright" | "too_fast" | "sit_slowly" | "uses_hands"
  | "not_straight" | "no_hold" | "lean_back"
  | "not_high" | "bent_elbow" | "body_sway"
  | "steady";

export const CUE: Record<Fault, string> = {
  knees_in: "Knees out, over your toes",
  not_deep: "A little deeper, if it's comfortable",
  not_upright: "Stand up tall at the top",
  too_fast: "A little slower",
  sit_slowly: "Sit down slowly, with control",
  uses_hands: "Cross your arms, and stand up without pushing",
  not_straight: "Straighten your knee a bit more",
  no_hold: "Hold it straight for two seconds",
  lean_back: "Sit tall, don't lean back",
  not_high: "Lift a little higher, to shoulder height",
  bent_elbow: "Keep your arm straight",
  body_sway: "Keep your body still",
  steady: "Nice effort. Make the next one slow and steady",
};

/**
 * The rules name a mistake when they see one. When they see none but the trained model is confident something was
 * off (p(mistake) at or above the model's flag_threshold, chosen in ml/operating_point.py so that about 9 in 10 such
 * flags are real), the app gives a gentle, general cue instead of a wrong specific one.
 */
export function withModelFlag(fault: Fault | null, pMistake: number | null, flagThreshold: number | undefined): Fault | null {
  if (fault || pMistake === null || flagThreshold === undefined) return fault;
  return pMistake >= flagThreshold ? "steady" : null;
}

const knees = (f: Frame) => [jointAngle(f, 23, 25, 27), jointAngle(f, 24, 26, 28)];
const shoulders = (f: Frame) => [jointAngle(f, 23, 11, 13), jointAngle(f, 24, 12, 14)];
const elbows = (f: Frame) => [jointAngle(f, 11, 13, 15), jointAngle(f, 12, 14, 16)];

/** Knee distance divided by ankle distance, side to side. Below KNEES_IN_RATIO, the knees cave inwards. */
export const KNEES_IN_RATIO = 0.8;
export function kneesInRatio(f: Frame): number {
  return Math.abs(f[25][0] - f[26][0]) / (Math.abs(f[27][0] - f[28][0]) + 1e-9);
}

/**
 * How squarely the person faces the camera: 1 = front on, 0 = side on (the sideways share of the shoulder line).
 * Knees caving in can only be seen from the front. Side on, both knees and both ankles sit on one line, the ratio
 * above is noise, and on phone squat footage the rule then objected to up to half of the CORRECT repetitions
 * (REHAB26, views of 80 to 90 degrees). At FACING_MIN it stays silent from about 60 degrees to the side onwards.
 */
export const FACING_MIN = 0.6;
export function facingCamera(f: Frame): number {
  const dx = f[11][0] - f[12][0];
  return Math.abs(dx) / (Math.hypot(dx, f[11][1] - f[12][1], f[11][2] - f[12][2]) + 1e-9);
}
const kneesCaving = (f: Frame) => facingCamera(f) >= FACING_MIN && kneesInRatio(f) < KNEES_IN_RATIO;

/**
 * "Stand up tall": the knee angle at the top below which the app says so. A standing person's knee measures 150 to
 * 160 degrees from a single camera, not 180. The old line of 155 objected to 47% of correct sit-to-stand clips
 * filmed in real homes (WLU, 79 clips) and to 17% of correct phone squats (REHAB26); 145 objects to 1% and 4%.
 * Measured in ml/wlu_sit_to_stand.py, written up in docs/ML_RESULTS.md.
 */
export const UPRIGHT_KNEE = 145;

/** Trunk angle from vertical (degrees), forward/back and sideways together. */
export function trunkLean(f: Frame): number {
  const midSh: Vec = [(f[11][0] + f[12][0]) / 2, (f[11][1] + f[12][1]) / 2, (f[11][2] + f[12][2]) / 2];
  const midHip: Vec = [(f[23][0] + f[24][0]) / 2, (f[23][1] + f[24][1]) / 2, (f[23][2] + f[24][2]) / 2];
  const v: Vec = [midSh[0] - midHip[0], midSh[1] - midHip[1], midSh[2] - midHip[2]];
  const l = Math.hypot(v[0], v[1], v[2]) + 1e-9;
  return (Math.acos(Math.min(1, Math.max(-1, -v[1] / l))) * 180) / Math.PI;
}

export type RepContext = {
  rep: CompletedRep;
  frames: Frame[];          // the repetition's frames, padding included
  times: number[];          // seconds, same length as frames
  liveFlags: boolean[];     // the exercise's live warning per frame (knees in), same length
};

export type ExerciseProfile = {
  id: string;
  /** Share of the push with the hands low or on a leg (exercises where pushing up with the hands does not count). */
  handsShare?(c: RepContext): number;
  repSignal(f: Frame): number;
  counter: RepCounterOptions;
  /** Shown live under the video. */
  liveLabel: string;
  liveValue(f: Frame): number;
  /** One number per repetition, stored with the session (degrees). */
  repMeasure(rep: CompletedRep): number;
  measureLabel: string;
  /** Stored as knee_bend_deg (knee-bend exercises) or rom_deg (range of motion: extension, arm height). */
  measureColumn: "knee_bend_deg" | "rom_deg";
  /** A live warning drawn on the skeleton and spoken at once (only squat-like exercises have one). */
  liveWarning?(f: Frame, isDown: boolean): boolean;
  liveWarningFault?: Fault;
  fault(c: RepContext): Fault | null;
  /**
   * A movement only counts as a repetition when repMeasure reaches this (degrees). Below it the app says it did not
   * count and why, instead of counting a little bob of the knees as a squat.
   */
  minCount: number;
  /** Said and shown when a movement did not count. */
  notCounted: string;
};

/** Does this finished movement count as a repetition? */
export function countsAsRep(profile: ExerciseProfile, rep: CompletedRep): boolean {
  return profile.repMeasure(rep) >= profile.minCount;
}

/** A squat that bends the knees less than this (degrees) gets "a little deeper". */
export const SQUAT_SHALLOW_BEND = 70;

const shareOf = (flags: boolean[]) => flags.filter(Boolean).length / Math.max(1, flags.length);

/** Seconds the signal spends within `band` degrees of the repetition's lowest point (the "hold"). */
function holdSeconds(c: RepContext, signal: (f: Frame) => number, band: number): number {
  const s = c.frames.map(signal);
  const low = Math.min(...s);
  let held = 0;
  for (let i = 1; i < s.length; i++) if (s[i] <= low + band && s[i - 1] <= low + band) held += c.times[i] - c.times[i - 1];
  return held;
}

/** Seconds from the lowest point of the rep signal back to the end of the moving part. */
function returnSeconds(c: RepContext, signal: (f: Frame) => number): number {
  const s = c.frames.map(signal);
  let v = 0;
  for (let i = 1; i < s.length; i++) if (s[i] < s[v]) v = i;
  const top = Math.max(s[0], s[s.length - 1]);
  const thr = s[v] + 0.9 * (top - s[v]);
  let e = v;
  while (e < s.length - 1 && s[e] < thr) e++;
  return c.times[e] - c.times[v];
}

const kneeBoth = (f: Frame) => (knees(f)[0] + knees(f)[1]) / 2;

/**
 * Thigh angle from straight down (degrees), both legs averaged: about 7 standing and 71 sitting on a chair (medians
 * over 127 home sit-to-stand clips, WLU). It needs only hips and knees, so it keeps working when the chair hides the
 * shins or the frame cuts off the feet; the knee angle did not (a laptop session counted 4 of about 15 stands and
 * called 3 of them "not upright").
 */
export function thighTilt(f: Frame): number {
  let sum = 0;
  for (const [hip, knee] of [[23, 25], [24, 26]] as const) {
    const v: Vec = [f[knee][0] - f[hip][0], f[knee][1] - f[hip][1], f[knee][2] - f[hip][2]];
    const l = Math.hypot(v[0], v[1], v[2]) + 1e-9;
    sum += (Math.acos(Math.min(1, Math.max(-1, v[1] / l))) * 180) / Math.PI;     // world y points down
  }
  return sum / 2;
}
const thighSignal = (f: Frame) => 180 - thighTilt(f);     // dips when sitting down, like the knee angle did

/**
 * Hands low: the higher wrist is below chest height. Arms crossed put both wrists at the chest (about 0.6 torso
 * lengths above the hips); reaching forward, higher still. Hands on the thighs or knees sit at about hip height, and
 * hanging arms below it. Measured on 44 correct sit-to-stands filmed in real homes (WLU), where nearly everyone had
 * their hands on their thighs: the higher wrist sat 0.14 torso lengths above the hips (10th percentile 0.18), and
 * 0.12 m from the thigh. The first line, 0.1, let all of those through (seven pushed-up stands were counted on
 * 20 November). At 0.3 they are caught, and arms crossed on the chest (about 0.6) are not.
 */
export const HANDS_LOW_RATIO = -0.3;
function handsLow(f: Frame): boolean {
  const hipY = (f[23][1] + f[24][1]) / 2;
  const torso = Math.hypot((f[11][0] + f[12][0] - f[23][0] - f[24][0]) / 2, (f[11][1] + f[12][1] - f[23][1] - f[24][1]) / 2,
    (f[11][2] + f[12][2] - f[23][2] - f[24][2]) / 2) + 1e-9;
  return (Math.min(f[15][1], f[16][1]) - hipY) / torso > HANDS_LOW_RATIO;
}

/** Distance from a point to the segment a-b, in the landmarks' own units (metres). */
function toSegment(p: Vec, a: Vec, b: Vec): number {
  const ab: Vec = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap: Vec = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const t = Math.min(1, Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / (ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] + 1e-9)));
  return Math.hypot(ap[0] - t * ab[0], ap[1] - t * ab[1], ap[2] - t * ab[2]);
}

/** A hand on a leg: either wrist within this distance (metres) of either thigh, hip to knee. */
export const HAND_ON_LEG_M = 0.15;
function handOnLeg(f: Frame): boolean {
  const hipY = (f[23][1] + f[24][1]) / 2;
  const torso = Math.hypot((f[11][0] + f[12][0] - f[23][0] - f[24][0]) / 2, (f[11][1] + f[12][1] - f[23][1] - f[24][1]) / 2,
    (f[11][2] + f[12][2] - f[23][2] - f[24][2]) / 2) + 1e-9;
  // Near a thigh AND below the chest: arms crossed on the chest come close to the thighs in a deep forward lean.
  return [f[15], f[16]].some((w) => (w[1] - hipY) / torso > -0.45
    && (toSegment(w, f[23], f[25]) < HAND_ON_LEG_M || toSegment(w, f[24], f[26]) < HAND_ON_LEG_M));
}

/**
 * Arms crossed (or hands together in front): the wrists have met or swapped sides, measured along the shoulder line
 * (the left wrist is no longer clearly left of the right one). Hands that push sit on their own side: on the thighs,
 * the knees, the seat or the armrests. This does not depend on how far the body leans, which the height rules do: in
 * the forward lean of standing up, the chest comes down over the thighs, so arms crossed on the chest looked "low"
 * and "near a thigh" and honest repetitions were refused (live session, 20 November: 3 of about 15 counted).
 */
export function armsCrossed(f: Frame): boolean {
  const u: Vec = [f[12][0] - f[11][0], f[12][1] - f[11][1], f[12][2] - f[11][2]];     // left shoulder to right shoulder
  const width2 = u[0] * u[0] + u[1] * u[1] + u[2] * u[2] + 1e-9;
  const along = (w: Vec) => ((w[0] - f[11][0]) * u[0] + (w[1] - f[11][1]) * u[1] + (w[2] - f[11][2]) * u[2]) / width2;   // 0 = left shoulder, 1 = right
  return along(f[15]) - along(f[16]) > -0.15;
}

/**
 * Share of the push (from the lowest point until four fifths of the way back up) during which the hands are low or
 * on a leg, and not crossed. The push is where the hands help; the moment after standing up says nothing.
 */
export function handsShare(c: RepContext, signal: (f: Frame) => number): number {
  const s = c.frames.map(signal);
  let v = 0;
  for (let i = 1; i < s.length; i++) if (s[i] < s[v]) v = i;
  const top = Math.max(s[0], s[s.length - 1]);
  const upTo = s[v] + 0.8 * (top - s[v]);
  let e = v;
  while (e < s.length - 1 && s[e] < upTo) e++;
  const push = c.frames.slice(v, Math.max(e, v + 2) + 1);
  return push.filter((f) => !armsCrossed(f) && (handsLow(f) || handOnLeg(f))).length / Math.max(1, push.length);
}

/** At or above this share of the push with the hands low or on a leg, the repetition was pushed up. */
export const HANDS_SHARE = 0.5;

/** Was this repetition pushed up with the hands? Standing up should be done by the legs. It does not count. */
function pushedWithHands(c: RepContext, signal: (f: Frame) => number): boolean {
  return handsShare(c, signal) >= HANDS_SHARE;
}

/** A repetition with one of these mistakes is shown and named, but not counted. */
export const NOT_COUNTED_FAULTS: Fault[] = ["uses_hands"];
export const HANDS_NOT_COUNTED = "That one didn't count. Hands off your legs: cross your arms.";

/** What the camera checks on every repetition, in the order shown on screen. `fails` are the mistakes that turn it red. */
export const CHECKS: Record<string, { label: string; fails: Fault[] }[]> = {
  squat: [
    { label: "Depth", fails: ["not_deep"] },
    { label: "Knees out", fails: ["knees_in"] },
    { label: "No hands", fails: ["uses_hands"] },
    { label: "Stand tall", fails: ["not_upright"] },
    { label: "Tempo", fails: ["too_fast", "steady"] },
  ],
  sit_to_stand: [
    { label: "Full sit", fails: [] },
    { label: "Knees out", fails: ["knees_in"] },
    { label: "No hands", fails: ["uses_hands"] },
    { label: "Stand tall", fails: ["not_upright"] },
    { label: "Slow down", fails: ["sit_slowly", "too_fast", "steady"] },
  ],
  arm_raise: [
    { label: "Height", fails: ["not_high"] },
    { label: "Straight arm", fails: ["bent_elbow"] },
    { label: "Still body", fails: ["body_sway"] },
    { label: "Tempo", fails: ["too_fast", "steady"] },
  ],
};

/** A standing thigh more than this far from vertical (degrees) at the top of a sit-to-stand: not fully up. */
export const UPRIGHT_THIGH = 25;
const kneeStraighter = (f: Frame) => 360 - Math.max(...knees(f));
const armHigher = (f: Frame) => 180 - Math.max(...shoulders(f));

export const EXERCISES: Record<string, ExerciseProfile> = {
  squat: {
    id: "squat",
    repSignal: kneeBoth,
    counter: { ...DEFAULT_REP_OPTIONS, minDepth: 15 },
    handsShare: (c) => handsShare(c, kneeBoth),
    liveLabel: "Knee bend",
    liveValue: (f) => Math.max(0, 180 - kneeBoth(f)),
    repMeasure: (r) => 180 - r.minKnee,
    measureLabel: "deepest knee bend",
    measureColumn: "knee_bend_deg",
    liveWarning: (f, isDown) => isDown && kneeBoth(f) < 150 && kneesCaving(f),
    liveWarningFault: "knees_in",
    fault: (c) => {
      if (pushedWithHands(c, kneeBoth)) return "uses_hands";
      if (shareOf(c.liveFlags) >= 0.25) return "knees_in";
      // The live goal is 70 degrees of knee bend (lib/pose/live.ts); more than 10 short of it is called out.
      if (180 - c.rep.minKnee < SQUAT_SHALLOW_BEND) return "not_deep";
      if (c.rep.topKnee < UPRIGHT_KNEE) return "not_upright";
      if (c.rep.activeSeconds < 1.2) return "too_fast";
      return null;
    },
    // Correct squats in the public data reach a knee angle of 87 (fixed camera) to 109 degrees (phones), a bend of
    // 70 to 90. Under 65 degrees of bend (a dip, a wiggle of the hips) it is not a chair squat, so it does not count.
    minCount: 65,
    notCounted: "That one didn't count. Go lower, sit back toward the chair.",
  },
  sit_to_stand: {
    id: "sit_to_stand",
    // Counted on the thigh angle (thighTilt), not the knee: see there for why.
    repSignal: thighSignal,
    counter: { ...DEFAULT_REP_OPTIONS, minDepth: 30 },
    handsShare: (c) => handsShare(c, thighSignal),
    liveLabel: "Hip bend",
    liveValue: (f) => Math.max(0, Math.round(thighTilt(f))),
    repMeasure: (r) => 180 - r.minKnee,                          // the deepest thigh angle: how far down they sat
    measureLabel: "deepest sit (thigh angle)",
    measureColumn: "knee_bend_deg",
    liveWarning: (f, isDown) => isDown && kneeBoth(f) < 150 && kneesCaving(f),
    liveWarningFault: "knees_in",
    fault: (c) => {
      // The instructions say arms crossed. Hands down at the hips or lower for most of the stand-up means pushing
      // up on the thighs or the chair (or just not crossing them, which gets the same answer): it does not count.
      if (pushedWithHands(c, thighSignal)) return "uses_hands";
      if (shareOf(c.liveFlags) >= 0.25) return "knees_in";
      const s = c.frames.map(thighSignal);
      let v = 0;
      for (let i = 1; i < s.length; i++) if (s[i] < s[v]) v = i;
      if (180 - c.rep.topKnee > UPRIGHT_THIGH) return "not_upright";
      // Sitting down is the half people rush: the lowering phase should take about a second or more.
      let top = 0;
      for (let i = 1; i < v; i++) if (s[i] > s[top]) top = i;
      if (c.times[v] - c.times[top] < 0.8) return "sit_slowly";
      if (c.rep.activeSeconds < 1.5) return "too_fast";
      return null;
    },
    // Sitting on a chair puts the thighs at about 71 degrees (WLU; 10th percentile 62). Under 58 they never sat down.
    minCount: 58,
    notCounted: "That one didn't count. Sit all the way down, then stand up.",
  },
  seated_knee_extension: {
    id: "seated_knee_extension",
    repSignal: kneeStraighter,
    counter: { ...DEFAULT_REP_OPTIONS, minDepth: 25, settleSeconds: 0.4 },
    liveLabel: "Knee straight",
    liveValue: (f) => Math.round(Math.max(...knees(f))),
    repMeasure: (r) => Math.min(180, 360 - r.minKnee),          // the straightest the knee got
    measureLabel: "straightest knee angle",
    measureColumn: "rom_deg",
    fault: (c) => {
      if (360 - c.rep.minKnee < 150) return "not_straight";
      const lean = c.frames.map(trunkLean);
      if (Math.max(...lean) - lean[0] > 15) return "lean_back";
      if (holdSeconds(c, kneeStraighter, 8) < 1.0) return "no_hold";
      if (returnSeconds(c, kneeStraighter) < 0.8) return "too_fast";
      return null;
    },
    minCount: 120,
    notCounted: "That one didn't count. Straighten your knee further.",
  },
  arm_raise: {
    id: "arm_raise",
    repSignal: armHigher,
    counter: { ...DEFAULT_REP_OPTIONS, minDepth: 40, settleSeconds: 0.4 },
    liveLabel: "Arm height",
    liveValue: (f) => Math.round(Math.max(...shoulders(f))),
    repMeasure: (r) => Math.min(180, 180 - r.minKnee),          // the highest the arm got (shoulder angle)
    measureLabel: "highest arm angle",
    measureColumn: "rom_deg",
    fault: (c) => {
      if (180 - c.rep.minKnee < 75) return "not_high";
      // the working arm at its highest point
      const s = c.frames.map(armHigher);
      let v = 0;
      for (let i = 1; i < s.length; i++) if (s[i] < s[v]) v = i;
      const sh = shoulders(c.frames[v]);
      const el = elbows(c.frames[v]);
      if (el[sh[0] >= sh[1] ? 0 : 1] < 145) return "bent_elbow";
      const lean = c.frames.map(trunkLean);
      if (Math.max(...lean) - Math.min(...lean) > 12) return "body_sway";
      if (c.rep.activeSeconds < 1.2) return "too_fast";
      return null;
    },
    // Shoulder height is 90 degrees; "not high" is named under 75. Under 60 it is not an arm raise yet.
    minCount: 60,
    notCounted: "That one didn't count. Lift your arm higher, up to your shoulder.",
  },
};

/** The profile for an exercise id; exercises without their own profile are counted like a squat. */
export function profileFor(exerciseId: string): ExerciseProfile {
  return EXERCISES[exerciseId] ?? EXERCISES.squat;
}

/** Quality from the rules alone (for exercises without a trained model): 1 with no fault, lower with one. */
export function ruleQuality(fault: Fault | null): number {
  if (!fault) return 0.95;
  return fault === "too_fast" || fault === "no_hold" || fault === "sit_slowly" || fault === "steady" ? 0.7 : 0.55;
}
