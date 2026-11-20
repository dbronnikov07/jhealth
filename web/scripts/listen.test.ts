// Finding speech in the microphone signal (lib/listen.ts): the detector and the resampler, on synthetic audio.
// Run:  npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { Resampler, Vad } from "../src/lib/listen.ts";

const FRAME = Vad.FRAME;
const noise = (level: number) => Float32Array.from({ length: FRAME }, () => (Math.random() * 2 - 1) * level);
const voice = (level: number) => Float32Array.from({ length: FRAME }, (_, i) => Math.sin(i / 6) * level);

function run(vad: Vad, frames: Float32Array[]) {
  const out: { seconds: number; startMs: number; endMs: number }[] = [];
  frames.forEach((f, i) => {
    const u = vad.push(f, i * 20);
    if (u) out.push({ seconds: u.audio.length / 16000, startMs: u.startMs, endMs: u.endMs });
  });
  return out;
}
const repeat = (n: number, f: () => Float32Array) => Array.from({ length: n }, f);

test("a sentence in a quiet room is found once, with its start and end", () => {
  const frames = [...repeat(50, () => noise(0.002)), ...repeat(60, () => voice(0.08)), ...repeat(50, () => noise(0.002))];
  const got = run(new Vad(), frames);
  assert.equal(got.length, 1);
  assert.ok(got[0].seconds > 1.2 && got[0].seconds < 2.0, `about 1.5 s of audio, got ${got[0].seconds}`);
  assert.ok(got[0].startMs >= 600 && got[0].startMs <= 1100, `starts near 1.0 s, got ${got[0].startMs}`);
});

test("room noise, a click and a cough are not sentences", () => {
  assert.equal(run(new Vad(), repeat(300, () => noise(0.004))).length, 0);
  const click = [...repeat(50, () => noise(0.002)), ...repeat(3, () => voice(0.3)), ...repeat(80, () => noise(0.002))];
  assert.equal(run(new Vad(), click).length, 0);
});

test("two sentences with a pause between them are two utterances; a short breath inside one is not a break", () => {
  const two = [...repeat(40, () => noise(0.002)), ...repeat(40, () => voice(0.06)), ...repeat(60, () => noise(0.002)),
    ...repeat(40, () => voice(0.06)), ...repeat(60, () => noise(0.002))];
  assert.equal(run(new Vad(), two).length, 2);
  const breath = [...repeat(40, () => noise(0.002)), ...repeat(30, () => voice(0.06)), ...repeat(12, () => noise(0.002)),
    ...repeat(30, () => voice(0.06)), ...repeat(60, () => noise(0.002))];
  assert.equal(run(new Vad(), breath).length, 1);
});

test("a noisy room raises the bar instead of recording all the time", () => {
  const frames = [...repeat(200, () => noise(0.03)), ...repeat(50, () => voice(0.25)), ...repeat(80, () => noise(0.03))];
  assert.equal(run(new Vad(), frames).length, 1);
});

test("48 kHz and 44.1 kHz microphones both become 16 kHz frames", () => {
  for (const rate of [48000, 44100]) {
    const r = new Resampler(rate);
    let frames = 0;
    for (let i = 0; i < 50; i++) r.push(new Float32Array(Math.round(rate / 50)), () => frames++);   // one second
    assert.ok(Math.abs(frames - 50) <= 1, `${rate} Hz: one second is about 50 frames, got ${frames}`);
  }
});
