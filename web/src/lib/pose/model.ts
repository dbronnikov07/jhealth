// Runs an exported model in the browser. Three formats exist:
//   ml/models/<exercise>.json  type "logistic" (weights at the top level) or "forest" (decision trees)
//   ml/models/squat_demo.json  from train_own.py: { quality: {...logistic...}, fault: {...softmax...} }
// Output: probability that the repetition contains a mistake. Quality shown to the patient = 100 x (1 - p).
import type { ModelSpec } from "./features";

type Logistic = { mean: number[]; scale: number[]; weights: number[]; bias: number };
type Tree = { feature: number[]; threshold: number[]; left: number[]; right: number[]; p_mistake: number[] };
type Softmax = { classes: string[]; mean: number[]; scale: number[]; weights: number[][]; bias: number[] };
type BoostedTree = { feature: number[]; threshold: number[]; left: number[]; right: number[]; leaf: number[]; value: number[] };
type CaptureDeviceResults = Record<string, { reps: number; people: number; "macro F1": number | null; accuracy?: number; note?: string }>;
type Member =
  | ({ type: "logistic" } & Logistic)
  | { type: "forest"; trees: Tree[] }
  | { type: "boosting"; baseline: number; trees: BoostedTree[] }
  | { type: "ensemble"; members: Member[] };

export type ExportedModel = ModelSpec & {
  exercise: string;
  pose_model?: "full" | "heavy" | "lite";
  type?: "logistic" | "forest" | "boosting" | "ensemble";
  members?: Member[];
  baseline?: number;
  quality?: Logistic & { type: "logistic" };
  fault?: Softmax | null;
  trees?: Tree[];
  tested_on_unseen_people?: Record<string, number | string | CaptureDeviceResults>;
  /** Set by ml/train_exercise.py when the model was trained with every dataset on its own scale: the browser's
   *  camera features are first put on the camera data's scale, then given to the model. */
  input_scale?: { source: string; mean: number[]; scale: number[] };
  /** Flag a repetition only when p(mistake) is at least this (ml/operating_point.py: about 90% of flags are real). */
  flag_threshold?: number;
} & Partial<Logistic>;

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function logistic(m: Logistic, x: number[]): number {
  let z = m.bias;
  for (let i = 0; i < x.length; i++) z += m.weights[i] * ((x[i] - m.mean[i]) / m.scale[i]);
  return sigmoid(z);
}

function forest(trees: Tree[], x: number[]): number {
  let total = 0;
  for (const t of trees) {
    let node = 0;
    while (t.left[node] !== -1) node = x[t.feature[node]] <= t.threshold[node] ? t.left[node] : t.right[node];
    total += t.p_mistake[node];
  }
  return total / trees.length;
}

/** Gradient boosting: start from the baseline, add one leaf value per tree, squash to 0..1. */
function boosting(baseline: number, trees: BoostedTree[], x: number[]): number {
  let raw = baseline;
  for (const t of trees) {
    let node = 0;
    while (!t.leaf[node]) node = x[t.feature[node]] <= t.threshold[node] ? t.left[node] : t.right[node];
    raw += t.value[node];
  }
  return sigmoid(raw);
}

function member(m: Member, x: number[]): number {
  switch (m.type) {
    case "logistic": return logistic(m, x);
    case "forest": return forest(m.trees, x);
    case "boosting": return boosting(m.baseline, m.trees, x);
    case "ensemble": return m.members.reduce((s, k) => s + member(k, x), 0) / m.members.length;
  }
}

export function mistakeProbability(model: ExportedModel, x: number[]): number {
  const s = model.input_scale;
  if (s) x = x.map((v, i) => (v - s.mean[i]) / s.scale[i]);
  if (model.quality) return logistic(model.quality, x);
  if (model.type) return member(model as unknown as Member, x);
  throw new Error("unknown model format");
}

/** Which fault the own-clip model thinks it is ("good", "knees_in", ...), or null if the model has no fault part. */
export function likelyFault(model: ExportedModel, x: number[]): { label: string; p: number } | null {
  const f = model.fault;
  if (!f) return null;
  const z = f.weights.map((w, k) => w.reduce((s, wi, i) => s + wi * ((x[i] - f.mean[i]) / f.scale[i]), f.bias[k]));
  const top = Math.max(...z);
  const e = z.map((v) => Math.exp(v - top));
  const sum = e.reduce((a, b) => a + b, 0);
  const k = z.indexOf(top);
  return { label: f.classes[k], p: e[k] / sum };
}
