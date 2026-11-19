// The browser must compute exactly what Python computed, or the model's scores mean nothing.
// ml/models/parity_<exercise>.json (ml/make_parity.py) is one real repetition with Python's features and score,
// for every exported model; parity_test.json is the older squat example from train_squat.py.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { repFeatures, type Frame } from "../src/lib/pose/features.ts";
import { mistakeProbability, type ExportedModel } from "../src/lib/pose/model.ts";

const models = new URL("../../ml/models/", import.meta.url);
const files = readdirSync(models).filter((f) => /^parity_[a-z_]+\.json$/.test(f) && f !== "parity_test.json");
if (!files.length && existsSync(new URL("parity_test.json", models))) files.push("parity_test.json");

for (const file of files) {
  const parity = JSON.parse(readFileSync(new URL(file, models), "utf8"));
  const model: ExportedModel = JSON.parse(readFileSync(new URL(`${parity.exercise}.json`, models), "utf8"));

  // Exports from before 18 Nov 2026 only have features computed from the UNrounded landmarks (float32), while the
  // file stores landmarks rounded to 5 decimals; speed features magnify that rounding by up to ~0.3%. Newer exports
  // carry features computed from the rounded landmarks, which must match to within float precision.
  // "Float precision" = 1e-4 relative: the notebook stores signals as 32-bit floats and the browser uses 64-bit;
  // near 0 or 180 degrees, acos magnifies that (worst seen: 0.000008 degrees on a trunk-lean angle).
  const exact = Array.isArray(parity.features_from_rounded);
  const reference: number[] = exact ? parity.features_from_rounded : parity.features;
  const tolerance = exact ? 1e-4 : 5e-3;

  test(`${parity.exercise}: browser features match Python's, feature by feature (${exact ? "exact" : "within rounding"})`, () => {
    const x = repFeatures(parity.landmarks as Frame[], parity.duration, model);
    assert.equal(x.length, reference.length);
    const worst = x
      .map((v, i) => ({ name: model.features[i], js: v, py: reference[i], diff: Math.abs(v - reference[i]) / Math.max(1, Math.abs(reference[i])) }))
      .sort((a, b) => b.diff - a.diff);
    console.log(`${parity.exercise} largest differences:`, worst.slice(0, 3).map((w) => `${w.name} js=${w.js.toFixed(6)} py=${w.py.toFixed(6)}`).join("; "));
    assert.ok(worst[0].diff < tolerance, `${worst[0].name}: ${worst[0].js} vs ${worst[0].py}`);
  });

  test(`${parity.exercise}: browser score matches Python's`, () => {
    const p = mistakeProbability(model, repFeatures(parity.landmarks as Frame[], parity.duration, model));
    const python = exact ? parity.p_mistake_from_rounded : parity.p_mistake;
    console.log(`${parity.exercise} p(mistake): browser ${p.toFixed(6)}, python ${python.toFixed(6)} (model: ${(model as { model?: string }).model ?? model.type})`);
    assert.ok(Math.abs(p - python) < 1e-3);
  });
}
