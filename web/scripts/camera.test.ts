import assert from "node:assert/strict";
import { test } from "node:test";
import { ANALYSIS_INTERVAL_MS, cameraConstraints, isPhoneDevice, poseSetupIssue, type ScreenLandmark } from "../src/lib/pose/camera.ts";

function visibleBody(): ScreenLandmark[] {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0.99 }));
}

test("camera preflight accepts a complete body and blocks cropped joints", () => {
  const body = visibleBody();
  assert.equal(poseSetupIssue("squat", body), null);
  assert.equal(poseSetupIssue("arm_raise", body), null);

  body[27] = { x: 0.5, y: 1.04, visibility: 0.99 };
  assert.match(poseSetupIssue("sit_to_stand", body) ?? "", /feet/);

  body[27] = { x: 0.5, y: 0.5, visibility: 0.99 };
  body[15] = { x: 0.5, y: 0.5, visibility: 0.1 };
  body[16] = { x: 0.5, y: 0.5, visibility: 0.1 };
  assert.match(poseSetupIssue("arm_raise", body) ?? "", /hands and wrists/);

  // A side-on knee extension often hides the far leg. One complete working leg is enough.
  body[15] = { x: 0.5, y: 0.5, visibility: 0.99 };
  body[16] = { x: 0.5, y: 0.5, visibility: 0.99 };
  body[26] = { x: 0.5, y: 0.5, visibility: 0.1 };
  body[28] = { x: 0.5, y: 0.5, visibility: 0.1 };
  assert.equal(poseSetupIssue("seated_knee_extension", body), null);
});

test("phone camera preferences favour a portrait full-body view without forcing it", () => {
  assert.equal(isPhoneDevice("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), true);
  assert.equal(isPhoneDevice("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)"), false);
  assert.deepEqual(cameraConstraints(true).width, { ideal: 720 });
  assert.deepEqual(cameraConstraints(true).height, { ideal: 1280 });
  assert.deepEqual(cameraConstraints(false).width, { ideal: 1280 });
  assert.equal(ANALYSIS_INTERVAL_MS, 1000 / 15);
});
