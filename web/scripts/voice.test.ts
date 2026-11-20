// The coach's recorded voice: what is said after a repetition, and that every clip the app can ask for exists.
// Run:  npm run test:unit
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import { CUE } from "../src/lib/pose/exercises.ts";
import { ACK_CLIPS, COUNT_CLIPS, EMERGENCY_CLIPS, MOTIVATION, PHRASE_CLIPS, SETUP_CLIPS, START_CLIPS, repClips, sessionClips } from "../src/lib/voice.ts";

const VOICE = new URL("../public/voice/", import.meta.url);

test("after a repetition the coach counts, then names a mistake, then says where we are", () => {
  assert.deepEqual(repClips(2, null), ["n2"]);                                          // a good rep: just the count
  assert.deepEqual(repClips(3, null), ["n3", "m1"]);                                    // every third: some encouragement
  assert.deepEqual(repClips(6, null), ["n6", "m2"]);
  assert.deepEqual(repClips(7, null, { leftInSet: 3 }), ["n7", "three_more"]);
  assert.deepEqual(repClips(9, "too_fast", { leftInSet: 1 }), ["n9", "too_fast", "last_one"]);
  assert.deepEqual(repClips(4, "not_deep"), ["n4", "not_deep"]);
  assert.deepEqual(repClips(5, null, { halfway: true }), ["n5", "halfway"]);
  assert.deepEqual(repClips(5, "too_fast", { halfway: true }), ["n5", "too_fast"]);     // the cue matters more
  assert.deepEqual(repClips(10, null, { setDone: true, halfway: true }), ["n10", "set_done"]);
  assert.deepEqual(repClips(20, "not_upright", { allDone: true }), ["n20", "not_upright", "all_done"]);
});

test("a session asks only for clips that exist", () => {
  const cues = Object.keys(CUE);
  assert.deepEqual(sessionClips("squat", 3, []), ["n1", "n2", "n3", ...PHRASE_CLIPS, ...SETUP_CLIPS, ...MOTIVATION, ...EMERGENCY_CLIPS, ...ACK_CLIPS, "start_squat", "not_counted_squat"]);
  assert.ok(!sessionClips("seated_knee_extension", 3, []).some((c) => c.startsWith("start_")));   // no own line: generic "start"
  assert.equal(sessionClips("squat", 99, []).filter((c) => /^n\d+$/.test(c)).length, COUNT_CLIPS);
  const every = [...sessionClips("squat", COUNT_CLIPS, cues), ...START_CLIPS.flatMap((id) => [`start_${id}`, `not_counted_${id}`])];
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

test("the spoken coach's answer is cut into sentences, so speech can start sooner", async () => {
  const { splitSentences } = await import("../src/lib/coach/voice-coach.ts");
  assert.deepEqual(splitSentences("Nice work. That was a strong set. How did it feel?"), ["Nice work.", "That was a strong set.", "How did it feel?"]);
  assert.deepEqual(splitSentences("It is eleven degrees and clear in Toronto right now."), ["It is eleven degrees", "and clear in Toronto right now."]);
  assert.deepEqual(splitSentences("Okay. Let's go. Three more. You can do it."), ["Okay.", "Let's go. Three more.", "You can do it."]);
  assert.deepEqual(splitSentences("Go as low as is comfortable, Margaret."), ["Go as low as is comfortable, Margaret."]);
  assert.equal(splitSentences("One. Two. Three. Four. Five. Six.").length <= 3, true);
  assert.deepEqual(
    splitSentences("Go only as deep as is comfortable for your knee today, and keep the movement slow and steady. Great work."),
    ["Go only as deep as is comfortable", "for your knee today, and keep the movement slow and steady.", "Great work."],
  );
});

test("a short answer with an early comma starts speaking after the comma", async () => {
  const { splitSentences } = await import("../src/lib/coach/voice-coach.ts");
  assert.deepEqual(splitSentences("I am doing great, thanks for asking! How are you feeling?"), ["I am doing great,", "thanks for asking!", "How are you feeling?"]);
});

test("'am I doing it right?' is answered from the camera's numbers, in the app's own words", async () => {
  const { formAnswer } = await import("../src/lib/coach/voice-coach.ts");
  const base = { counted: 6, good: 4, topFault: "Knees out, over your toes", topFaultCount: 2, lastFault: null, lastScore: 91, hands: 0, small: 0 };
  assert.equal(formAnswer("Am I doing it correctly?", "Dana", base), "4 of 6 were clean, Dana. The thing to fix: knees out, over your toes. Your last one was good.");
  assert.equal(formAnswer("am I doing correctly", "Dana", base)?.includes("knees out, over your toes"), true);   // as Whisper may hear it
  assert.match(formAnswer("How is my form?", "Dana", { ...base, good: 6, topFault: null, topFaultCount: 0 })!, /^Yes, Dana, it looks good\. 6 of 6 were clean, and the last one scored 91 out of 100\.$/);
  assert.match(formAnswer("how am I doing", "Dana", { ...base, hands: 3 })!, /^3 didn't count because your hands pushed/);
  assert.match(formAnswer("is this right?", "Dana", { ...base, counted: 0, good: 0, topFault: null, topFaultCount: 0, lastScore: null })!, /^I'm watching, Dana/);
  // not a question about form: left to the coach
  assert.equal(formAnswer("What's the weather today?", "Dana", base), null);
  assert.equal(formAnswer("How are you?", "Dana", base), null);
  assert.equal(formAnswer("Am I doing it right?", "Dana", null), null);
});

test("the name is said properly, and not in every answer", async () => {
  const { forVoice, spokenName, withoutName } = await import("../src/lib/coach/voice-coach.ts");
  assert.equal(spokenName("Dmitrii"), "Dmitri");
  assert.equal(spokenName("Andriy"), "Andri");
  assert.equal(spokenName("Margaret"), "Margaret");
  assert.equal(forVoice("Hello Dmitrii! How are you feeling today?", "Dmitrii"), "Hello Dmitri! How are you feeling today?");
  assert.equal(withoutName("Yes I can hear you loud and clear, Dmitrii.", "Dmitrii"), "Yes I can hear you loud and clear.");
  assert.equal(withoutName("Yes Dmitrii, I can hear and see you perfectly.", "Dmitrii"), "Yes, I can hear and see you perfectly.");
  assert.equal(withoutName("Take your time, Dmitrii. I am watching, so go ahead and try one.", "Dmitrii"), "Take your time. I am watching, so go ahead and try one.");
  assert.equal(withoutName("Dmitrii, let's try one repetition.", "Dmitrii"), "Let's try one repetition.");
  assert.equal(withoutName("That is the spirit, Dmitrii! Let's keep going.", "Dmitrii"), "That is the spirit! Let's keep going.");
  assert.equal(withoutName("It is 14 degrees and clear in Toronto.", "Dmitrii"), "It is 14 degrees and clear in Toronto.");
});
