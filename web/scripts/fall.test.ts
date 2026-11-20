// Possible-fall rules (lib/pose/fall.ts) and the spoken commands (lib/listen.ts).
// Run:  npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { matchCommand } from "../src/lib/listen.ts";
import { FallWatch } from "../src/lib/pose/fall.ts";

const FPS = 15;
type F = { lean?: number; hip?: number | null; gone?: boolean; torso?: number; feet?: number };
function run(w: FallWatch, frames: F[], from = 0): number[] {
  const hits: number[] = [];
  frames.forEach((f, i) => {
    const t = from + i / FPS;
    if (f.gone ? w.missing(t) : w.seen(t, f.lean ?? 10, f.hip ?? 0.5, { torso: f.torso, hipsAboveFeet: f.feet })) hits.push(i);
  });
  return hits;
}
const hold = (n: number, f: F) => Array.from({ length: Math.round(n * FPS) }, () => f);

test("standing, then lying on the floor for a second, is a possible fall (asked once)", () => {
  const w = new FallWatch();
  const hits = run(w, [...hold(2, { lean: 8 }), ...hold(0.3, { lean: 50 }), ...hold(3, { lean: 85 })]);
  assert.equal(hits.length, 1);
});

test("squats and sit-to-stand lean forward but never count as a fall", () => {
  const w = new FallWatch();
  const squat = Array.from({ length: 10 }, () => [...hold(1, { lean: 10 }), ...hold(0.8, { lean: 50 }), ...hold(0.8, { lean: 25 })]).flat();
  assert.deepEqual(run(w, squat), []);
});

test("someone already lying down at the start (a floor exercise) is not a fall", () => {
  assert.deepEqual(run(new FallWatch(), hold(5, { lean: 88 })), []);
});

test("dropping fast and vanishing from the picture is a possible fall; walking out of it is not", () => {
  const drop = [...hold(2, { lean: 10, hip: 0.5 }), { lean: 30, hip: 0.6 }, { lean: 45, hip: 0.68 }, { lean: 60, hip: 0.76 }, ...hold(3, { gone: true })];
  assert.equal(run(new FallWatch(), drop).length, 1);
  const walkOut = [...hold(2, { lean: 10, hip: 0.5 }), ...hold(4, { gone: true })];
  assert.deepEqual(run(new FallWatch(), walkOut), []);
});

test("walking up to the camera, or bowing to reach the laptop, is not a fall", () => {
  // Coming closer: the hips slide down the picture fast, but the body grows on screen. Then they are out of view.
  const approach = [...hold(2, { lean: 10, hip: 0.5, torso: 0.25 }), { hip: 0.6, torso: 0.3 }, { hip: 0.7, torso: 0.36 }, { hip: 0.8, torso: 0.43 }, ...hold(5, { gone: true })];
  assert.deepEqual(run(new FallWatch(), approach), []);
  // The same drop with the body the same size is still a possible fall.
  const fall = [...hold(2, { lean: 10, hip: 0.5, torso: 0.25 }), { hip: 0.6, torso: 0.25 }, { hip: 0.7, torso: 0.24 }, { hip: 0.8, torso: 0.22 }, ...hold(5, { gone: true })];
  assert.equal(run(new FallWatch(), fall).length, 1);
  // A deep bow: trunk nearly level for three seconds, hips still 0.8 m above the feet.
  assert.deepEqual(run(new FallWatch(), [...hold(2, { lean: 8, feet: 0.85 }), ...hold(3, { lean: 80, feet: 0.8 })]), []);
  // On the floor: trunk level and hips down at foot height.
  assert.equal(run(new FallWatch(), [...hold(2, { lean: 8, feet: 0.85 }), ...hold(3, { lean: 85, feet: 0.1 })]).length, 1);
});

