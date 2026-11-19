"""STEP A for your own data: recorded clips -> single-exercise repetitions.

You record clips (see docs/RECORDING.md), put them in  clips/<person>/<label>_<number>.mp4  and run:

    ~/jhealth-cache/venv/bin/python extract_clips.py                                    (squats in clips/squat/)
    ~/jhealth-cache/venv/bin/python extract_clips.py --exercise arm_raise               (clips/arm_raise/)

Exercises: squat, sit_to_stand, seated_knee_extension, arm_raise (see exercises.py for how each is counted).

For every clip this script
  1. runs the MediaPipe pose tracker on it (the same tracker the browser will use),
  2. measures the knee angle over time,
  3. cuts the clip into single repetitions (every dip of that exercise's rep signal is one repetition),
  4. saves every repetition, with the person and the label taken from the folder and file name,
  5. draws a picture per clip (clips_report/) so you can SEE which repetitions were found.

Look at the pictures and the table before you train: if a clip found 9 repetitions where you did 15,
the picture shows why (person partly out of frame, a squat too shallow to count, ...).

Output: data/own_reps.npz, clips_report/*.png, clips_report/summary.csv
"""
import argparse
import contextlib
import csv
import hashlib
import os
import re
import sys
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import notebook_code                                  # noqa: E402
from build_dataset import fill_gaps, resample         # noqa: E402
from extract_poses import model_paths                 # noqa: E402
from exercises import EXERCISES                       # noqa: E402

PROJECT = HERE.parent
CACHE = Path.home() / "jhealth-cache"
VIDEO_EXT = {".mp4", ".mov", ".m4v", ".avi", ".webm", ".mkv"}
T = 64              # every repetition is stretched to 64 frames, like the public data
SAMPLE_FPS = 15     # the tracker looks at about 15 frames per second, like when we built the public data
MIN_REP_S, MAX_REP_S = 0.8, 12.0
CAMERA_NAMES = ("img", "mov", "pxl", "vid", "screen", "video", "untitled", "photo")
# Optional folder between participant and filename. Keeping this small prevents an
# arbitrary session folder from being incorrectly reported as an iPhone validation set.
DEVICE_FOLDERS = {"iphone", "phone", "android", "laptop", "webcam"}
TORSO = [11, 12, 23, 24]
LEFT_LEG, RIGHT_LEG = [23, 25, 27], [24, 26, 28]
LEFT_ARM, RIGHT_ARM = [11, 13, 15], [12, 14, 16]


# ---------------------------------------------------------------- names

def parse_clip(path, root):
    """clips/anna/iphone/knees_in_2.mp4 -> person, device, label.

    The device folder is optional so the original clips/<person>/<label>.mp4 layout
    remains supported. Unknown is intentional: it must not be presented as a tested
    phone or laptop result later.
    """
    parts = path.relative_to(root).parts
    person = parts[0] if len(parts) > 1 else "me"
    device = parts[1].lower() if len(parts) > 2 and parts[1].lower() in DEVICE_FOLDERS else "unknown"
    label = re.sub(r"[ \-]+", "_", path.stem.lower())
    label = re.sub(r"(_?take)?_?\(?\d+\)?$", "", label).strip("_")
    return person, device, label


def clear_joint_frames(found, visibility, exercise):
    """Frames whose required joints are actually visible in the capture.

    This mirrors the browser's camera preflight. Squat and sit-to-stand require both
    legs; the one-sided arm raise and knee extension accept a clear working side in a
    side-on recording rather than rejecting the naturally occluded far side.
    """
    def clear(indices):
        return np.all(visibility[:, indices] >= 0.45, axis=1)
    torso = clear(TORSO)
    if exercise == "seated_knee_extension":
        joints = torso & (clear(LEFT_LEG) | clear(RIGHT_LEG))
    elif exercise == "arm_raise":
        joints = torso & (clear(LEFT_ARM) | clear(RIGHT_ARM))
    else:
        joints = clear(TORSO + LEFT_LEG + RIGHT_LEG)
    return found & joints


# ---------------------------------------------------------------- tracking

@contextlib.contextmanager
def quiet_native_logs():
    """MediaPipe prints dozens of harmless warnings from its C++ core. Hide them so our table stays readable."""
    sys.stderr.flush()
    saved = os.dup(2)
    with open(os.devnull, "w") as null:
        os.dup2(null.fileno(), 2)
        try:
            yield
        finally:
            sys.stderr.flush()
            os.dup2(saved, 2)
            os.close(saved)


