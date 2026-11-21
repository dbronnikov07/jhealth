// Possible-fall rules (lib/pose/fall.ts) and the spoken commands (lib/listen.ts).
// Run:  npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { emergencyAnswer, matchCommand } from "../src/lib/listen.ts";
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

test("after a fall: 'Should I call 911?' is answered by voice, and 'don't call' never calls", () => {
  for (const no of ["No, no, no, because it's like a demo. Don't call it.", "No.", "No, I'm okay.", "I'm fine", "Don't call 911",
    "It's just a demo", "False alarm", "Nope, all good", "Yes, I'm okay", "Please don't call anyone"]) assert.equal(emergencyAnswer(no), "no", no);
  for (const yes of ["Yes", "Yes, please call", "Call 911", "Help", "No, I'm not okay", "I can't get up", "It hurts", "Call an ambulance"]) {
    assert.equal(emergencyAnswer(yes), "yes", yes);
  }
  assert.equal(emergencyAnswer("What's the weather?"), null);
  // outside the dialog too: a negated call is never a call
  assert.equal(matchCommand("don't call 911"), null);
  assert.equal(matchCommand("no need to call an ambulance, I'm okay"), "okay");
  assert.equal(matchCommand("I don't need help"), null);
  assert.equal(matchCommand("call 911"), "call_911");
});

test("lying on the floor is caught even when the camera keeps losing and finding the body", () => {
  const stand = hold(3, { lean: 8, hip: 0.45, torso: 0.2, feet: 0.85 });
  // goes down slowly (no fast drop), then the pose model blinks: three frames nobody, two frames lying, again and again
  const down = [...hold(0.6, { lean: 40, hip: 0.55, torso: 0.2, feet: 0.6 }), ...hold(0.6, { lean: 70, hip: 0.68, torso: 0.2, feet: 0.3 })];
  const blink = Array.from({ length: 12 }, () => [{ gone: true }, { gone: true }, { gone: true }, { lean: 86, hip: 0.8, torso: 0.2, feet: 0.05 }, { lean: 84, hip: 0.8, torso: 0.2, feet: 0.05 }]).flat();
  assert.equal(run(new FallWatch(), [...stand, ...down, ...blink]).length, 1);
  // never found again after going down slowly: asked after a few seconds of nobody
  assert.equal(run(new FallWatch(), [...stand, ...down, ...hold(4, { gone: true })]).length, 1);
  // a stray "standing" frame or two in between (the model guessing at furniture) does not cancel it
  const stray = Array.from({ length: 12 }, () => [{ gone: true }, { gone: true }, { lean: 86, hip: 0.8, torso: 0.2, feet: 0.05 }, { lean: 10, hip: 0.46, torso: 0.2, feet: 0.8 }, { gone: true }]).flat();
  assert.equal(run(new FallWatch(), [...stand, ...down, ...stray]).length, 1);
});

test("not a fall: lost while sitting on the chair, walking off, lying down briefly and getting up", () => {
  const stand = hold(3, { lean: 8, hip: 0.45, torso: 0.2, feet: 0.85 });
  // seated (hips 0.8 torso lengths down, trunk leaning in to stand up), then hidden for five seconds
  assert.deepEqual(run(new FallWatch(), [...stand, ...hold(2, { lean: 45, hip: 0.61, torso: 0.2, feet: 0.5 }), ...hold(5, { gone: true })]), []);
  // walks out of the picture upright, comes back
  assert.deepEqual(run(new FallWatch(), [...stand, ...hold(5, { gone: true }), ...stand]), []);
  // down on the floor for a second (a stumble caught, or picking something up), then standing again
  assert.deepEqual(run(new FallWatch(), [...stand, ...hold(0.7, { lean: 85, hip: 0.8, torso: 0.2, feet: 0.05 }), ...hold(0.3, { gone: true }), ...stand]), []);
  // goes down, then walks up to the camera (the body grows): nothing
  assert.deepEqual(run(new FallWatch(), [...stand, ...hold(0.5, { lean: 70, hip: 0.68, torso: 0.2, feet: 0.3 }), ...hold(1, { lean: 20, hip: 0.6, torso: 0.3 }), ...hold(4, { gone: true })]), []);
});