test("dropping to the floor and staying there, in full view, is a possible fall; sitting on a chair is not", () => {
  const stand = hold(3, { lean: 8, hip: 0.45, torso: 0.2 });
  // hips 0.3 of the picture lower (1.5 torso lengths), trunk still fairly upright: sitting on the floor after a fall
  assert.equal(run(new FallWatch(), [...stand, { lean: 25, hip: 0.6, torso: 0.2 }, ...hold(4, { lean: 25, hip: 0.75, torso: 0.2 })]).length, 1);
  // a chair takes the hips about 0.8 torso lengths down, however long they stay seated
  assert.deepEqual(run(new FallWatch(), [...stand, ...hold(8, { lean: 15, hip: 0.61, torso: 0.2 })]), []);
  // a quick dip to the floor and straight back up (picking something up) is not one either
  assert.deepEqual(run(new FallWatch(), [...stand, ...hold(1, { lean: 30, hip: 0.75, torso: 0.2 }), ...hold(3, { lean: 8, hip: 0.45, torso: 0.2 })]), []);
});

test("close to the camera nothing is a fall, whatever the body seems to do", () => {
  const w = new FallWatch();
  const stand = hold(3, { lean: 8, hip: 0.45, torso: 0.2 });
  // walks up: the torso doubles on screen, the hips slide down the picture, the pose goes wild, then out of view
  const walkUp = [{ hip: 0.5, torso: 0.24 }, { hip: 0.56, torso: 0.28 }, { hip: 0.64, torso: 0.34 }, { hip: 0.75, torso: 0.4 },
    ...hold(3, { lean: 85, hip: 0.9, torso: 0.45, feet: 0.1 }), ...hold(6, { gone: true })];
  assert.deepEqual(run(w, [...stand, ...walkUp]), []);
  assert.equal(w.isNear, true);
});

test("after a pause the fall watch starts fresh", () => {
  const w = new FallWatch();
  run(w, hold(2, { lean: 8 }));
  w.reset();
  assert.deepEqual(run(w, hold(3, { lean: 85 }), 10), []);     // not seen upright since the reset
});

test("pause and resume are short phrases of their own", () => {
  assert.equal(matchCommand("pause"), "pause");
  assert.equal(matchCommand("Hold on."), "pause");
  assert.equal(matchCommand("turn off the camera"), "pause");
  assert.equal(matchCommand("I'm back"), "resume");
  assert.equal(matchCommand("Continue."), "resume");
  assert.equal(matchCommand("should I pause between the repetitions or not"), null);
  assert.equal(matchCommand("can I continue this tomorrow with my physio"), null);
});

test("spoken commands: only a few phrases do anything", () => {
  assert.equal(matchCommand("Call 911"), "call_911");
  assert.equal(matchCommand("please call nine one one"), "call_911");
  assert.equal(matchCommand("call an ambulance"), "call_911");
  assert.equal(matchCommand("call mom"), "call_contact");
  assert.equal(matchCommand("Call Anna please", "Anna Lee"), "call_contact");
  assert.equal(matchCommand("help"), "help");
  assert.equal(matchCommand("I fell and I can't get up"), "help");
  assert.equal(matchCommand("I'm okay"), "okay");
  assert.equal(matchCommand("yeah I'm fine"), "okay");
  assert.equal(matchCommand("it hurts"), "pain");
  assert.equal(matchCommand("what's for dinner"), null);
  assert.equal(matchCommand("this is a helpful app"), null);       // "help" only as a word
  assert.equal(matchCommand("call me later"), null);
});

test("a sentence made of the coach's own recent words is an echo; the patient's words are not", async () => {
  const { rememberSaid, isEcho, looksLikeNoise } = await import("../src/lib/echo.ts");
  rememberSaid("Seven.", 1000);
  rememberSaid("Great form.", 1000);
  assert.equal(isEcho("7 great form", 2000), true);                  // the recogniser writes "7" for "seven"
  assert.equal(isEcho("seven how are you", 2000), false);            // mostly new words: the patient
  assert.equal(isEcho("it's a sharp pain", 2000), false);
  assert.equal(isEcho("seven", 20000), false);                       // long ago: not an echo any more
  assert.equal(looksLikeNoise("Thank you.", 0.6), true);             // what Whisper writes for a cough
  assert.equal(looksLikeNoise("Thank you.", 2.0), false);
});
