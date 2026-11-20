// The coach's recorded voice: what is said after a repetition, and that every clip the app can ask for exists.
// Run:  npm run test:unit
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import { CUE } from "../src/lib/pose/exercises.ts";
import { COUNT_CLIPS, PHRASE_CLIPS, START_CLIPS, repClips, sessionClips } from "../src/lib/voice.ts";

const VOICE = new URL("../public/voice/", import.meta.url);

test("after a repetition the coach counts, then names a mistake, then says where we are", () => {
  assert.deepEqual(repClips(3, null), ["n3"]);                                          // a good rep: just the count
  assert.deepEqual(repClips(4, "not_deep"), ["n4", "not_deep"]);
  assert.deepEqual(repClips(5, null, { halfway: true }), ["n5", "halfway"]);
  assert.deepEqual(repClips(5, "too_fast", { halfway: true }), ["n5", "too_fast"]);     // the cue matters more
  assert.deepEqual(repClips(10, null, { setDone: true, halfway: true }), ["n10", "set_done"]);
  assert.deepEqual(repClips(20, "not_upright", { allDone: true }), ["n20", "not_upright", "all_done"]);
});

test("a session asks only for clips that exist", () => {
  const cues = Object.keys(CUE);
  assert.deepEqual(sessionClips("squat", 3, []), ["n1", "n2", "n3", ...PHRASE_CLIPS, "start_squat"]);
  assert.ok(!sessionClips("seated_knee_extension", 3, []).some((c) => c.startsWith("start_")));   // no own line: generic "start"
  assert.equal(sessionClips("squat", 99, []).filter((c) => /^n\d+$/.test(c)).length, COUNT_CLIPS);
  const every = [...sessionClips("squat", COUNT_CLIPS, cues), ...START_CLIPS.map((id) => `start_${id}`)];
  for (const clip of every) {
    const file = new URL(`${clip}.mp3`, VOICE);
    assert.ok(existsSync(file), `public/voice/${clip}.mp3 is missing: run scripts/make-voice.py`);
    assert.ok(statSync(file).size > 2000, `${clip}.mp3 is too small to be speech`);
  }
});

test("the recording says the same words the screen shows", () => {
  const { lines } = JSON.parse(readFileSync(new URL("lines.json", VOICE), "utf8")) as { lines: Record<string, string> };
  for (const [fault, text] of Object.entries(CUE)) assert.equal(lines[fault].replace(/\.$/, ""), text.replace(/\.$/, ""), fault);
  assert.equal(lines.n1, "One.");
  assert.equal(lines[`n${COUNT_CLIPS}`], "Thirty.");
});