test("only what is meant for the coach gets an answer; the room's talk is left alone", async () => {
  const { meantForCoach } = await import("../src/lib/echo.ts");
  const quiet = { justAsked: false, talkButton: false };
  for (const yes of ["Hi, can you hear me?", "So what should I do right now?", "Does it count?", "what do you mean it doesn't count",
    "Coach, that was a deep one", "I'm ready", "how many are left", "my knee feels stiff", "Let's start", "that was ten reps"]) {
    assert.equal(meantForCoach(yes, quiet), true, yes);
  }
  // from the live log of 20 November: a friend in the room, half sentences, noise turned into words
  for (const no of ["Roma cannot touch me.", "It's a mechanic.", "the book of antoi, my words.", "No kid scores now.", "Just come.", "-a, and he has", "Oh, oh, oh, oh.", "Well, it's."]) {
    assert.equal(meantForCoach(no, quiet), false, no);
  }
  // right after the coach asked something, or after the Talk button, anything is an answer
  assert.equal(meantForCoach("Pretty good.", { justAsked: true, talkButton: false }), true);
  assert.equal(meantForCoach("Roma.", { justAsked: false, talkButton: true }), true);
  assert.equal(matchCommand("Think I fall."), "help");
  assert.equal(matchCommand("I think I fell"), "help");
});

// ---- The picture rules, on a stick figure seen through a pinhole camera (a phone standing upright, 65 degrees top
// to bottom, picture 9:16). Heights and distances in metres; the figure is 1.7 m tall with a torso of about 0.5 m.
import { fallPicture } from "../src/lib/pose/fall.ts";

