// The demo phone's input checks and conversions (lib/demo-phone.ts), tested as an attacker would try them.
// Run: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { demoWebhook, fictionalPhone, MAX_TEXT, parseDemoRequest, toPhoneMessage } from "../src/lib/demo-phone.ts";

const token = "a".repeat(64);

test("only a well-formed request gets through", () => {
  assert.equal(parseDemoRequest(null).ok, false);
  assert.equal(parseDemoRequest("hi").ok, false);
  assert.equal(parseDemoRequest({ token: "short", action: "list" }).ok, false);
  assert.equal(parseDemoRequest({ token: "' or 1=1 --".padEnd(64, "x"), action: "list" }).ok, false);
  assert.equal(parseDemoRequest({ token: token.toUpperCase(), action: "list" }).ok, false);
  assert.equal(parseDemoRequest({ token, action: "delete" }).ok, false);
  assert.deepEqual(parseDemoRequest({ token, action: "list", extra: "ignored" }), { ok: true, token, action: "list" });
});

test("a message is text or one of the coach's own buttons, never both, never empty or huge", () => {
  assert.equal(parseDemoRequest({ token, action: "send" }).ok, false);
  assert.equal(parseDemoRequest({ token, action: "send", text: "hi", button: "why_time" }).ok, false);
  assert.equal(parseDemoRequest({ token, action: "send", text: "   " }).ok, false);
  assert.equal(parseDemoRequest({ token, action: "send", text: 42 }).ok, false);
  assert.equal(parseDemoRequest({ token, action: "send", text: "x".repeat(MAX_TEXT + 1) }).ok, false);
  assert.equal(parseDemoRequest({ token, action: "send", button: "delete_patient" }).ok, false);
  assert.equal(parseDemoRequest({ token, action: "send", button: "__proto__" }).ok, false);
  const text = parseDemoRequest({ token, action: "send", text: "  sharp pain\u0000, 8/10 \u0007 " });
  assert.ok(text.ok && text.action === "send" && text.text === "sharp pain, 8/10");
  const tap = parseDemoRequest({ token, action: "send", button: "why_pain" });
  assert.ok(tap.ok && tap.action === "send" && tap.button?.title === "It hurt");
});

test("the webhook body is what WhatsApp would send, so the same code handles it", () => {
  const now = new Date("2026-11-21T15:00:00Z");
  const text = demoWebhook("+14165550100", { text: "hello", button: null }, "demo.in.1", now);
  const m = text.entry[0].changes[0].value.messages[0];
  assert.equal(text.entry[0].changes[0].field, "messages");
  assert.equal(m.from, "14165550100");
  assert.equal(m.type, "text");
  assert.deepEqual((m as { text: unknown }).text, { body: "hello" });
  assert.equal(m.timestamp, String(Date.parse("2026-11-21T15:00:00Z") / 1000));
  const tap = demoWebhook("+14165550100", { text: null, button: { id: "time_evening", title: "Evening" } }, "demo.in.2", now);
  assert.deepEqual((tap.entry[0].changes[0].value.messages[0] as { interactive: unknown }).interactive,
    { type: "button_reply", button_reply: { id: "time_evening", title: "Evening" } });
});

test("the phone shows only the coach's own buttons and builds the Start button itself", () => {
  const out = toPhoneMessage({
    id: "1", direction: "out", body: "When would you like your reminder?", at: "2026-11-21T15:00:00Z",
    payload: { type: "welcome", quick_replies: [{ id: "time_morning", title: "Morning" }, { id: "evil", title: "<script>" }, { id: "why_pain", title: "renamed" }] },
  });
  assert.deepEqual(out.buttons.map((b) => b.id), ["time_morning", "why_pain"]);
  assert.equal(out.buttons[1].title, "It hurt");            // the title comes from our list, not from the database
  assert.equal(out.mine, false);
  assert.equal(out.start, false);
  assert.equal(toPhoneMessage({ id: "2", direction: "out", body: "Your plan", at: new Date(), payload: { type: "new_plan" } }).start, true);
  assert.equal(toPhoneMessage({ id: "3", direction: "out", body: "Go", at: new Date(), payload: { type: "coach_reply", start_button: true } }).ai, true);
  const mine = toPhoneMessage({ id: "4", direction: "in", body: "hi", at: new Date(), payload: { quick_replies: [{ id: "time_morning" }] } });
  assert.equal(mine.mine, true);
  assert.deepEqual(mine.buttons, []);
  assert.equal(mine.start, false);
});

test("demo patients get fictional numbers that never ring anyone", () => {
  assert.equal(fictionalPhone([]), "+14165550100");
  assert.equal(fictionalPhone(["+14165550100", "+14165550101"]), "+14165550102");
  const all = Array.from({ length: 100 }, (_, i) => `+1416555${String(100 + i).padStart(4, "0")}`);
  assert.equal(fictionalPhone(all), null);
});
