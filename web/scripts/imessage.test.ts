// iMessage formatting and parsing (lib/imessage/format.ts). Run: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { formatForIMessage, maskHandle, matchQuickReply, normalizeHandle, textUsLink } from "../src/lib/imessage/format.ts";
import { TIME_BUTTONS, WHY_BUTTONS } from "../src/lib/quick-replies.ts";

test("iMessage addresses are stored in one form, and junk is refused", () => {
  assert.equal(normalizeHandle("+1 (416) 555-0142"), "+14165550142");
  assert.equal(normalizeHandle("416-555-0142"), "+14165550142");
  assert.equal(normalizeHandle("14165550142"), "+14165550142");
  assert.equal(normalizeHandle("+447700900123"), "+447700900123");
  assert.equal(normalizeHandle("  Margaret.T@iCloud.com "), "margaret.t@icloud.com");
  for (const bad of ["", "hello", "123", "+0123456789", "a@b", "'; drop table patients;--", 42, null]) {
    assert.equal(normalizeHandle(bad), null, String(bad));
  }
  assert.equal(maskHandle("+14165550142"), "+1 ••• ••• 0142");
  assert.equal(maskHandle("margaret@icloud.com"), "m•••@icloud.com");
});

test("buttons become numbered replies and the Start button becomes a link", () => {
  const welcome = formatForIMessage("When would you like your daily reminder?", { type: "welcome", quick_replies: TIME_BUTTONS }, "https://x/s/t");
  assert.equal(welcome, "When would you like your daily reminder?\n\nReply with a number:\n1. Morning\n2. Afternoon\n3. Evening");
  const plan = formatForIMessage("Hi Margaret, your plan is ready.", { type: "new_plan" }, "https://jhealth.example/s/abc");
  assert.match(plan, /\n\nStart today's session: https:\/\/jhealth\.example\/s\/abc$/);
  assert.equal(formatForIMessage("Rest today.", { type: "coach_reply", start_button: false }, "https://x"), "Rest today.");
  assert.equal(formatForIMessage("Go!", { start_button: true }, null), "Go!"); // no link known: no dangling text
});

test("a reply is matched to the offered answer by number or by word", () => {
  assert.equal(matchQuickReply("2", TIME_BUTTONS)?.id, "time_afternoon");
  assert.equal(matchQuickReply(" 3. ", TIME_BUTTONS)?.id, "time_evening");
  assert.equal(matchQuickReply("Morning!", TIME_BUTTONS)?.id, "time_morning");
  assert.equal(matchQuickReply("it hurt", WHY_BUTTONS)?.id, "why_pain");
  assert.equal(matchQuickReply("4", TIME_BUTTONS), null);
  assert.equal(matchQuickReply("morning is usually best but my knee hurts", TIME_BUTTONS), null);
  assert.equal(matchQuickReply("2", []), null);
});

test("the Text us link opens Messages with jHealth and a first message", () => {
  assert.equal(textUsLink("jhealth.coach@gmail.com", "Hi jHealth!"), "sms:jhealth.coach@gmail.com?&body=Hi%20jHealth!");
});
