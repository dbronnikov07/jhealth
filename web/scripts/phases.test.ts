// Recovery phases: the same four steps for everyone, criteria per operation, only the physio moves a patient on.
// Run: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cameraTargetsMet, checkCriteria, clampPhase, coachLine, DONE, earnedClearances, nextClearance, PHASES, PROTOCOLS,
  protocolFor, signOffMessage, standingSignOffs,
} from "../src/lib/phases.ts";

test("each operation gets its own protocol, anything else the general one", () => {
  assert.equal(protocolFor("Total knee replacement").key, "tkr");
  assert.equal(protocolFor("Total hip replacement").key, "thr");
  assert.equal(protocolFor("ACL reconstruction").key, "acl");
  assert.equal(protocolFor("Knee osteoarthritis").key, "oa");
  assert.equal(protocolFor("TKA, right").key, "tkr");
  assert.equal(protocolFor("Other").key, "general");
  assert.equal(protocolFor("").key, "general");
  assert.equal(protocolFor(null).key, "general");
});

test("every protocol has the same four phases, so the layout is the same for everyone", () => {
  for (const p of PROTOCOLS) {
    assert.equal(p.phases.length, PHASES, p.key);
    assert.equal(p.phases[0].clearance, null, `${p.key}: everyone starts in phase 1, nothing to unlock`);
    for (const ph of p.phases.slice(1)) assert.ok(ph.clearance, `${p.key}/${ph.name} needs a clearance`);
    for (const ph of p.phases) {
      assert.ok(ph.criteria.length >= 2, `${p.key}/${ph.name} criteria`);
      assert.ok(ph.wins.length >= 3, `${p.key}/${ph.name} wins`);
      for (const w of ph.wins) assert.ok(w.length <= 120, w);
    }
  }
  assert.equal(nextClearance(protocolFor("ACL reconstruction"), 2), "Clear to jog");
});

test("the camera checks its targets; the rest is left to the physio", () => {
  const phase = protocolFor("Total knee replacement").phases[0];
  const c = checkCriteria(phase, { bend: 92, days: 3, quality: 70 });
  assert.equal(c.find((x) => x.text === "Knee bends to 90°")?.met, true);
  assert.equal(c.find((x) => x.text === "Knee bends to 90°")?.reading, "92°");
  assert.equal(c.find((x) => x.text === "Knee straightens fully")?.met, null);
  assert.equal(cameraTargetsMet(c), true);
  assert.equal(cameraTargetsMet(checkCriteria(phase, { bend: 75, days: 3, quality: 70 })), false);
  assert.equal(checkCriteria(phase, { bend: null, days: null, quality: null }).find((x) => x.measure)?.reading, "not measured yet");
  // nothing measurable: never "ready" on the camera's word alone
  assert.equal(cameraTargetsMet(checkCriteria(protocolFor("Total hip replacement").phases[0], { bend: 120, days: 7, quality: 99 })), false);
});

test("phase numbers stay between 1 and 5", () => {
  assert.equal(clampPhase(0), 1);
  assert.equal(clampPhase("3"), 3);
  assert.equal(clampPhase(9), DONE);
  assert.equal(clampPhase("x"), 1);
});

test("clearances earned so far, in order", () => {
  const p = protocolFor("ACL reconstruction");
  assert.deepEqual(earnedClearances(p, 1), []);
  assert.deepEqual(earnedClearances(p, 3), ["Clear for the exercise bike", "Clear to jog"]);
  assert.deepEqual(earnedClearances(p, DONE).at(-1), "Clear to return to sport");
});

test("the sign-off message names the milestone and never promises a date", () => {
  const p = protocolFor("ACL reconstruction");
  const m = signOffMessage(p, "Dana", 2, 3);
  assert.match(m, /Great news, Dana!/);
  assert.match(m, /Milestone reached: clear to jog\./);
  assert.match(m, /phase 3 of 4: Running/);
  assert.doesNotMatch(m, /week|day|date/i);
  assert.match(signOffMessage(p, "Dana", 3, 2), /moved your plan back to phase 2/);
  assert.match(signOffMessage(p, "Dana", 4, DONE), /Clear to return to sport/);
});

test("the coach knows the next milestone but is told not to promise it", () => {
  const line = coachLine(protocolFor("Total knee replacement"), 2);
  assert.match(line, /phase 2 of 4/);
  assert.match(line, /Clear for walks outside/);
  assert.match(line, /never promise/);
});

test("a move back takes back the sign-offs above it", () => {
  const at = (d: number) => new Date(Date.UTC(2026, 10, d));
  const kept = standingSignOffs([
    { at: at(3), from: 1, to: 2, note: null },
    { at: at(10), from: 2, to: 3, note: null },
    { at: at(11), from: 3, to: 2, note: null },   // the physio stepped back
  ]);
  assert.deepEqual(kept.map((s) => s.to), [2]);
  assert.deepEqual(standingSignOffs([{ at: at(1), from: 1, to: 2, note: null }]).map((s) => s.to), [2]);
});
