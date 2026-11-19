// Which model scores an exercise, in order of preference:
//   <key>_demo.json    trained on your own recorded clips (train_own.py)
//   <key>_camera.json  calibrated to camera body points (calibrate_camera.py)
//   <key>.json         the exercise's own model
//   a stand-in         a camera-trained model of a similar movement, labelled as such on screen
import type { ExportedModel } from "./model";

export const STAND_IN: Record<string, string[]> = { sit_to_stand: ["squat"] };

export type LoadedModel = { model: ExportedModel; file: string };

export async function loadModel(
  key: string | null,
  fetchJson: (file: string) => Promise<ExportedModel | null> = async (file) => {
    const res = await fetch(`/models/${file}.json`);
    return res.ok ? res.json() : null;
  },
): Promise<LoadedModel | null> {
  if (!key) return null;
  for (const file of [`${key}_demo`, `${key}_camera`, key, ...(STAND_IN[key] ?? [])]) {
    const model = await fetchJson(file);
    if (model) return { model, file };
  }
  return null;
}

/** One line for the screen, so nobody mistakes a stand-in score for the real thing. */
export function describeModel(loaded: LoadedModel | null, key: string | null): string | null {
  if (!loaded) return "Checked by movement rules (no trained model for this exercise yet)";
  if (key && !loaded.file.startsWith(key)) return `Scored with the ${loaded.model.exercise} model, a stand-in for now`;
  if (loaded.file.endsWith("_demo")) return "Scored with the model from your own clips";
  if (loaded.file.endsWith("_camera")) return "Scored with the camera-calibrated model";
  return null;
}
