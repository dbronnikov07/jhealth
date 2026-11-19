"""STEP 2 - cut the landmark streams into repetitions.

Step 1 left one file per video with the body points of every frame.
The label table says where each repetition starts and ends, and whether it was
done correctly. Here we cut out every repetition and stretch or squeeze it to
exactly 64 frames, so a slow rep and a fast rep have the same shape.

Run:    ~/jhealth-cache/venv/bin/python build_dataset.py
Output: data/reps.npz  - one row per (repetition, camera). This is the file the
        training notebook needs. It is small enough to upload to Google Colab.
"""
import argparse
import csv
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
CACHE = Path.home() / "jhealth-cache"      # extract_poses.py put the label table and the body points here
T = 64            # every repetition becomes 64 frames
FPS = 30
MAX_MISSING = 0.2  # drop a rep if the tracker lost the person in more than 20% of its frames

# What camera 18 sees, given what camera 17 sees (the cameras stood at a right angle).
CAM18_VIEW = {"front": "profile", "half-profile": "half-profile", "profile": "front"}


def fill_gaps(x):
    """Frames where nobody was detected are NaN. Fill them from the neighbours."""
    bad = np.isnan(x[:, 0, 0])
    if bad.any() and not bad.all():
        idx = np.arange(len(x))
        flat = x.reshape(len(x), -1)
        for j in range(flat.shape[1]):
            flat[bad, j] = np.interp(idx[bad], idx[~bad], flat[~bad, j])
    return x


def resample(x, n):
    """(frames, 33, 3) -> (n, 33, 3) by linear interpolation in time."""
    src = np.linspace(0, 1, len(x))
    dst = np.linspace(0, 1, n)
    flat = x.reshape(len(x), -1)
    out = np.stack([np.interp(dst, src, flat[:, j]) for j in range(flat.shape[1])], axis=1)
    return out.reshape(n, *x.shape[1:])


def main(landmarks_dir="landmarks", out_name="reps.npz"):
    rows = list(csv.DictReader(open(CACHE / "Segmentation.csv"), delimiter=";"))
    cols = {k: [] for k in ("lm", "img", "vis", "exercise", "person", "correct", "cam", "view", "subtype",
                            "video", "rep", "duration", "extra_person", "lights_on", "missing")}
    dropped, streams = 0, {}

    # Only use an exercise once ALL of its videos have been through extract_poses.py,
    # otherwise the test would silently run on part of the people.
    names = {1: "arm abduction", 2: "arm VW", 3: "push-ups", 4: "leg abduction", 5: "lunge", 6: "squat"}
    wanted = {}
    for r in rows:
        wanted.setdefault(int(r["exercise_id"]), set()).update(
            CACHE / landmarks_dir / f"{r['video_id']}_cam{cam}.npz" for cam in (17, 18))
    ready = set()
    for e, files in sorted(wanted.items()):
        have = sum(f.exists() for f in files)
        if have == len(files):
            ready.add(e)
        elif have:
            print(f"  {names[e]:14s} only {have} of {len(files)} videos extracted so far: left out for now")
    rows = [r for r in rows if int(r["exercise_id"]) in ready]

    for r in rows:
        for cam in (17, 18):
            path = CACHE / landmarks_dir / f"{r['video_id']}_cam{cam}.npz"
            if not path.exists():
                continue
            if path not in streams:
                d = np.load(path)
                # image points in pixels (x right, y down; MediaPipe's z dropped), so 2D angles are true angles
                img = d["image"].astype(np.float64) * np.array([float(d["width"]), float(d["height"]), 0.0])
                streams[path] = (d["frames"], d["world"], d["vis"], img)
            frames, world, vis, image = streams[path]
            a, b = int(r["first_frame"]), int(r["last_frame"])
            m = (frames >= a) & (frames <= b)
            if m.sum() < 10:
                dropped += 1
                continue
            w = world[m].astype(np.float64)
            missing = float(np.isnan(w[:, 0, 0]).mean())
            if missing > MAX_MISSING:
                dropped += 1
                continue
            cols["lm"].append(resample(fill_gaps(w), T))
            cols["img"].append(resample(fill_gaps(image[m].copy()), T))
            cols["vis"].append(vis[m].mean(0))
            cols["exercise"].append(int(r["exercise_id"]))
            cols["person"].append(int(r["person_id"]))
            cols["correct"].append(int(r["correctness"]))
            cols["cam"].append(cam)
            cols["view"].append(r["cam17_orientation"] if cam == 17 else CAM18_VIEW[r["cam17_orientation"]])
            cols["subtype"].append(r["exercise_subtype"])
            cols["video"].append(r["video_id"])
            cols["rep"].append(int(r["repetition_number"]))
            cols["duration"].append((b - a + 1) / FPS)
            cols["extra_person"].append(int(r[f"extra_person_in_cam{cam}"]))
            cols["lights_on"].append(int(r["lights_on"]))
            cols["missing"].append(missing)

    out = {k: np.array(v) for k, v in cols.items()}
    out["lm"] = out["lm"].astype(np.float16)     # metres; float16 keeps 0.1 mm precision and halves the file
    out["vis"] = out["vis"].astype(np.float16)
    out["img"] = out["img"].astype(np.float32)   # pixels
    out["duration"] = out["duration"].astype(np.float32)
    # Which MediaPipe model produced these landmarks: the browser must run the same one.
    out["pose_model"] = np.array(landmarks_dir.split("_", 1)[1] if "_" in landmarks_dir else "full")
    DATA.mkdir(exist_ok=True)
    np.savez_compressed(DATA / out_name, **out)

    n = len(out["correct"])
    print(f"saved data/{out_name}: {n} samples (repetition x camera), {dropped} dropped, "
          f"{(DATA / out_name).stat().st_size / 1e6:.1f} MB")
    for e in sorted(set(out["exercise"])):
        m = out["exercise"] == e
        print(f"  {names[e]:14s} {m.sum():4d} samples   correct {out['correct'][m].sum():4d}   "
              f"with a mistake {(1 - out['correct'][m]).sum():4d}   people {len(set(out['person'][m]))}")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--landmarks", default="landmarks", help="folder inside ~/jhealth-cache with body points")
    ap.add_argument("--out", default="reps.npz", help="file name inside ml/data")
    args = ap.parse_args()
    main(args.landmarks, args.out)
