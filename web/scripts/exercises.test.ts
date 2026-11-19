// The four exercise profiles on synthetic skeletons: one repetition is counted, and the right mistake is named.
// Run:  npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { EXERCISES, profileFor, withModelFlag, type Fault } from "../src/lib/pose/exercises.ts";
import type { Frame, Vec } from "../src/lib/pose/features.ts";
import { RepCounter } from "../src/lib/pose/reps.ts";

const FPS = 15;
const rad = (d: number) => (d * Math.PI) / 180;
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k, a[2] * k];

/** A person facing the camera (MediaPipe world: y down, -z towards the camera). */
function body(o: { armDeg?: number; elbowBend?: number; kneeDeg?: number; seated?: boolean; lean?: number }): Frame {
  const f: Frame = Array.from({ length: 33 }, () => [0, 0, 0] as Vec);
  const lean = rad(o.lean ?? 0);
  f[23] = [0.1, 0, 0];
  f[24] = [-0.1, 0, 0];
  f[11] = [0.18, -0.5 * Math.cos(lean), 0.5 * Math.sin(lean)];
  f[12] = [-0.18, -0.5 * Math.cos(lean), 0.5 * Math.sin(lean)];
  // arms: the left arm is raised to the side by armDeg (0 = hanging down); the right arm hangs
  const a = rad(o.armDeg ?? 5);
  const up: Vec = [Math.sin(a), Math.cos(a), 0];
  f[13] = add(f[11], scale(up, 0.28));
  const b = a + rad(o.elbowBend ?? 0);
  f[15] = add(f[13], scale([Math.sin(b), Math.cos(b), 0], 0.27));
  f[14] = add(f[12], [-0.02, 0.28, 0]);
  f[16] = add(f[14], [-0.02, 0.27, 0]);
  if (o.seated) {
    // thighs forward, the left shin hanging down, the right shin swinging forward to straighten the knee
    for (const [hip, knee, ankle, k] of [[23, 25, 27, 90], [24, 26, 28, o.kneeDeg ?? 90]] as const) {
      f[knee] = add(f[hip], [0, 0, -0.45]);
      const al = rad(k - 90);
      f[ankle] = add(f[knee], scale([0, Math.cos(al), -Math.sin(al)], 0.45));
    }
  } else {
    f[25] = [0.1, 0.45, 0];
    f[26] = [-0.1, 0.45, 0];
    f[27] = [0.1, 0.9, 0];
    f[28] = [-0.1, 0.9, 0];
  }
  return f;
}

/** A smooth movement: rest, go out over `up` s, hold, come back over `down` s, rest. */
function movement(from: number, to: number, up: number, hold: number, down: number): number[] {
  const out: number[] = [];
  const push = (sec: number, f: (u: number) => number) => {
    for (let i = 0; i < Math.round(sec * FPS); i++) out.push(f(i / Math.max(1, Math.round(sec * FPS) - 1)));
  };
  const ease = (u: number) => (1 - Math.cos(Math.PI * u)) / 2;
  push(1, () => from);
  push(up, (u) => from + (to - from) * ease(u));
  push(hold, () => to);
  push(down, (u) => to + (from - to) * ease(u));
  push(1.2, () => from);
  return out;
}

function run(exercise: string, frames: Frame[]): { reps: number; faults: (Fault | null)[] } {
  const p = profileFor(exercise);
  const counter = new RepCounter(p.counter);
  const flags: boolean[] = [];
  const faults: (Fault | null)[] = [];
  frames.forEach((f, i) => {
    flags.push(p.liveWarning?.(f, counter.isDown) ?? false);
    const rep = counter.push(i / FPS, p.repSignal(f));
    if (rep) {
      faults.push(p.fault({
        rep, frames: frames.slice(rep.startIndex, rep.endIndex + 1),
        times: counter.times.slice(rep.startIndex, rep.endIndex + 1), liveFlags: flags.slice(rep.startIndex, rep.endIndex + 1),
      }));
    }
  });
  return { reps: faults.length, faults };
}

test("all four exercises have a profile", () => {
  assert.deepEqual(Object.keys(EXERCISES).sort(), ["arm_raise", "seated_knee_extension", "sit_to_stand", "squat"]);
  assert.equal(profileFor("something_new").id, "squat");
});

test("seated knee extension: a good rep, no hold, not straight, leaning back", () => {
  const good = run("seated_knee_extension", movement(90, 172, 1.5, 2, 1.5).map((k) => body({ seated: true, kneeDeg: k })));
  assert.deepEqual(good, { reps: 1, faults: [null] });
  const noHold = run("seated_knee_extension", movement(90, 172, 1.5, 0.1, 1.5).map((k) => body({ seated: true, kneeDeg: k })));
  assert.deepEqual(noHold, { reps: 1, faults: ["no_hold"] });
  const short = run("seated_knee_extension", movement(90, 135, 1.5, 2, 1.5).map((k) => body({ seated: true, kneeDeg: k })));
  assert.deepEqual(short, { reps: 1, faults: ["not_straight"] });
  const leanBack = run("seated_knee_extension", movement(90, 172, 1.5, 2, 1.5).map((k) => body({ seated: true, kneeDeg: k, lean: (k - 90) / 3 })));
  assert.deepEqual(leanBack, { reps: 1, faults: ["lean_back"] });
});

test("arm raise: a good rep, too low, bent elbow", () => {
  assert.deepEqual(run("arm_raise", movement(5, 90, 1.5, 0.5, 1.5).map((a) => body({ armDeg: a }))), { reps: 1, faults: [null] });
  assert.deepEqual(run("arm_raise", movement(5, 62, 1.5, 0.5, 1.5).map((a) => body({ armDeg: a }))), { reps: 1, faults: ["not_high"] });
  assert.deepEqual(run("arm_raise", movement(5, 90, 1.5, 0.5, 1.5).map((a) => body({ armDeg: a, elbowBend: 60 * (a / 90) }))), { reps: 1, faults: ["bent_elbow"] });
});

test("the model only adds a gentle cue when it is confident and the rules saw nothing", () => {
  assert.equal(withModelFlag(null, 0.9, 0.85), "steady");
  assert.equal(withModelFlag(null, 0.6, 0.85), null);            // not confident enough: say nothing
  assert.equal(withModelFlag("knees_in", 0.9, 0.85), "knees_in"); // the rules' specific cue wins
  assert.equal(withModelFlag(null, 0.99, undefined), null);       // a model without a threshold never flags
  assert.equal(withModelFlag(null, null, 0.85), null);
});

test("the stored number is the right one for each exercise", () => {
  const rep = { startIndex: 0, endIndex: 1, startTime: 0, endTime: 1, minKnee: 190, topKnee: 270, depth: 80, activeSeconds: 2 };
  assert.equal(EXERCISES.seated_knee_extension.repMeasure(rep), 170);         // straightest knee angle
  assert.equal(EXERCISES.arm_raise.repMeasure({ ...rep, minKnee: 85 }), 95);  // highest arm angle
  assert.equal(EXERCISES.squat.repMeasure({ ...rep, minKnee: 95 }), 85);      // deepest knee bend
  assert.equal(EXERCISES.squat.measureColumn, "knee_bend_deg");
  assert.equal(EXERCISES.arm_raise.measureColumn, "rom_deg");
});
