// Check-up visits: clinic time, the words the patient reads, and the buttons. Run: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { quickReplyAction } from "../src/lib/quick-replies.ts";
import {
  AVAILABILITY, clinicInputValue, clinicTimeToUtc, confirmText, defaultSlots, proposalText, slotLong, slotShort, visitButtons, visitCoachLine,
} from "../src/lib/visits.ts";

test("a time typed at the clinic is Toronto time, winter and summer", () => {
  assert.equal(clinicTimeToUtc("2026-11-26T15:00")?.toISOString(), "2026-11-26T20:00:00.000Z");   // EST, UTC-5
  assert.equal(clinicTimeToUtc("2026-07-02T09:30")?.toISOString(), "2026-07-02T13:30:00.000Z");   // EDT, UTC-4
  assert.equal(clinicInputValue(new Date("2026-11-26T20:00:00Z")), "2026-11-26T15:00");
  assert.equal(clinicTimeToUtc("tomorrow at three"), null);
  assert.equal(clinicTimeToUtc("2026-13-40T25:00"), null);
});

test("times read naturally, and fit on a WhatsApp button", () => {
  const thu = new Date("2026-11-26T20:00:00Z");
  assert.equal(slotLong(thu), "Thursday 26 November at 3:00 pm");
  assert.equal(slotShort(thu), "Thu 26, 3:00 pm");
  assert.equal(slotLong(new Date("2026-11-27T15:00:00Z")), "Friday 27 November at 10:00 am");
  assert.equal(slotLong(new Date("2026-11-27T17:00:00Z")), "Friday 27 November at 12:00 pm");
  // the longest possible label still fits (20 characters is WhatsApp's limit)
  for (const iso of ["2026-09-30T14:00:00Z", "2026-12-23T15:30:00Z", "2027-01-20T17:45:00Z"]) assert.ok(slotShort(new Date(iso)).length <= 20, slotShort(new Date(iso)));
  for (const b of visitButtons([thu, new Date("2026-11-27T15:00:00Z")])) assert.ok(b.title.length <= 20, b.title);
});

test("the proposal offers the clinic's times and a call, nothing else", () => {
  const slots = [new Date("2026-11-26T20:00:00Z"), new Date("2026-11-27T15:00:00Z")];
  const text = proposalText({ firstName: "Margaret", doctor: "Dr. Demo, PT", clinic: "Motiva Health demo clinic", slots, reason: "phase 1 review" });
  assert.match(text, /^Hi Margaret, Dr\. Demo, PT would like to see you for a check-up at Motiva Health demo clinic \(phase 1 review\)\./);
  assert.match(text, /1\. Thursday 26 November at 3:00 pm\n2\. Friday 27 November at 10:00 am/);
  assert.ok(text.length <= 1024);          // WhatsApp's limit for a message with buttons
  assert.deepEqual(visitButtons(slots).map((b) => b.id), ["visit_1", "visit_2", "visit_call"]);
  assert.deepEqual(visitButtons(slots.slice(0, 1)).map((b) => b.id), ["visit_1", "visit_call"]);
  assert.match(confirmText({ firstName: "Margaret", doctor: "Dr. Demo, PT", clinic: null, slot: slots[0] }), /^Booked, Margaret: Thursday 26 November at 3:00 pm with Dr\. Demo, PT\./);
});

test("a tap picks an offered time or asks for a call", () => {
  assert.deepEqual(quickReplyAction("visit_1"), { kind: "visit_pick", index: 0 });
  assert.deepEqual(quickReplyAction("visit_2"), { kind: "visit_pick", index: 1 });
  assert.deepEqual(quickReplyAction("visit_call"), { kind: "visit_call" });
  assert.equal(quickReplyAction("visit_3"), null);
});

test("the default times are the next two working days, 10 am and 3 pm", () => {
  const [a, b] = defaultSlots(new Date("2026-11-20T21:00:00Z"));      // a Friday afternoon in Toronto
  assert.equal(a, "2026-11-23T10:00");                                 // Monday
  assert.equal(b, "2026-11-24T15:00");                                 // Tuesday
});

test("words about when they can come are kept for the clinic; other messages are not", () => {
  assert.ok(AVAILABILITY.test("Mornings don't work, my daughter can drive me after three"));
  assert.ok(AVAILABILITY.test("I can't on Thursday"));
  assert.ok(!AVAILABILITY.test("How many reps should I do today?"));
});

test("the coach is told what is open, and that it cannot book", () => {
  const line = visitCoachLine({ status: "proposed", options: ["2026-11-26T20:00:00.000Z", "2026-11-27T15:00:00.000Z"], chosenAt: null })!;
  assert.match(line, /Thursday 26 November at 3:00 pm or Friday 27 November at 10:00 am/);
  assert.match(line, /Never invent a time; never say it is booked/);
  assert.match(visitCoachLine({ status: "confirmed", options: [], chosenAt: new Date("2026-11-26T20:00:00Z") })!, /booked for Thursday 26 November at 3:00 pm/);
  assert.equal(visitCoachLine({ status: "done", options: [], chosenAt: null }), null);
});