def track_video(path, model_name):
    """Run the pose tracker on a video. Returns times (s) and 33 world landmarks per processed frame."""
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    _, model_path, url = model_paths(model_name)
    if not model_path.exists():
        import requests
        model_path.parent.mkdir(exist_ok=True)
        print(f"downloading the {model_name} pose model ...")
        model_path.write_bytes(requests.get(url, timeout=120).content)

    cap = cv2.VideoCapture(str(path))
    try:
        cap.set(cv2.CAP_PROP_ORIENTATION_AUTO, 1)          # phones store "rotated" videos with a flag
    except Exception:
        pass
    fps = cap.get(cv2.CAP_PROP_FPS)
    if not (1 < fps < 241):
        fps = 30.0
    stride = max(1, round(fps / SAMPLE_FPS))
    landmarker = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(model_path)),
        running_mode=vision.RunningMode.VIDEO, num_poses=1))
    times, world, vis = [], [], []
    idx, width, height = 0, 0, 0
    while True:
        if idx % stride:
            if not cap.grab():
                break
            idx += 1
            continue
        ok, bgr = cap.read()
        if not ok:
            break
        height, width = bgr.shape[:2]
        res = landmarker.detect_for_video(
            mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)), int(idx * 1000 / fps))
        times.append(idx / fps)
        if res.pose_world_landmarks:
            world.append([(p.x, p.y, p.z) for p in res.pose_world_landmarks[0]])
            vis.append([p.visibility for p in res.pose_landmarks[0]])
        else:
            world.append(np.full((33, 3), np.nan)); vis.append(np.zeros(33))
        idx += 1
    cap.release(); landmarker.close()
    return {"times": np.array(times), "world": np.array(world, np.float32), "vis": np.array(vis, np.float32),
            "fps": fps, "width": width, "height": height}


