import assert from "node:assert/strict";
import { test } from "node:test";
import { coachVoice, repSpokenText } from "../src/lib/speech.ts";

test("coach prefers a natural local English voice", () => {
  const chosen = coachVoice([
    { name: "Google US English", lang: "en-US", localService: false },
    { name: "Eddy (English (US))", lang: "en_US", localService: true },
    { name: "Amelie", lang: "fr-CA", localService: true },
  ]);
  assert.equal(chosen?.name, "Eddy (English (US))");
});

test("coach keeps a local Canadian English fallback over a remote generic voice", () => {
  const chosen = coachVoice([
    { name: "Google UK English Female", lang: "en-GB", localService: false },
    { name: "System English", lang: "en-CA", localService: true },
  ]);
  assert.equal(chosen?.name, "System English");
  assert.equal(coachVoice([{ name: "French", lang: "fr-CA", localService: true }]), null);
});

test("rep announcements sound like coaching rather than a number stream", () => {
  assert.equal(repSpokenText(1, null, null), "Nice. That's one.");
  assert.equal(repSpokenText(4, "not_deep", "A little deeper"), "Rep 4. A little deeper.");
});
