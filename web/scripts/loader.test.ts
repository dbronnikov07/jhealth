// Which model the session page picks, with a fake file server instead of the real one.
import assert from "node:assert/strict";
import { test } from "node:test";
import { describeModel, loadModel } from "../src/lib/pose/loader.ts";

const serve = (files: string[]) => async (file: string) =>
  files.includes(file) ? ({ exercise: file.replace(/_(demo|camera)$/, "").replace(/_/g, " ") } as never) : null;

test("sit-to-stand: own clips, then calibrated, then its own, then the squat stand-in", async () => {
  const pick = async (files: string[]) => (await loadModel("sit_to_stand", serve(files)))?.file;
  assert.equal(await pick(["sit_to_stand_demo", "sit_to_stand_camera", "squat"]), "sit_to_stand_demo");
  assert.equal(await pick(["sit_to_stand_camera", "squat"]), "sit_to_stand_camera");
  assert.equal(await pick(["squat"]), "squat");
  assert.equal(await pick([]), undefined);
});

test("the screen says when a score comes from a stand-in", async () => {
  const standIn = await loadModel("sit_to_stand", serve(["squat"]));
  assert.match(describeModel(standIn, "sit_to_stand") ?? "", /squat model, a stand-in/);
  const calibrated = await loadModel("sit_to_stand", serve(["sit_to_stand_camera"]));
  assert.match(describeModel(calibrated, "sit_to_stand") ?? "", /camera-calibrated/);
  assert.equal(describeModel(await loadModel("squat", serve(["squat"])), "squat"), null);
  assert.match(describeModel(null, "seated_knee_extension") ?? "", /movement rules/);
});
