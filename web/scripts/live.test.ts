// Live coaching words and states (lib/pose/live.ts). Run: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { fpsOf, LIVE_GOALS, liveCoach, missedGoal } from "../src/lib/pose/live.ts";

const squat = LIVE_GOALS.squat;

test("a squat is coached all the way down and back up", () => {
  assert.deepEqual(liveCoach(squat, 4, { moving: false, reached: false, warning: null }),
    { value: 4, goal: 70, progress: 4 / 70, tone: "idle", message: "Ready. Bend your knees and sit back" });
  const half = liveCoach(squat, 45, { moving: true, reached: false, warning: null });
  assert.equal(half.tone, "move");
  assert.equal(half.message, "Lower, 25° to go");
  assert.equal(liveCoach(squat, 68, { moving: true, reached: false, warning: null }).message, "Lower"); // nearly there: no number flicker
  const deep = liveCoach(squat, 88, { moving: true, reached: true, warning: null });
  assert.deepEqual([deep.tone, deep.message, deep.progress], ["good", "Good depth. Now stand up tall", 1]);
  const rising = liveCoach(squat, 40, { moving: true, reached: true, warning: null });
  assert.deepEqual([rising.tone, rising.message], ["good", "Stand up tall"]);
});

test("a live mistake beats every other message", () => {
  const s = liveCoach(squat, 90, { moving: true, reached: true, warning: "Knees out, over your toes" });
  assert.deepEqual([s.tone, s.message], ["warn", "Knees out, over your toes"]);
});

test("the arm raise counts down to shoulder height", () => {
  const arm = LIVE_GOALS.arm_raise;
  assert.equal(liveCoach(arm, 60, { moving: true, reached: false, warning: null }).message, "Higher, 20° to go");
  assert.equal(liveCoach(arm, 84, { moving: true, reached: true, warning: null }).message, "Good height. Lower slowly");
});

test("a shallow repetition is noticed, a near miss is not", () => {
  assert.equal(missedGoal(squat, 42), true);
  assert.equal(missedGoal(squat, 63), false);
  assert.equal(missedGoal(squat, 95), false);
});

test("frames per second from frame times", () => {
  assert.equal(fpsOf([0, 1 / 15, 2 / 15, 3 / 15, 4 / 15]), 15);
  assert.equal(fpsOf([0, 0.1]), null);
});
