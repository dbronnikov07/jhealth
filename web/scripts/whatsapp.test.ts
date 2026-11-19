// Unit tests for the pure WhatsApp logic. Run:  npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { assessMessage, painScore } from "../src/lib/safety.ts";
import { buttonsPayload, ctaPayload, textPayload } from "../src/lib/whatsapp/payloads.ts";
import { isValidSignature, signatureFor } from "../src/lib/whatsapp/signature.ts";

test("pain scores are read the way patients write them", () => {
  const cases: [string, number | null][] = [
    ["sharp pain, 8 out of 10", 8],
    ["my knee hurts a lot today, like 7 out of 10, after yesterday", 7],
    ["pain 9/10", 9],
    ["8/10 pain this morning", 8],
    ["pain is 3", 3],
    ["pain went from 8/10 to 3/10", 3],
    ["no pain today!", null],
    ["did 8 out of 10 reps, knee a bit sore", null],
    ["sore for 2 days", null],
    ["it hurts 3 times a day", null],
    ["done 10 squats", null],
  ];
  for (const [text, expected] of cases) assert.equal(painScore(text), expected, text);
});

test("high pain stops coaching, low pain does not", () => {
  assert.equal(assessMessage("sharp pain, 8 out of 10")?.level, "high_pain");
  assert.equal(assessMessage("the pain is unbearable")?.level, "high_pain");
  assert.equal(assessMessage("pain 4/10, fine")?.level, undefined);
  assert.equal(assessMessage("hi")?.level, undefined);
  assert.equal(assessMessage("Done! 20 reps")?.level, undefined);
  assert.match(assessMessage("pain 8/10")!.reply, /Health811/);
});

test("red flags win over everything else", () => {
  assert.equal(assessMessage("I have chest pain")?.level, "red_flag");
  assert.equal(assessMessage("my calf is swollen and hot")?.level, "red_flag");
  assert.equal(assessMessage("I can't breathe properly")?.level, "red_flag");
  assert.equal(assessMessage("the wound is oozing")?.level, "red_flag");
  assert.equal(assessMessage("I fell down the stairs")?.level, "red_flag");
  assert.equal(assessMessage("I fell asleep after the session")?.level, undefined);
  assert.match(assessMessage("chest pain")!.reply, /911/);
});

test("payloads follow Meta's format and limits", () => {
  const me = { phone: "+14165550100", userId: null };
  const cta = ctaPayload(me, "x".repeat(2000), "Start session now please", "https://example.test/s/abc");
  assert.equal(cta.to, "14165550100");
  assert.equal(cta.interactive.type, "cta_url");
  assert.equal(cta.interactive.body.text.length, 1024);
  assert.equal(cta.interactive.action.parameters.display_text.length, 20);
  const byId = textPayload({ phone: null, userId: "CA.123" }, "hi") as Record<string, unknown>;
  assert.equal(byId.recipient, "CA.123");
  assert.equal(byId.to, undefined);
  const buttons = buttonsPayload(me, "How did it go?", [
    { id: "done", title: "Done" }, { id: "hard", title: "Too hard" }, { id: "hurts", title: "It hurts" }, { id: "x", title: "fourth" },
  ]);
  assert.equal(buttons.interactive.action.buttons.length, 3);
  assert.throws(() => textPayload({ phone: null, userId: null }, "hi"));
});

test("webhook signatures: only Meta's own are accepted", () => {
  const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
  const good = signatureFor(body, "app-secret");
  assert.ok(isValidSignature(body, good, "app-secret"));
  assert.ok(!isValidSignature(body, good, "another-secret"));
  assert.ok(!isValidSignature(body + " ", good, "app-secret"));
  assert.ok(!isValidSignature(body, null, "app-secret"));
  assert.ok(!isValidSignature(body, "sha256=short", "app-secret"));
});
