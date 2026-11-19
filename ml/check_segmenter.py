"""DIAGNOSTIC - can we trust the automatic rep cutter?

The public dataset comes with a physiotherapist's hand-marked start and end of every squat. Here we run our
automatic cutter (extract_clips.find_reps) on the same squat videos WITHOUT looking at those marks, then compare:

  recall      of the physiotherapist's reps, how many did the cutter find?
  precision   of the reps the cutter found, how many are real ones?
  overlap     how well do the start and end agree (IoU: 1.0 = identical, 0.5 = half overlapping)?

Run:  ~/jhealth-cache/venv/bin/python check_segmenter.py
"""
import csv
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import extract_clips as ec         # noqa: E402
import notebook_code               # noqa: E402

CACHE = Path.home() / "jhealth-cache"
FPS_VIDEO = 30


def squat_blocks(landmarks_dir):
    """Yield (video, cam, frames, world) for each continuous stretch of tracked frames."""
    for path in sorted(landmarks_dir.glob("*.npz")):
        d = np.load(path)
        if int(d["exercise"]) != 6:
            continue
        frames, world = d["frames"], d["world"]
        cuts = np.flatnonzero(np.diff(frames) > 6) + 1          # a gap = the next block of labelled reps
        for a, b in zip(np.r_[0, cuts], np.r_[cuts, len(frames)]):
            yield path.stem, frames[a:b], world[a:b]


def iou(a, b):
    inter = max(0, min(a[1], b[1]) - max(a[0], b[0]) + 1)
    return inter / (max(a[1], b[1]) - min(a[0], b[0]) + 1 - 0)


def evaluate(landmarks_dir, ns, labels, min_depth, edge, pad=(0.0, 0.0)):
    sample_fps = FPS_VIDEO / 2
    tp = fp = fn = 0
    ious, start_err, end_err = [], [], []
    for stem, frames, world in squat_blocks(landmarks_dir):
        vid, cam = stem.rsplit("_cam", 1)
        if cam != "17" or np.isnan(world[:, 0, 0]).mean() > 0.2:
            continue
        reps, _, _ = ec.find_reps(ec.knee_angle(world, ns), sample_fps, min_depth, edge, *pad)
        found = [(frames[r["start"]], frames[r["end"]]) for r in reps]
        truth = [t for t in labels[vid] if t[0] >= frames[0] - 1 and t[1] <= frames[-1] + 1]
        used = set()
        for t in truth:
            best = max(((iou(t, f), j) for j, f in enumerate(found) if j not in used), default=(0, None))
            if best[0] >= 0.5:
                tp += 1; used.add(best[1]); ious.append(best[0])
                start_err.append((found[best[1]][0] - t[0]) / FPS_VIDEO); end_err.append((found[best[1]][1] - t[1]) / FPS_VIDEO)
            else:
                fn += 1
        fp += len(found) - len(used)
    return {"recall": tp / max(tp + fn, 1), "precision": tp / max(tp + fp, 1), "iou": float(np.median(ious)) if ious else 0,
            "start_s": float(np.median(start_err)) if start_err else 0, "end_s": float(np.median(end_err)) if end_err else 0,
            "n_true": tp + fn, "n_found": tp + fp}


def main():
    labels = defaultdict(list)
    for r in csv.DictReader(open(CACHE / "Segmentation.csv"), delimiter=";"):
        if int(r["exercise_id"]) == 6:
            labels[r["video_id"]].append((int(r["first_frame"]), int(r["last_frame"])))
    ns = notebook_code.load()
    for name in ("landmarks_heavy", "landmarks"):
        d = CACHE / name
        if not d.exists():
            continue
        print(f"\nlandmarks: {name}   (camera 17, squats; {sum(len(v) for v in labels.values())} labelled repetitions in total)")
        print(f"  {'min depth':>9s} {'edge':>5s} {'padding (s)':>12s}  {'recall':>7s} {'precision':>9s} {'overlap':>8s}  start/end offset (s)   found/true")
        for min_depth, edge, pad in ((20, 0.95, (0, 0)), (20, 0.95, (0.3, 0.4)), (20, 0.95, (0.4, 0.5)), (20, 0.95, (0.5, 0.6)),
                                     (20, 0.99, (0.4, 0.5)), (15, 0.95, (0.4, 0.5))):
            r = evaluate(d, ns, labels, min_depth, edge, pad)
            print(f"  {min_depth:9d} {edge:5.2f} {pad[0]:5.1f}/{pad[1]:<5.1f}   {r['recall']:7.2f} {r['precision']:9.2f} {r['iou']:8.2f}  "
                  f"{r['start_s']:+.2f} / {r['end_s']:+.2f}          {r['n_found']}/{r['n_true']}")


if __name__ == "__main__":
    main()
