// The browser's copy of the notebook's feature code (ml/train_model.ipynb, sections 2 and 3).
// It MUST produce the same numbers as Python, or the model's scores mean nothing: scripts/pose.test.ts checks
// it against a repetition exported by the notebook (ml/models/parity_test.json).
//
// A frame is MediaPipe's 33 "world" landmarks: metres, origin between the hips, y pointing at the floor.

export type Vec = [number, number, number];
export type Frame = Vec[];

const LEFT = { sh: 11, el: 13, wr: 15, hip: 23, knee: 25, ankle: 27 };
const RIGHT = { sh: 12, el: 14, wr: 16, hip: 24, knee: 26, ankle: 28 };
type Side = typeof LEFT;
const DOWN: Vec = [0, 1, 0];
const UP: Vec = [0, -1, 0];

// ------------------------------------------------------------------ vector maths
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mid = (a: Vec, b: Vec): Vec => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec) => Math.hypot(a[0], a[1], a[2]);
const unit = (a: Vec): Vec => {
  const l = len(a) + 1e-9;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const clip = (x: number) => Math.min(1, Math.max(-1, x));
const DEG = 180 / Math.PI;

export const angleBetween = (u: Vec, v: Vec) => Math.acos(clip(dot(unit(u), unit(v)))) * DEG;
export const jointAngle = (p: Frame, a: number, b: number, c: number) => angleBetween(sub(p[a], p[b]), sub(p[c], p[b]));
const forwardAxis = (p: Frame) => unit(cross(UP, unit(sub(p[RIGHT.sh], p[LEFT.sh]))));

// ------------------------------------------------------------------ per-frame signals (notebook: side_signals, body_signals)
function sideSignals(p: Frame, s: Side, forward: Vec): Record<string, number> {
  const thigh = sub(p[s.knee], p[s.hip]);
  const shin = sub(p[s.knee], p[s.ankle]);
  const upperArm = sub(p[s.el], p[s.sh]);
  const armLen = len(upperArm) + len(sub(p[s.wr], p[s.el]));
  return {
    knee: jointAngle(p, s.hip, s.knee, s.ankle),
    hip: jointAngle(p, s.sh, s.hip, s.knee),
    thigh_incl: angleBetween(thigh, DOWN),
    thigh_fwd: dot(unit(thigh), forward),
    knee_fwd: dot(shin, forward) / (len(shin) + 1e-9),
    shoulder: jointAngle(p, s.hip, s.sh, s.el),
    elbow: jointAngle(p, s.sh, s.el, s.wr),
    wrist_h: (p[s.sh][1] - p[s.wr][1]) / (armLen + 1e-9),
    arm_fwd: dot(unit(upperArm), forward),
  };
}

function bodySignals(p: Frame): Record<string, number> {
  const midSh = mid(p[LEFT.sh], p[RIGHT.sh]);
  const midHip = mid(p[LEFT.hip], p[RIGHT.hip]);
  const midAnkle = mid(p[LEFT.ankle], p[RIGHT.ankle]);
  const shLine = sub(p[RIGHT.sh], p[LEFT.sh]);
  const hipLine = sub(p[RIGHT.hip], p[LEFT.hip]);
  const legLen = [LEFT, RIGHT].reduce((acc, s) => acc + len(sub(p[s.knee], p[s.hip])) + len(sub(p[s.knee], p[s.ankle])), 0) / 2;
  return {
    trunk_lean: angleBetween(sub(midSh, midHip), UP),
    shoulder_tilt: Math.asin(clip(unit(shLine)[1])) * DEG,
    pelvis_tilt: Math.asin(clip(unit(hipLine)[1])) * DEG,
    knee_gap: len(sub(p[RIGHT.knee], p[LEFT.knee])) / (len(hipLine) + 1e-9),
    ankle_gap: len(sub(p[RIGHT.ankle], p[LEFT.ankle])) / (len(hipLine) + 1e-9),
    hip_h: (midAnkle[1] - midHip[1]) / (legLen + 1e-9),
    wrist_gap: len(sub(p[RIGHT.wr], p[LEFT.wr])) / (len(shLine) + 1e-9),
    thigh_spread: angleBetween(sub(p[LEFT.knee], p[LEFT.hip]), sub(p[RIGHT.knee], p[RIGHT.hip])),
  };
}

// ------------------------------------------------------------------ preparing a repetition (build_dataset.py)
const SWAP = Array.from({ length: 33 }, (_, i) => i);
for (const [a, b] of [[1, 4], [2, 5], [3, 6], [7, 8], [9, 10], ...Array.from({ length: 11 }, (_, k) => [11 + 2 * k, 12 + 2 * k])]) {
  SWAP[a] = b;
  SWAP[b] = a;
}
const mirror = (p: Frame): Frame => SWAP.map((j) => [-p[j][0], p[j][1], p[j][2]] as Vec);

/** Linear interpolation over a 0..1 time axis, like np.interp(linspace(0,1,n), linspace(0,1,len), x). */
function interp1(values: number[], n: number): number[] {
  const m = values.length;
  if (m === 1) return Array(n).fill(values[0]);
  return Array.from({ length: n }, (_, i) => {
    const t = (n === 1 ? 0 : i / (n - 1)) * (m - 1);
    const k = Math.min(m - 2, Math.floor(t));
    return values[k] + (values[k + 1] - values[k]) * (t - k);
  });
}

/** Stretch or squeeze a repetition to exactly n frames (default 64). */
export function resample(frames: Frame[], n = 64): Frame[] {
  const out: Frame[] = Array.from({ length: n }, () => Array.from({ length: 33 }, () => [0, 0, 0] as Vec));
  for (let j = 0; j < 33; j++) {
    for (let c = 0; c < 3; c++) {
      const series = interp1(frames.map((f) => f[j][c]), n);
      for (let i = 0; i < n; i++) out[i][j][c] = series[i];
    }
  }
  return out;
}

// ------------------------------------------------------------------ the model's input (notebook: signals, summarise)
export type ModelSpec = {
  signals: string[];
  stats: string[];
  features: string[];
  one_sided?: boolean;
  working_side_by?: [string, "range" | "mean"] | [];
};

function series(frames: Frame[], spec: ModelSpec): Record<string, number[]> {
  let p = frames;
  if (spec.one_sided && spec.working_side_by?.length === 2) {
    const [key, how] = spec.working_side_by;
    const l = p.map((f) => sideSignals(f, LEFT, forwardAxis(f))[key]);
    const r = p.map((f) => sideSignals(f, RIGHT, forwardAxis(f))[key]);
    const leftWorks = how === "range"
      ? Math.max(...l) - Math.min(...l) > Math.max(...r) - Math.min(...r)
      : l.reduce((a, b) => a + b, 0) > r.reduce((a, b) => a + b, 0);
    if (leftWorks) p = p.map(mirror);
  }
  const out: Record<string, number[]> = {};
  const push = (name: string, v: number) => (out[name] ??= []).push(v);
  for (const f of p) {
    const fwd = forwardAxis(f);
    const left = sideSignals(f, LEFT, fwd);
    const right = sideSignals(f, RIGHT, fwd);
    const body = bodySignals(f);
    for (const k of Object.keys(left)) {
      push(`avg_${k}`, (left[k] + right[k]) / 2);
      push(`diff_${k}`, Math.abs(left[k] - right[k]));
      push(`work_${k}`, right[k]);
      push(`rest_${k}`, left[k]);
    }
    for (const k of Object.keys(body)) push(k, !spec.one_sided && k.includes("tilt") ? Math.abs(body[k]) : body[k]);
  }
  return out;
}

const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;

/** The 11 numbers that summarise one 64-frame curve, in the notebook's order. */
export function summarise(x: number[]): Record<string, number> {
  const n = x.length;
  const lo = Math.min(...x);
  const hi = Math.max(...x);
  const m = mean(x);
  const speed = x.slice(1).map((v, i) => Math.abs(v - x[i]) * n);
  const jerk = x.slice(2).map((v, i) => Math.abs(v - 2 * x[i + 1] + x[i]));
  return {
    min: lo,
    max: hi,
    range: hi - lo,
    mean: m,
    std: Math.sqrt(mean(x.map((v) => (v - m) ** 2))),
    when_min: x.indexOf(lo) / n,
    when_max: x.indexOf(hi) / n,
    speed: mean(speed),
    peak_speed: Math.max(...speed),
    jerk: mean(jerk),
    first_vs_second_half: mean(x.slice(0, n >> 1)) - mean(x.slice(n >> 1)),
  };
}

/** One repetition (any number of frames) -> the model's input vector, in the order the model expects. */
export function repFeatures(frames: Frame[], durationSeconds: number, spec: ModelSpec): number[] {
  const s = series(resample(frames, 64), spec);
  const out: number[] = [];
  for (const name of spec.signals) {
    const stats = summarise(s[name]);
    for (const stat of spec.stats) out.push(stats[stat]);
  }
  out.push(durationSeconds);
  if (out.length !== spec.features.length) throw new Error(`built ${out.length} features, model expects ${spec.features.length}`);
  return out;
}
