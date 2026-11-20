// Possible-fall rules (lib/pose/fall.ts) and the spoken commands (lib/listen.ts).
// Run:  npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { matchCommand } from "../src/lib/listen.ts";
import { FallWatch } from "../src/lib/pose/fall.ts";

const FPS = 15;
function run(w: FallWatch, frames: { lean?: number; hip?: number | null; gone?: boolean }[], from = 0): number[] {
  const hits: number[] = [];
  frames.forEach((f, i) => {
    const t = from + i / FPS;
    if (f.gone ? w.missing(t) : w.seen(t, f.lean ?? 10, f.hip ?? 0.5)) hits.push(i);
  });
  return hits;
}
const hold = (n: number, f: { lean?: number; hip?: number | null; gone?: boolean }) => Array.from({ length: Math.round(n * FPS) }, () => f);

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
  const drop = [...hold(2, { lean: 10, hip: 0.5 }), { lean: 30, hip: 0.6 }, { lean: 45, hip: 0.68 }, { lean: 60, hip: 0.76 }, ...hold(2, { gone: true })];
  assert.equal(run(new FallWatch(), drop).length, 1);
  const walkOut = [...hold(2, { lean: 10, hip: 0.5 }), ...hold(2, { gone: true })];
  assert.deepEqual(run(new FallWatch(), walkOut), []);
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
