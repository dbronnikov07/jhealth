// The live rep counter, run frame by frame over the public dataset's squat videos, compared with the
// physiotherapist's hand-marked repetitions. Needs ~/jhealth-cache/test_fixtures/squat_streams.json
// (the dataset is research-use only, so the fixture stays out of the repo); skipped if it is missing.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { jointAngle, type Frame } from "../src/lib/pose/features.ts";
import { RepCounter } from "../src/lib/pose/reps.ts";

const fixture = path.join(os.homedir(), "jhealth-cache", "test_fixtures", "squat_streams.json");
type Stream = { video: string; frames: number[]; world: (number[][] | null)[]; labels: [number, number][] };

test("live counter finds the physiotherapist's squats", { skip: !existsSync(fixture) && "fixture not present" }, () => {
  const streams: Stream[] = JSON.parse(readFileSync(fixture, "utf8"));
  let truth = 0, found = 0, matched = 0;
  const overlaps: number[] = [];
  const offsets: number[] = [];
  for (const s of streams) {
    // Each file holds blocks of frames around the labelled reps; a gap means a new block (a fresh counter).
    let counter = new RepCounter();
    let blockFrames: number[] = [];
    const reps: [number, number][] = [];
    for (let i = 0; i < s.frames.length; i++) {
      if (i > 0 && s.frames[i] - s.frames[i - 1] > 6) {
        counter = new RepCounter();
        blockFrames = [];
      }
      const w = s.world[i] as unknown as Frame;
      if (!w || w[0][0] === null) continue;
      blockFrames.push(s.frames[i]);
      const knee = (jointAngle(w, 23, 25, 27) + jointAngle(w, 24, 26, 28)) / 2;
      const rep = counter.push(s.frames[i] / 30, knee);
      if (rep) reps.push([blockFrames[rep.startIndex], blockFrames[rep.endIndex]]);
    }
    truth += s.labels.length;
    found += reps.length;
    const used = new Set<number>();
    for (const t of s.labels) {
      let best = { iou: 0, j: -1 };
      reps.forEach((r, j) => {
        if (used.has(j)) return;
        const inter = Math.max(0, Math.min(t[1], r[1]) - Math.max(t[0], r[0]) + 1);
        const iou = inter / (Math.max(t[1], r[1]) - Math.min(t[0], r[0]) + 1);
        if (iou > best.iou) best = { iou, j };
      });
      if (best.iou >= 0.5) {
        matched++;
        used.add(best.j);
        overlaps.push(best.iou);
        offsets.push((reps[best.j][0] - t[0]) / 30, (reps[best.j][1] - t[1]) / 30);
      }
    }
  }
  const median = (a: number[]) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const recall = matched / truth, precision = matched / found;
  console.log(`labelled ${truth}, counted ${found}, matched ${matched}: recall ${recall.toFixed(2)}, precision ${precision.toFixed(2)}, ` +
    `median overlap ${median(overlaps).toFixed(2)}, median |offset| ${median(offsets.map(Math.abs)).toFixed(2)} s`);
  assert.ok(recall >= 0.95, `recall ${recall}`);
  assert.ok(precision >= 0.95, `precision ${precision}`);
  assert.ok(median(overlaps) >= 0.8, `overlap ${median(overlaps)}`);
});
