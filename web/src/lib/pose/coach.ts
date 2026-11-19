// Rules that NAME the mistake (the model only gives a quality score). Plain thresholds, easy to explain.
// They assume the camera faces the person, as in the demo setup. Tune them from your own clips:
// train_own.py prints suggested thresholds from your good and bad squats.
import type { Frame } from "./features";

/** Knee distance divided by ankle distance, side to side. Below KNEES_IN_RATIO, the knees cave inwards. */
export const KNEES_IN_RATIO = 0.8;
/** Knee angle at the top below this: the patient did not stand up fully. */
export const UPRIGHT_KNEE_DEG = 155;
/** Moving part of a repetition shorter than this: too fast. */
export const MIN_REP_SECONDS = 1.2;
/** Share of the bent part of a repetition with knees caving in that makes it a "knees in" repetition. */
const KNEES_IN_SHARE = 0.25;

export function kneesInRatio(f: Frame): number {
  const knees = Math.abs(f[25][0] - f[26][0]);
  const ankles = Math.abs(f[27][0] - f[28][0]);
  return knees / (ankles + 1e-9);
}

export type Fault = "knees_in" | "not_upright" | "too_fast";

export const CUE: Record<Fault, string> = {
  knees_in: "Knees out, over your toes",
  not_upright: "Stand up tall at the top",
  too_fast: "A little slower",
};

export function repFault(m: { kneesInShare: number; topKnee: number; activeSeconds: number }): Fault | null {
  if (m.kneesInShare >= KNEES_IN_SHARE) return "knees_in";
  if (m.topKnee < UPRIGHT_KNEE_DEG) return "not_upright";
  if (m.activeSeconds < MIN_REP_SECONDS) return "too_fast";
  return null;
}