type J = [number, number, number];             // across, height above the floor, distance from the camera
type Fig = { nose: J; sh: J; hip: J; knee: J; ankle: J };
const FY = 0.5 / Math.tan((32.5 * Math.PI) / 180);
const ASPECT = 9 / 16;
const at = (d: number, x = 0) => ({
  stand: { nose: [x, 1.6, d], sh: [x, 1.4, d], hip: [x, 0.92, d], knee: [x, 0.5, d], ankle: [x, 0.08, d] } as Fig,
  chair: { nose: [x, 1.2, d], sh: [x, 1.0, d], hip: [x, 0.5, d], knee: [x, 0.5, d - 0.42], ankle: [x, 0.08, d - 0.42] } as Fig,
  chairSide: { nose: [x + 0.1, 1.2, d], sh: [x, 1.0, d], hip: [x, 0.5, d], knee: [x + 0.42, 0.5, d], ankle: [x + 0.42, 0.08, d] } as Fig,
  squat: { nose: [x, 1.05, d - 0.2], sh: [x, 0.9, d - 0.15], hip: [x, 0.5, d + 0.2], knee: [x, 0.5, d - 0.2], ankle: [x, 0.08, d] } as Fig,
  bow: { nose: [x + 0.6, 0.5, d], sh: [x + 0.45, 0.7, d], hip: [x, 0.9, d], knee: [x, 0.5, d], ankle: [x, 0.08, d] } as Fig,
  shoes: { nose: [x + 0.5, 0.45, d], sh: [x + 0.4, 0.62, d], hip: [x, 0.5, d], knee: [x + 0.42, 0.5, d], ankle: [x + 0.42, 0.08, d] } as Fig,
  floorSit: { nose: [x, 0.78, d], sh: [x, 0.6, d], hip: [x, 0.1, d], knee: [x, 0.35, d - 0.35], ankle: [x, 0.08, d - 0.7] } as Fig,
  floorSitSide: { nose: [x, 0.78, d], sh: [x, 0.6, d], hip: [x, 0.1, d], knee: [x + 0.42, 0.12, d], ankle: [x + 0.84, 0.08, d] } as Fig,
  lieAcross: { nose: [x - 0.75, 0.15, d], sh: [x - 0.5, 0.15, d], hip: [x, 0.12, d], knee: [x + 0.42, 0.12, d], ankle: [x + 0.84, 0.08, d] } as Fig,
  lieFeetFirst: { nose: [x, 0.15, d + 0.75], sh: [x, 0.15, d + 0.5], hip: [x, 0.12, d], knee: [x, 0.12, d - 0.42], ankle: [x, 0.08, d - 0.84] } as Fig,
  lieHeadFirst: { nose: [x, 0.15, d - 0.75], sh: [x, 0.15, d - 0.5], hip: [x, 0.12, d], knee: [x, 0.12, d + 0.42], ankle: [x, 0.08, d + 0.84] } as Fig,
});
/** One frame for the fall watch: the figure as the pose model would report it, or null when it is out of the picture. */
function shot(f: Fig, cam = 0.8, turned = false) {
  const px = (j: J) => ({ x: 0.5 + (j[0] / j[2]) * FY / ASPECT, y: 0.5 + ((cam - j[1]) / j[2]) * FY, visibility: 1 });
  const sh = px(f.sh), hip = px(f.hip), nose = px(f.nose), knee = px(f.knee), ankle = px(f.ankle);
  if (sh.y > 1 || sh.y < 0 || f.sh[2] < 0.3) return null;                      // shoulders out of the picture: lost
  const out = (q: { x: number; y: number; visibility: number }) => ({ ...q, visibility: q.y > 1.02 || q.y < -0.02 ? 0.1 : 1 });
  const marks = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  const half = (j: J) => ((turned ? 0.05 : 0.18) / j[2]) * FY / ASPECT;   // half the shoulder width (facing the camera, or side-on)
  marks[0] = out(nose);
  for (const [l, r, q] of [[11, 12, sh], [23, 24, hip], [25, 26, knee], [27, 28, ankle]] as const) {
    marks[l] = out({ ...q, x: q.x - half(q === sh ? f.sh : f.hip) }); marks[r] = out({ ...q, x: q.x + half(q === sh ? f.sh : f.hip) });
  }
  const v = [f.sh[0] - f.hip[0], f.sh[1] - f.hip[1], f.sh[2] - f.hip[2]];
  const lean = (Math.acos(Math.max(-1, Math.min(1, v[1] / Math.hypot(v[0], v[1], v[2])))) * 180) / Math.PI;
  return { lean, hipY: hip.y, torso: Math.hypot((sh.x - hip.x) * ASPECT, sh.y - hip.y), feet: f.hip[1] - f.ankle[1], picture: fallPicture(marks, ASPECT) };
}
/** Play poses through a fresh watch: [figure or null (nobody), seconds]. A move between two poses takes `move` s. */
function play(steps: [Fig | null, number][], cam = 0.8, move = 0.5, fps = 25): number {
  const w = new FallWatch();
  let t = 0, hits = 0, prev: Fig | null = null;
  const feed = (f: Fig | null) => {
    const s = f ? shot(f, cam) : null;
    if (s ? w.seen(t, s.lean, s.hipY, { torso: s.torso, hipsAboveFeet: s.feet, picture: s.picture }) : w.missing(t)) hits++;
    t += 1 / fps;
  };
  for (const [fig, seconds] of steps) {
    if (fig && prev) {
      const n = Math.round(move * fps);
      for (let i = 1; i < n; i++) {
        const k = i / n;
        const mix = (a: J, b: J): J => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
        feed({ nose: mix(prev.nose, fig.nose), sh: mix(prev.sh, fig.sh), hip: mix(prev.hip, fig.hip), knee: mix(prev.knee, fig.knee), ankle: mix(prev.ankle, fig.ankle) });
      }
    }
    for (let i = 0; i < Math.round(seconds * fps); i++) feed(fig);
    prev = fig;
  }
  return hits;
}

