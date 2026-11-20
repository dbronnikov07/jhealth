// The four exercise profiles on synthetic skeletons: one repetition is counted, and the right mistake is named.
// Run:  npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { EXERCISES, FACING_MIN, UPRIGHT_KNEE, UPRIGHT_THIGH, countsAsRep, facingCamera, profileFor, thighTilt, withModelFlag, type Fault } from "../src/lib/pose/exercises.ts";
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

/** A standing or sitting-down body with both knees at `kneeDeg`; `yaw` turns it away from the camera (90 = side on). */
function legs(o: { kneeDeg: number; yaw?: number; kneesTogether?: boolean }): Frame {
  const f = body({});
  const t = rad((180 - o.kneeDeg) / 2);
  for (const [hip, knee, ankle] of [[23, 25, 27], [24, 26, 28]] as const) {
    f[knee] = add(f[hip], [0, 0.45 * Math.cos(t), -0.45 * Math.sin(t)]);
    f[ankle] = add(f[knee], [0, 0.45 * Math.cos(t), 0.45 * Math.sin(t)]);
    if (o.kneesTogether) f[knee] = [f[knee][0] * 0.3, f[knee][1], f[knee][2]];
  }
  const a = rad(o.yaw ?? 0);
  return f.map(([x, y, z]) => [x * Math.cos(a) + z * Math.sin(a), y, -x * Math.sin(a) + z * Math.cos(a)] as Vec);
}

test("standing tall is judged at the angle a single camera really measures", () => {
  // Real home clips: a person standing normally measures 150 to 160 degrees at the knee, not 180.
  assert.equal(UPRIGHT_KNEE, 145);
  for (const exercise of ["squat"]) {
    const normal = run(exercise, movement(152, 90, 1.5, 0.5, 1.5).map((k) => legs({ kneeDeg: k })));
    assert.deepEqual(normal, { reps: 1, faults: [null] }, `${exercise}: standing at 152 degrees is standing`);
    const stooped = run(exercise, movement(140, 90, 1.5, 0.5, 1.5).map((k) => legs({ kneeDeg: k })));
    assert.deepEqual(stooped, { reps: 1, faults: ["not_upright"] }, `${exercise}: 140 degrees is not upright`);
  }
});

test("knees caving in is only judged when the person faces the camera", () => {
  assert.ok(facingCamera(legs({ kneeDeg: 170 })) > 0.99);
  assert.ok(facingCamera(legs({ kneeDeg: 170, yaw: 45 })) > FACING_MIN);
  assert.ok(facingCamera(legs({ kneeDeg: 170, yaw: 85 })) < FACING_MIN);
  const squat = (yaw: number) => run("squat", movement(165, 90, 1.5, 0.5, 1.5).map((k) => legs({ kneeDeg: k, yaw, kneesTogether: k < 150 })));
  assert.deepEqual(squat(0), { reps: 1, faults: ["knees_in"] });
  assert.deepEqual(squat(30), { reps: 1, faults: ["knees_in"] });
  assert.deepEqual(squat(85), { reps: 1, faults: [null] });     // side on: the camera cannot see it, so say nothing
});

test("a small bob of the knees is not a squat: it does not count", () => {
  const rep = (minKnee: number) => ({ startIndex: 0, endIndex: 1, startTime: 0, endTime: 1, minKnee, topKnee: 158, depth: 158 - minKnee, activeSeconds: 2 });
  assert.equal(countsAsRep(EXERCISES.squat, rep(140)), false);        // knees bent 40 degrees: a couple of centimetres
  assert.equal(countsAsRep(EXERCISES.squat, rep(118)), true);         // 62 degrees: a real chair squat
  assert.equal(countsAsRep(EXERCISES.sit_to_stand, rep(150)), false); // thighs only 30 degrees from vertical: never sat
  assert.equal(countsAsRep(EXERCISES.sit_to_stand, rep(110)), true);  // thighs at 70 degrees: sat on the chair
  assert.equal(countsAsRep(EXERCISES.arm_raise, rep(130)), false);    // arm lifted 50 degrees
  assert.equal(countsAsRep(EXERCISES.arm_raise, rep(95)), true);      // 85 degrees: about shoulder height
});

/** Arms crossed over the chest: both wrists at chest height, in front of the body. */
function armsCrossed(f: Frame): Frame {
  const g = f.map((p) => [...p] as Vec);
  g[13] = [0.05, -0.32, -0.12]; g[15] = [-0.12, -0.36, -0.15];
  g[14] = [-0.05, -0.32, -0.12]; g[16] = [0.12, -0.36, -0.15];
  return g;
}

test("sit-to-stand is counted on the thigh angle, which needs no shins or feet", () => {
  assert.ok(Math.abs(thighTilt(legs({ kneeDeg: 170 })) - 5) < 1);     // standing
  assert.ok(Math.abs(thighTilt(legs({ kneeDeg: 40 })) - 70) < 1);     // sitting on a chair
  const good = run("sit_to_stand", movement(170, 40, 1.6, 0.6, 1.6).map((k) => armsCrossed(legs({ kneeDeg: k }))));
  assert.deepEqual(good, { reps: 1, faults: [null] });
  // The shins and feet hidden or guessed wrong (ankles dragged back to the knees) change nothing.
  const noFeet = run("sit_to_stand", movement(170, 40, 1.6, 0.6, 1.6).map((k) => {
    const f = armsCrossed(legs({ kneeDeg: k }));
    f[27] = [...f[25]] as Vec; f[28] = [...f[26]] as Vec;
    return f;
  }));
  assert.deepEqual(noFeet, { reps: 1, faults: [null] });
});

test("sit-to-stand: pushing up with the hands is named, standing half-way is named", () => {
  const hands = run("sit_to_stand", movement(170, 40, 1.6, 0.6, 1.6).map((k) => legs({ kneeDeg: k })));   // hands at the sides
  assert.deepEqual(hands, { reps: 1, faults: ["uses_hands"] });
  const halfUp = run("sit_to_stand", movement(118, 40, 1.6, 0.6, 1.6).map((k) => armsCrossed(legs({ kneeDeg: k }))));
  assert.ok(180 - 118 > UPRIGHT_THIGH * 2);
  assert.deepEqual(halfUp, { reps: 1, faults: ["not_upright"] });
});

