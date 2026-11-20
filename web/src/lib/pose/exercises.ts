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
  | "knees_in" | "not_deep" | "not_upright" | "too_fast" | "sit_slowly"
  | "not_straight" | "no_hold" | "lean_back"
  | "not_high" | "bent_elbow" | "body_sway"
  | "steady";

export const CUE: Record<Fault, string> = {
  knees_in: "Knees out, over your toes",
  not_deep: "A little deeper, if it's comfortable",
  not_upright: "Stand up tall at the top",
  too_fast: "A little slower",
  sit_slowly: "Sit down slowly, with control",
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

/** Trunk angle from vertical (degrees), forward/back and sideways together. */
function trunkLean(f: Frame): number {
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
};

/** A squat that bends the knees less than this (degrees) gets "a little deeper". */
export const SQUAT_SHALLOW_BEND = 60;

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
const kneeStraighter = (f: Frame) => 360 - Math.max(...knees(f));
const armHigher = (f: Frame) => 180 - Math.max(...shoulders(f));

export const EXERCISES: Record<string, ExerciseProfile> = {
  squat: {
    id: "squat",
    repSignal: kneeBoth,
    counter: { ...DEFAULT_REP_OPTIONS, minDepth: 15 },
    liveLabel: "Knee bend",
    liveValue: (f) => Math.max(0, 180 - kneeBoth(f)),
    repMeasure: (r) => 180 - r.minKnee,
    measureLabel: "deepest knee bend",
    measureColumn: "knee_bend_deg",
    liveWarning: (f, isDown) => isDown && kneeBoth(f) < 150 && kneesInRatio(f) < KNEES_IN_RATIO,
    liveWarningFault: "knees_in",
    fault: (c) => {
      if (shareOf(c.liveFlags) >= 0.25) return "knees_in";
      // The live goal is 70 degrees of knee bend (lib/pose/live.ts); more than 10 short of it is called out.
      if (180 - c.rep.minKnee < SQUAT_SHALLOW_BEND) return "not_deep";
      if (c.rep.topKnee < 155) return "not_upright";
      if (c.rep.activeSeconds < 1.2) return "too_fast";
      return null;
    },
  },
  sit_to_stand: {
    id: "sit_to_stand",
    repSignal: kneeBoth,
    counter: { ...DEFAULT_REP_OPTIONS, minDepth: 30 },
    liveLabel: "Knee bend",
    liveValue: (f) => Math.max(0, 180 - kneeBoth(f)),
    repMeasure: (r) => 180 - r.minKnee,
    measureLabel: "deepest knee bend",
    measureColumn: "knee_bend_deg",
    liveWarning: (f, isDown) => isDown && kneeBoth(f) < 150 && kneesInRatio(f) < KNEES_IN_RATIO,
    liveWarningFault: "knees_in",
    fault: (c) => {
      if (shareOf(c.liveFlags) >= 0.25) return "knees_in";
      if (c.rep.topKnee < 155) return "not_upright";
      // Sitting down is the half people rush: the lowering phase should take about a second or more.
      const s = c.frames.map(kneeBoth);
      let v = 0;
      for (let i = 1; i < s.length; i++) if (s[i] < s[v]) v = i;
      let top = 0;
      for (let i = 1; i < v; i++) if (s[i] > s[top]) top = i;
      if (c.times[v] - c.times[top] < 0.8) return "sit_slowly";
      if (c.rep.activeSeconds < 1.5) return "too_fast";
      return null;
    },
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
