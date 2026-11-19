// Streaks, milestones, reminders and nudges: what a patient can receive, checked word by word. Run: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { celebrations, currentStreak, goalPhrase, reminderKind, reminderText, type SessionFacts } from "../src/lib/engagement.ts";

test("a streak counts consecutive days, and survives until tonight", () => {
  assert.equal(currentStreak(["2026-11-19", "2026-11-18", "2026-11-17", "2026-11-15"], "2026-11-19"), 3);
  assert.equal(currentStreak(["2026-11-18", "2026-11-17"], "2026-11-19"), 2);      // not yet today: still alive
  assert.equal(currentStreak(["2026-11-17"], "2026-11-19"), 0);                    // missed yesterday
  assert.equal(currentStreak([], "2026-11-19"), 0);
  assert.equal(currentStreak(["2026-12-01", "2026-11-30"], "2026-12-01"), 2);      // across a month end
});

const base: SessionFacts = {
  firstName: "Maria", totalSessions: 4, streak: 1, streakBefore: 0, measureLabel: "deepest knee bend",
  measure: 90, previousBest: 90, firstMeasure: 85, quality: 0.7, previousBestQuality: 0.75,
};

test("celebrations: first session, streak marks, personal bests, at most two lines", () => {
  assert.match(celebrations({ ...base, totalSessions: 1, previousBest: null, firstMeasure: null })[0], /first session/);
  assert.deepEqual(celebrations(base), []);
  assert.match(celebrations({ ...base, streak: 3, streakBefore: 2 })[0], /3 days in a row/);
  assert.deepEqual(celebrations({ ...base, streak: 3, streakBefore: 3 }), []);           // a second session today: no repeat
  assert.match(celebrations({ ...base, measure: 96 })[0], /personal best: 96° deepest knee bend/);
  assert.match(celebrations({ ...base, quality: 0.85 })[0], /smoothest session yet \(85\/100\)/);
  assert.equal(celebrations({ ...base, totalSessions: 10, streak: 7, streakBefore: 6, measure: 99, quality: 0.9 }).length, 2);
});

test("every message stays positive: no scolding words", () => {
  const ctx = { firstName: "Maria", goal: "Wants to walk the dog around the block again", exercises: ["Sit-to-stand", "Arm raise to the side"], streak: 4, daysSinceLastSession: 1, dayNumber: 0 };
  const texts = [0, 1, 2, 3].flatMap((d) => [
    reminderText("reminder", { ...ctx, dayNumber: d }),
    reminderText("comeback", { ...ctx, dayNumber: d, daysSinceLastSession: 5 }),
    reminderText("weekly", ctx, { sessions: 3, planned: 5, best: null }),
  ]);
  for (const t of texts) {
    assert.doesNotMatch(t, /\b(fail|failed|bad|wrong|lazy|missed out|disappoint|should have)\b/i, t);
    assert.ok(t.length < 400, t);
  }
});

test("reminders use the patient's own goal and streak", () => {
  const t = reminderText("reminder", { firstName: "Maria", goal: "Wants to walk the dog around the block again", exercises: ["Sit-to-stand"], streak: 4, daysSinceLastSession: 1, dayNumber: 0 });
  assert.match(t, /Maria/);
  assert.match(t, /4-day streak/);
  assert.match(t, /closer to walking the dog around the block again/);
  assert.match(t, /Tap Start/);
  assert.equal(goalPhrase("Wants to dance at her granddaughter's wedding in March"), "dancing at her granddaughter's wedding in March");
  assert.equal(goalPhrase("Hopes to get back to gardening"), "getting back to gardening");
  assert.equal(goalPhrase("Prefers mornings"), null);
});

test("which message, if any: none after exercising today, a gentle comeback after 3 days away, a weekly card on Sunday", () => {
  assert.equal(reminderKind({ daysSinceLastSession: 0, sessionToday: true, weekday: 3 }), null);
  assert.equal(reminderKind({ daysSinceLastSession: 1, sessionToday: false, weekday: 3 }), "reminder");
  assert.equal(reminderKind({ daysSinceLastSession: 4, sessionToday: false, weekday: 3 }), "comeback");
  assert.equal(reminderKind({ daysSinceLastSession: 1, sessionToday: false, weekday: 0 }), "weekly");
  assert.equal(reminderKind({ daysSinceLastSession: null, sessionToday: false, weekday: 0 }), "reminder");
});

test("quick-reply taps: reminder time, and what got in the way", async () => {
  const { quickReplyAction, TIME_BUTTONS, WHY_BUTTONS } = await import("../src/lib/quick-replies.ts");
  assert.deepEqual(quickReplyAction("time_morning"), { kind: "set_time", hour: 9, reply: quickReplyAction("time_morning")!.kind === "set_time" ? (quickReplyAction("time_morning") as { reply: string }).reply : "" });
  assert.equal((quickReplyAction("time_evening") as { hour: number }).hour, 18);
  assert.deepEqual(quickReplyAction("why_pain"), { kind: "pain" });                     // always reaches the physio
  assert.deepEqual((quickReplyAction("why_forgot") as { buttons: unknown }).buttons, TIME_BUTTONS); // offer another time
  assert.equal((quickReplyAction("why_time") as { startButton: boolean }).startButton, true);
  assert.equal(quickReplyAction("something_else"), null);
  assert.equal(quickReplyAction(undefined), null);
  for (const b of [...TIME_BUTTONS, ...WHY_BUTTONS]) assert.ok(b.title.length <= 20, b.title);   // WhatsApp's limit
});

test("the weekly goal line", async () => {
  const { weeklyLine } = await import("../src/lib/engagement.ts");
  assert.equal(weeklyLine(2, 5, true), "This week: 2 of 5 planned days.");
  assert.match(weeklyLine(5, 5, true), /Weekly goal reached: 5 of 5/);
  assert.equal(weeklyLine(5, 5, false), "This week: 5 of 5 planned days.");            // a second session the same day
  assert.equal(weeklyLine(1, 0, true), "");
});
