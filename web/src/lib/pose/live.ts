// Live coaching: what the session says and draws WHILE the patient is moving, frame by frame.
// (exercises.ts names a mistake after a repetition ends; this file talks during it.)
//
// Each camera exercise has one measured angle and a goal for it (first guesses for the demo; in a product the
// physiotherapist sets the goal per patient):
//   squat           knee bend, goal 70 degrees     "Lower, 25° to go"  ->  "Good depth. Stand up tall"
//   sit_to_stand    knee bend, goal 75 degrees     "Sit down slowly"   ->  "Now stand up tall"
//   arm_raise       arm height, goal 80 degrees    "Higher, 20° to go" ->  "Good height. Lower slowly"
// Pure functions, unit-tested in scripts/live.test.ts.
import { jointAngle, type Frame } from "./features.ts";

export type LiveTone = "idle" | "move" | "good" | "warn";

export type LiveGoal = {
  /** Goal for the profile's liveValue, in degrees. */
  goal: number;
  /** While moving towards the goal: the words before "N° to go". */
  toward: string;
  /** Said when the goal is reached. */
  atGoal: string;
  /** Said on the way back, once the goal was reached in this repetition. */
  onReturn: string;
  /** Shown at rest between repetitions. */
  ready: string;
  /** Which joint the angle is drawn on: [a, vertex, c] landmark indices for the left and right side. */
  joint: { left: [number, number, number]; right: [number, number, number] };
};

export const LIVE_GOALS: Record<string, LiveGoal> = {
  squat: {
    goal: 70, toward: "Lower", atGoal: "Good depth. Now stand up tall", onReturn: "Stand up tall", ready: "Ready. Bend your knees and sit back",
    joint: { left: [23, 25, 27], right: [24, 26, 28] },
  },
  sit_to_stand: {
    goal: 75, toward: "Sit down slowly", atGoal: "Now stand up tall", onReturn: "All the way up", ready: "Ready. Sit down slowly",
    joint: { left: [23, 25, 27], right: [24, 26, 28] },
  },
  arm_raise: {
    goal: 80, toward: "Higher", atGoal: "Good height. Lower slowly", onReturn: "Lower slowly", ready: "Ready. Lift your arm out to the side",
    joint: { left: [23, 11, 13], right: [24, 12, 14] },
  },
};

export type LiveState = {
  value: number;            // the measured angle now, degrees
  goal: number;
  progress: number;         // 0..1 of the way to the goal (1 = reached)
  tone: LiveTone;
  message: string;
};

/**
 * What to show for this frame.
 * moving: the rep counter says a repetition is under way; reached: the goal was already reached in this repetition;
 * warning: a live mistake (knees caving in, bent elbow) with its words, which beats everything else.
 */
export function liveCoach(g: LiveGoal, value: number, s: { moving: boolean; reached: boolean; warning: string | null }): LiveState {
  const v = Math.max(0, Math.round(value));
  const base = { value: v, goal: g.goal, progress: Math.min(1, v / g.goal) };
  if (s.warning) return { ...base, tone: "warn", message: s.warning };
  if (v >= g.goal) return { ...base, tone: "good", message: g.atGoal };
  if (!s.moving) return { ...base, tone: "idle", message: g.ready };
  if (s.reached) return { ...base, tone: "good", message: g.onReturn };
  const left = g.goal - v;
  return { ...base, tone: "move", message: left > 3 ? `${g.toward}, ${left}° to go` : g.toward };
}

/** After a repetition: was the goal missed by more than `slack` degrees? (squat: "bend a little deeper"). */
export function missedGoal(g: LiveGoal, best: number, slack = 10): boolean {
  return best < g.goal - slack;
}

/** Arm raise: the lifting arm's elbow is clearly bent while the arm is up (the rule the rep-end check also uses). */
export function bentElbowNow(f: Frame): boolean {
  const sh = [jointAngle(f, 23, 11, 13), jointAngle(f, 24, 12, 14)];
  const side = sh[0] >= sh[1] ? 0 : 1;
  if (sh[side] < 45) return false; // arm still low: nothing to judge yet
  const elbow = side === 0 ? jointAngle(f, 11, 13, 15) : jointAngle(f, 12, 14, 16);
  return elbow < 145;
}

/** Which side to draw the angle on: for the arm, the higher arm; for the legs, the side the camera sees better. */
export function focusSide(exerciseId: string, f: Frame, visibility: (i: number) => number): "left" | "right" {
  if (exerciseId === "arm_raise") return jointAngle(f, 23, 11, 13) >= jointAngle(f, 24, 12, 14) ? "left" : "right";
  return visibility(25) + visibility(27) >= visibility(26) + visibility(28) ? "left" : "right";
}

/** Frames per second from the last few frame times (seconds). */
export function fpsOf(times: number[]): number | null {
  if (times.length < 4) return null;
  const span = times[times.length - 1] - times[0];
  return span > 0 ? Math.round((times.length - 1) / span) : null;
}