test("in the picture: lying or sitting on the floor asks, from any side and any camera height", () => {
  for (const cam of [0.3, 0.8, 1.1]) {
    for (const d of [2, 2.6, 3.2]) {
      const p = at(d);
      for (const [name, down] of Object.entries({ across: p.lieAcross, feetFirst: p.lieFeetFirst, headFirst: p.lieHeadFirst, sit: p.floorSit, sitSide: p.floorSitSide })) {
        assert.equal(play([[p.stand, 3], [down, 4]], cam), 1, `${name} at ${d} m, camera at ${cam} m`);
        // slowly, the way people lie down for a demo: three seconds on the way
        assert.equal(play([[p.stand, 3], [down, 4]], cam, 3), 1, `${name} slowly at ${d} m, camera at ${cam} m`);
      }
    }
  }
});

test("in the picture: a session that starts on the chair still catches the floor", () => {
  const p = at(2.4);
  // walks to the chair from next to the phone (the body is big at first), sits a long time, then ends up on the floor
  const walk: [Fig | null, number][] = [[at(1.2).stand, 0.5], [at(1.8).stand, 0.3], [p.stand, 0.6], [p.chair, 20]];
  assert.equal(play([...walk, [p.lieAcross, 4]]), 1);
  assert.equal(play([...walk, [p.floorSit, 4]]), 1);
  assert.equal(play([...walk, [p.stand, 1], [p.chair, 2], [p.stand, 1], [p.chair, 2]]), 0);
});

test("in the picture: going down out of the bottom of the picture and staying gone asks", () => {
  // a laptop on a table, the feet cut off: the floor at the spot is below the picture
  const p = at(1.3);
  assert.equal(shot(p.lieAcross, 1.1), null);
  assert.equal(play([[p.stand, 3], [p.lieAcross, 0.2], [null, 4]], 1.1), 1);
  assert.equal(play([[p.stand, 3], [p.floorSit, 0.2], [null, 4]], 1.1, 1.5), 1);
});

test("in the picture, not a fall: exercises, chairs, bows, shoes, coming close, walking away or off", () => {
  for (const cam of [0.3, 0.8, 1.1]) {
    const p = at(2.4);
    const reps = (down: Fig, hold: number): [Fig | null, number][] => Array.from({ length: 6 }, () => [[p.stand, 1], [down, hold]] as [Fig, number][]).flat();
    assert.equal(play([[p.stand, 2], ...reps(p.chair, 2)], cam), 0, `sit-to-stand, camera ${cam}`);
    assert.equal(play([[p.stand, 2], ...reps(p.chairSide, 2)], cam), 0, `sit-to-stand side-on, camera ${cam}`);
    assert.equal(play([[p.stand, 2], ...reps(p.squat, 1.5)], cam), 0, `squats, camera ${cam}`);
    assert.equal(play([[p.stand, 2], [p.chair, 30]], cam), 0, `a long rest on the chair, camera ${cam}`);
    assert.equal(play([[p.stand, 2], [p.chair, 3], [null, 6], [p.chair, 2]], cam), 0, `hidden while seated, camera ${cam}`);
    assert.equal(play([[p.stand, 2], [p.bow, 3], [p.stand, 1]], cam), 0, `picking something up, camera ${cam}`);
    assert.equal(play([[p.stand, 2], [p.chairSide, 2], [p.shoes, 4], [p.chairSide, 1]], cam), 0, `tying shoes on the chair, camera ${cam}`);
    // walks up to the phone, taps it, walks back
    assert.equal(play([[p.stand, 2], [at(1.6).stand, 0.3], [at(0.9).stand, 0.3], [at(0.5).stand, 2], [null, 3], [at(0.9).stand, 0.3], [p.stand, 2]], cam, 0.7), 0, `to the phone and back, camera ${cam}`);
    // walks away from the camera, out through a door at the back
    assert.equal(play([[p.stand, 2], [at(4).stand, 0.5], [at(6).stand, 0.5], [null, 5]], cam, 1.5), 0, `walking away, camera ${cam}`);
    // walks off to the side
    assert.equal(play([[p.stand, 2], [at(2.4, 0.9).stand, 0.2], [null, 5]], cam, 1), 0, `walking off, camera ${cam}`);
    // down for a moment, up again
    assert.equal(play([[p.stand, 2], [p.floorSit, 0.4], [p.stand, 2]], cam), 0, `down and straight up, camera ${cam}`);
  }
});