def tracked(path, model_name, cache_dir):
    """track_video with a cache, so changing a setting does not mean tracking the video again."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    # Two devices commonly create good_1.mp4. The old key used only the immediate
    # parent and filename, so it could accidentally reuse laptop landmarks for iPhone
    # footage. The complete path prevents that silent cross-device leak.
    identity = hashlib.sha256(str(path.resolve()).encode()).hexdigest()[:12]
    key = f"{path.stem}__{model_name}__{path.stat().st_size}__{identity}.npz"
    f = cache_dir / key
    if f.exists():
        d = np.load(f)
        return {k: d[k] for k in d.files}
    t = track_video(path, model_name)
    np.savez_compressed(f, **t)
    return t


# ---------------------------------------------------------------- cutting into repetitions

def find_reps(knee, sample_fps, min_depth=15.0, edge=0.95, pad_start=0.4, pad_end=0.5):
    """Cut a knee-angle curve (degrees, standing is about 170) into single squats.

    A squat is a dip of the knee angle. We look for dips that are at least `min_depth` degrees deep and
    at least 0.8 s apart. A repetition starts and ends when the knee is back within (1 - edge) of the way up
    to standing. Dips at the very start or end of a clip, where the person never stood up fully, are
    reported as skipped rather than guessed.

    pad_start / pad_end (seconds) add the standing time before and after the bend, but never more than half of
    the pause between two squats. The physiotherapist who marked the public data included that standing time,
    so padding makes our repetitions look like theirs (check_segmenter.py measures this).

    Returns (reps, smoothed_curve, skipped); each rep is a dict with start, end, valley (frame indices).
    """
    from scipy.signal import find_peaks, savgol_filter
    win = max(5, int(round(0.5 * sample_fps)) | 1)
    if len(knee) <= win + 2:
        return [], knee, []
    k = savgol_filter(knee, win, 2)
    valleys, _ = find_peaks(-k, prominence=min_depth, distance=max(1, int(round(0.8 * sample_fps))))
    reps, skipped = [], []
    for j, v in enumerate(valleys):
        lo = valleys[j - 1] if j else 0
        hi = valleys[j + 1] if j + 1 < len(valleys) else len(k) - 1
        left_top = lo + int(np.argmax(k[lo:v + 1]))
        right_top = v + int(np.argmax(k[v:hi + 1]))
        ref = min(k[left_top], k[right_top])
        if ref - k[v] < min_depth:
            skipped.append({"valley": int(v), "why": "clip starts or ends in the middle of a squat"})
            continue
        thr = k[v] + edge * (ref - k[v])
        s = v
        while s > left_top and k[s] < thr:
            s -= 1
        e = v
        while e < right_top and k[e] < thr:
            e += 1
        dur = (e - s + 1) / sample_fps
        if not MIN_REP_S <= dur <= MAX_REP_S:
            skipped.append({"valley": int(v), "why": f"lasts {dur:.1f} s, outside {MIN_REP_S} to {MAX_REP_S} s"})
            continue
        reps.append({"start": int(s), "end": int(e), "valley": int(v), "depth": float(ref - k[v]), "min_knee": float(k[v])})
    ps, pe = int(round(pad_start * sample_fps)), int(round(pad_end * sample_fps))
    inner = [(r["start"], r["end"]) for r in reps]
    for i, r in enumerate(reps):
        before = inner[i][0] - (inner[i - 1][1] if i else -1) - 1           # free frames before this rep
        after = (inner[i + 1][0] if i + 1 < len(reps) else len(k)) - inner[i][1] - 1
        r["start"] = inner[i][0] - min(ps, before // 2 if i else before)
        r["end"] = inner[i][1] + min(pe, after // 2 if i + 1 < len(reps) else after)
    return reps, k, skipped


def knee_angle(world, ns):
    w = fill_gaps(world.astype(np.float64).copy())
    ja = ns["joint_angle"]
    return (ja(w, 23, 25, 27) + ja(w, 24, 26, 28)) / 2


# ---------------------------------------------------------------- report

def draw_report(path, name, times, raw, smooth, reps, skipped, min_depth):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(11, 3))
    ax.plot(times, raw, color="0.75", lw=1)
    ax.plot(times, smooth, color="tab:blue", lw=1.5)
    for i, r in enumerate(reps, 1):
        ax.axvspan(times[r["start"]], times[r["end"]], color="tab:green", alpha=0.18)
        ax.text(times[r["valley"]], r["min_knee"] - 6, str(i), ha="center", va="top", fontsize=8)
    for s in skipped:
        ax.plot(times[s["valley"]], smooth[s["valley"]], "rx")
    ax.set_title(f"{name}: {len(reps)} repetitions found (green), {len(skipped)} skipped (red x)", fontsize=10)
    ax.set_xlabel("seconds"); ax.set_ylabel("rep signal (deg)")
    plt.tight_layout(); fig.savefig(path, dpi=110); plt.close(fig)


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--exercise", choices=list(EXERCISES), default="squat")
    ap.add_argument("--clips", type=Path, help="default: clips/<exercise> (or clips/ for squats recorded the old way)")
    ap.add_argument("--out", type=Path, help="default: data/own_<exercise>.npz")
    ap.add_argument("--report", type=Path, help="default: clips_report/<exercise>")
    ap.add_argument("--model", choices=["full", "lite", "heavy"], default="heavy")
    ap.add_argument("--expected", type=int, default=15, help="how many reps you meant to do per clip (for the warnings)")
    ap.add_argument("--min-depth", type=float, help="smallest dip of the rep signal (degrees) that counts as a rep")
    ap.add_argument("--edge", type=float, default=0.95)
    ap.add_argument("--pad-start", type=float, default=0.4, help="seconds of standing kept before the bend (matches the public data)")
    ap.add_argument("--pad-end", type=float, default=0.5, help="seconds of standing kept after the bend")
    args = ap.parse_args()
    ex = EXERCISES[args.exercise]
    if args.clips is None:
        args.clips = PROJECT / "clips" / args.exercise
        if args.exercise == "squat" and not args.clips.exists() and (PROJECT / "clips").exists():
            args.clips = PROJECT / "clips"            # the squat layout before there were four exercises
    args.out = args.out or HERE / "data" / f"own_{args.exercise}.npz"
    args.report = args.report or PROJECT / "clips_report" / args.exercise
    args.min_depth = args.min_depth or ex["min_depth"]

    files = sorted(p for p in args.clips.rglob("*") if p.suffix.lower() in VIDEO_EXT and not p.name.startswith("."))
    if not files:
        sys.exit(f"No videos found in {args.clips}. Put clips in {args.clips}/<person>/<label>_<number>.mp4, "
                 "see docs/RECORDING.md.")
    ns = notebook_code.load()
    args.report.mkdir(parents=True, exist_ok=True)
    cols = {k: [] for k in ("lm", "person", "device", "label", "good", "duration", "clip", "rep", "min_knee", "depth")}
    table, t0 = [], time.time()

    for n, path in enumerate(files, 1):
        person, device, label = parse_clip(path, args.clips)
        name = f"{person}/{device}/{path.name}" if device != "unknown" else f"{person}/{path.name}"
        with quiet_native_logs():
            trk = tracked(path, args.model, CACHE / "own_tracks")
        times, world = trk["times"], trk["world"]
        found = ~np.isnan(world[:, 0, 0])
        fully_visible = clear_joint_frames(found, trk["vis"], args.exercise)
        visibility_coverage = float(fully_visible.mean())
        notes = []
        if found.mean() < 0.6:
            notes.append(f"person found in only {found.mean():.0%} of frames (rotated video? out of frame?)")
        if visibility_coverage < 0.75:
            notes.append(f"needed joints clear in only {visibility_coverage:.0%} of frames (step back and re-record)")
        if trk["fps"] and times[-1] < 5:
            notes.append("clip shorter than 5 s")
        reps, skipped = [], []
        if found.mean() >= 0.6 and visibility_coverage >= 0.75:
            raw = ex["rep_signal"](fill_gaps(world.astype(np.float64).copy()))
            reps, smooth, skipped = find_reps(raw, SAMPLE_FPS, args.min_depth, args.edge, args.pad_start, args.pad_end)
            draw_report(args.report / f"{person}__{path.stem}.png", name, times, raw, smooth, reps, skipped, args.min_depth)
            for i, r in enumerate(reps, 1):
                seg = fill_gaps(world[r["start"]:r["end"] + 1].astype(np.float64).copy())
                cols["lm"].append(resample(seg, T).astype(np.float32))
                for k, v in (("person", person), ("device", device), ("label", label), ("good", int(label == "good")),
                             ("duration", times[r["end"]] - times[r["start"]] + 1 / SAMPLE_FPS), ("clip", path.name),
                             ("rep", i), ("min_knee", r["min_knee"]), ("depth", r["depth"])):
                    cols[k].append(v)
        if reps and abs(len(reps) - args.expected) > 3:
            notes.append(f"found {len(reps)} reps, expected about {args.expected}: check clips_report/{person}__{path.stem}.png")
        if any("middle" in s["why"] for s in skipped) and len(skipped) > 2:
            notes.append("several dips skipped: start and end every clip standing upright")
        row = {"person": person, "device": device, "clip": path.name, "label": label, "reps": len(reps), "skipped": len(skipped),
               "median_depth_deg": round(float(np.median([r["depth"] for r in reps])), 1) if reps else "",
               "median_seconds": round(float(np.median([(r["end"] - r["start"] + 1) / SAMPLE_FPS for r in reps])), 1) if reps else "",
               "size": f'{trk["width"]}x{trk["height"]}', "clear_joint_coverage": round(visibility_coverage, 3), "notes": "; ".join(notes)}
        table.append(row)
        print(f"[{n}/{len(files)} {time.time() - t0:3.0f}s] {name:34s} label={label:13s} reps={len(reps):2d} "
              f"depth~{row['median_depth_deg']!s:>5} deg  {row['notes']}", flush=True)

    with open(args.report / "summary.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(table[0])); w.writeheader(); w.writerows(table)
    if not cols["lm"]:
        sys.exit("No repetitions found in any clip. Open the pictures in clips_report/ to see why.")
    out = {k: np.array(v) for k, v in cols.items()}
    out["lm"] = out["lm"].astype(np.float16)
    out["duration"] = out["duration"].astype(np.float32)
    args.out.parent.mkdir(exist_ok=True)
    np.savez_compressed(args.out, **out)

    labels = sorted(set(out["label"]))
    print(f"\nsaved {args.out}: {len(out['good'])} repetitions from {len(set(out['person']))} people")
    for device in sorted(set(out["device"])):
        m = out["device"] == device
        print(f"  device {device:8s} {int(m.sum()):4d} reps   people: {', '.join(sorted(set(out['person'][m])))}")
    for lab in labels:
        m = out["label"] == lab
        print(f"  {lab:14s} {m.sum():4d} reps   people: {', '.join(sorted(set(out['person'][m])))}")
    odd = [l for l in labels if l.split('_')[0] in CAMERA_NAMES or l.isdigit()]
    if odd:
        print(f"WARNING: these labels look like camera file names, not labels: {odd}. Rename the files, see docs/RECORDING.md.")
    if "good" not in labels:
        print("WARNING: no clips labelled 'good'. The model needs correct squats to compare against.")


if __name__ == "__main__":
    main()
