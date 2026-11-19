"""Builds ml/colab_train.ipynb: the whole pipeline (videos -> body points -> repetitions -> models -> export) in one
notebook that runs on Google Colab, so nothing heavy runs on the laptop.

The feature code and the model code are copied in from the project's own files at build time (train_model.ipynb and
train_squat.py), so there is one source of truth.

Run from ml/:  ~/jhealth-cache/venv/bin/python tools/make_colab.py colab_train.ipynb
"""
import inspect
import sys
from pathlib import Path

import nbformat as nbf

ML = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ML))
import train_squat as ts  # noqa: E402
import uiprmd  # noqa: E402

src = [c.source for c in nbf.read(ML / "train_model.ipynb", 4).cells if c.cell_type == "code"]
pick = lambda prefix: next(s for s in src if s.startswith(prefix))  # noqa: E731
FEATURES = pick("# MediaPipe numbers").split("SIG = {}")[0].rstrip()
SUMMARISE = pick("STATS =").split("X, Y, WHO, VIEW, FEATURES")[0].rstrip()
SCORES = pick("def leave_one_person_out").rstrip()
UIPRMD_CODE = ("UIPRMD = " + repr(uiprmd.UIPRMD) + "\nVICON_HZ = " + repr(uiprmd.VICON_HZ) + "\nMARKER = " + repr(uiprmd.MARKER)
               + "\n\n\n" + inspect.getsource(uiprmd.vicon_to_mediapipe).rstrip() + "\n\n\n" + inspect.getsource(uiprmd.fill_marker_gaps).rstrip()
               + "\n\n\n" + inspect.getsource(uiprmd.fetch_sit_to_stand).rstrip())
MODEL_CODE = "\n\n\n".join(inspect.getsource(o).rstrip() for o in
                           (ts.logistic, ts.forest, ts.boosting, ts.Ensemble, ts.loso, ts.to_dict, ts.predict_from_dict))

cells = []
md = lambda s: cells.append(nbf.v4.new_markdown_cell(s.strip("\n")))  # noqa: E731
code = lambda s: cells.append(nbf.v4.new_code_cell(s.strip("\n")))   # noqa: E731

md(r"""
# jHealth: train the exercise model on Google's computers

Everything here runs on Google Colab, not on your laptop. Two public datasets, both read straight from Zenodo:

- **REHAB24-6** (video): squat, lunge, leg abduction, arm abduction, arm VW. Videos are fetched one at a time, turned
  into body points with MediaPipe, and deleted. Research use only (CC BY-NC 4.0).
- **UI-PRMD** (motion capture): sit-to-stand. Marker positions converted to the same body points. Public domain.

At the end your browser downloads small files: one trained model per exercise (under 1 MB each).

**How to run**
1. Open https://colab.research.google.com, then **File → Upload notebook** and choose this file (`ml/colab_train.ipynb`).
2. **Runtime → Run all.** If Colab warns that the notebook was not written by Google, choose *Run anyway*.
3. Wait. Squats with the heavy tracker take roughly 20 to 40 minutes on Colab's free computer.
4. Files such as `squat.json` and `sit_to_stand.json` download.
   - `squat.json` (and other video exercises): put it in `~/jhealth/web/public/models/` (the app uses it at once) and `~/jhealth/ml/models/`.
   - `sit_to_stand.json`: put it in `~/jhealth/ml/models/` only. It was trained on motion capture and must first be
     calibrated to the camera with `ml/calibrate_camera.py` and a few recorded sit-to-stand clips (no labels needed).

The settings cell below chooses the exercises and the tracker.
""")

code(r"""
# Install what Colab does not have yet (into this notebook's own Python).
import importlib.util
missing = [p for p in ("mediapipe", "remotezip") if importlib.util.find_spec(p) is None]
if missing:
    get_ipython().run_line_magic("pip", "install -q " + " ".join(missing))
""")

code(r"""
# ---- settings -----------------------------------------------------------------------------------------------
EXERCISES = [6]          # REHAB24-6 video exercises: 6 squat, 5 lunge, 4 leg abduction, 1 arm abduction, 2 arm VW ([] = none)
SIT_TO_STAND = True      # also train sit-to-stand from UI-PRMD (motion capture, fast: no videos to process)
POSE_MODEL = "heavy"     # "heavy" is slower and more accurate (+0.06 macro F1 on squats); "full" is the default model
STRIDE = 2               # look at every 2nd frame (15 per second): plenty for slow rehab movements
QUICK_TEST = False       # True: only 3 videos from one camera, to check that the notebook runs at all
import os
QUICK_TEST = QUICK_TEST or os.environ.get("JHEALTH_QUICK_TEST") == "1"
if QUICK_TEST:
    POSE_MODEL, STRIDE = "full", 6
UIPRMD_SUBJECTS = {1, 2, 3} if QUICK_TEST else None   # None = all 10 people
if os.environ.get("JHEALTH_EXERCISES") is not None:   # for testing: e.g. JHEALTH_EXERCISES="" = sit-to-stand only
    EXERCISES = [int(x) for x in os.environ["JHEALTH_EXERCISES"].split(",") if x]
""")

md(r"""
## 1. The labels and the pose model

REHAB24-6 ([Zenodo](https://zenodo.org/records/13305826)): 10 healthy adults filmed in a lab; a physiotherapist marked
every repetition as correct or not. Licence CC BY-NC 4.0: research and prototypes only, not a commercial product.
""")

code(r"""
import csv, io, shutil, tempfile, time
import requests
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import numpy as np
from sklearn.metrics import accuracy_score, confusion_matrix, f1_score, roc_auc_score

ZENODO = "https://zenodo.org/api/records/13305826/files"
WORK = Path(tempfile.mkdtemp(prefix="jhealth_"))
labels_csv = requests.get(f"{ZENODO}/Segmentation.csv/content", timeout=120).text
ROWS = [r for r in csv.DictReader(io.StringIO(labels_csv), delimiter=";") if int(r["exercise_id"]) in EXERCISES]
MODEL_PATH = WORK / f"pose_landmarker_{POSE_MODEL}.task"
if EXERCISES:
  MODEL_PATH.write_bytes(requests.get(
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    f"pose_landmarker_{POSE_MODEL}/float16/latest/pose_landmarker_{POSE_MODEL}.task", timeout=300).content)

# Which frames each video needs: the labelled repetitions, merged into blocks, with 15 frames of margin.
spans, exercise_of = defaultdict(list), {}
for r in ROWS:
    spans[r["video_id"]].append((int(r["first_frame"]), int(r["last_frame"])))
    exercise_of[r["video_id"]] = int(r["exercise_id"])
BLOCKS = {}
for vid, s in spans.items():
    s.sort()
    merged = [[max(0, s[0][0] - 15), s[0][1] + 15]]
    for a, b in s[1:]:
        if a - 15 - merged[-1][1] <= 60:
            merged[-1][1] = b + 15
        else:
            merged.append([max(0, a - 15), b + 15])
    BLOCKS[vid] = merged
JOBS = [(v, cam) for v in sorted(BLOCKS) for cam in ((17,) if QUICK_TEST else (17, 18))][: 3 if QUICK_TEST else None]
print(f"{len(ROWS)} labelled repetitions, {len(JOBS)} videos to process, tracker: {POSE_MODEL}")
""")

md(r"""
## 2. Videos → body points (the slow part)

Each video (10 to 40 MB) is pulled out of the 2.6 GB archive on its own, run through MediaPipe, and deleted.
Nothing is kept except the body points.
""")

code(r"""
def track(job):
    import cv2, mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision
    from remotezip import RemoteZip
    vid, cam = job
    suffix = "Camera17-30fps.mp4" if cam == 17 else "Camera18-30fps-transposed.mp4"
    path = WORK / f"{vid}_{cam}.mp4"
    for attempt in range(5):                       # Zenodo drops connections now and then
        try:
            with RemoteZip(f"{ZENODO}/videos.zip/content") as z, z.open(f"Ex{exercise_of[vid]}/{vid}-{suffix}") as src, open(path, "wb") as dst:
                shutil.copyfileobj(src, dst)
            break
        except Exception:
            if attempt == 4:
                raise
            time.sleep(5 * (attempt + 1))
    options = vision.PoseLandmarkerOptions(base_options=mp_python.BaseOptions(model_asset_path=str(MODEL_PATH)),
                                           running_mode=vision.RunningMode.VIDEO, num_poses=1)
    cap = cv2.VideoCapture(str(path))
    frames, world, idx = [], [], 0
    for start, end in BLOCKS[vid]:
        lm = vision.PoseLandmarker.create_from_options(options)
        while idx < start and cap.grab():
            idx += 1
        while idx <= end:
            if (idx - start) % STRIDE:
                if not cap.grab():
                    break
                idx += 1
                continue
            ok, bgr = cap.read()
            if not ok:
                break
            res = lm.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)), int(idx * 1000 / 30))
            frames.append(idx)
            world.append([(p.x, p.y, p.z) for p in res.pose_world_landmarks[0]] if res.pose_world_landmarks else np.full((33, 3), np.nan))
            idx += 1
        lm.close()
    cap.release()
    path.unlink(missing_ok=True)
    return vid, cam, np.array(frames), np.array(world, dtype=np.float32)

STREAMS, t0 = {}, time.time()
with ThreadPoolExecutor(max_workers=2 if QUICK_TEST else max(1, min(4, os.cpu_count() or 1))) as pool:
    for n, (vid, cam, fr, w) in enumerate(pool.map(track, JOBS), 1):
        STREAMS[(vid, cam)] = (fr, w)
        print(f"[{n}/{len(JOBS)} {time.time() - t0:4.0f}s] {vid} camera {cam}: {len(fr)} frames")
""")

md(r"""
## 3. Body points → repetitions

Each labelled repetition is cut out and stretched to exactly 64 frames, like `build_dataset.py` does.
""")

code(r"""
def fill_gaps(x):
    bad = np.isnan(x[:, 0, 0])
    if bad.any() and not bad.all():
        i = np.arange(len(x)); flat = x.reshape(len(x), -1)
        for j in range(flat.shape[1]):
            flat[bad, j] = np.interp(i[bad], i[~bad], flat[~bad, j])
    return x

def resample(x, n=64):
    src, dst = np.linspace(0, 1, len(x)), np.linspace(0, 1, n)
    flat = x.reshape(len(x), -1)
    return np.stack([np.interp(dst, src, flat[:, j]) for j in range(flat.shape[1])], 1).reshape(n, *x.shape[1:])

reps = defaultdict(list)
for r in ROWS:
    for cam in (17, 18):
        if (r["video_id"], cam) not in STREAMS:
            continue
        fr, w = STREAMS[(r["video_id"], cam)]
        m = (fr >= int(r["first_frame"])) & (fr <= int(r["last_frame"]))
        if m.sum() < 10 or np.isnan(w[m][:, 0, 0]).mean() > 0.2:
            continue
        reps["lm"].append(resample(fill_gaps(w[m].astype(np.float64))).astype(np.float32))
        reps["exercise"].append(int(r["exercise_id"])); reps["person"].append(int(r["person_id"]))
        reps["mistake"].append(1 - int(r["correctness"]))
        reps["duration"].append((int(r["last_frame"]) - int(r["first_frame"]) + 1) / 30)
REPS = {k: np.array(v) for k, v in reps.items()}
print({k: v.shape for k, v in REPS.items()} if REPS else "no REHAB24-6 exercises chosen")
""")

md(r"""
## 3b. Sit-to-stand from UI-PRMD (motion capture)

The Vicon marker positions are converted into the same 33 body points MediaPipe gives (shoulders, elbows, wrists,
knees and ankles are markers; the hip joints are estimated from the pelvis markers, Bell et al. 1990), turned so
that "up" matches MediaPipe, and stretched to 64 frames. Each file is one repetition: standing, sitting, standing.
The code is copied from `ml/uiprmd.py`; `python uiprmd.py --check` shows the conversion behaves like a real body.

Caveat, measured: a model trained on motion capture loses a lot on camera body points. On REHAB24-6 squats
(which have both) it fell from 0.83 to 0.55 macro F1; putting the camera data on its own scale won back part of it
(0.69). So the score below is the motion-capture score, and `ml/calibrate_camera.py` must calibrate the model with a
few camera clips before the app uses it (`ml/transfer_check.py` repeats the measurement).
""")
code(UIPRMD_CODE)
code(r"""
STS = None
if SIT_TO_STAND:
    t0 = time.time()
    raw = fetch_sit_to_stand(UIPRMD_SUBJECTS)
    STS = {
        "lm": np.stack([resample(lm.astype(np.float64)).astype(np.float32) for lm, _, _, _ in raw]),
        "mistake": np.array([m for _, m, _, _ in raw]),
        "person": np.array([s for _, _, s, _ in raw]),
        "duration": np.array([d for _, _, _, d in raw], dtype=np.float32),
    }
    print(f"sit-to-stand: {len(raw)} repetitions from {len(set(STS['person']))} people in {time.time() - t0:.0f}s")
""")

md(r"""
## 4. The features (copied from `train_model.ipynb`)

Angles per frame, then 11 numbers per angle curve. Identical to the notebook and to the browser (`web/src/lib/pose/features.ts`).
""")
code(FEATURES)
code(SUMMARISE)
code(SCORES)

md(r"""
## 5. Models, tested honestly

Leave one person out: every score below is measured on a person the model never saw. Choosing the best of several
on the same test flatters it slightly; your own recorded clips are the fair check.
""")
code("from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier\n"
     "from sklearn.linear_model import LogisticRegression\n"
     "from sklearn.pipeline import make_pipeline\n"
     "from sklearn.preprocessing import StandardScaler\n\n\n" + MODEL_CODE)

code(r"""
NAMES = {1: "arm abduction", 2: "arm VW", 4: "leg abduction", 5: "lunge", 6: "squat"}
# Each task: name, repetitions, which REHAB24-6 exercise's feature settings to use (sit-to-stand: like the squat,
# both legs, not one-sided), where the data came from, and which tracker the browser must use with it.
TASKS = []
for e in EXERCISES:
    m = REPS["exercise"] == e if REPS else np.zeros(0, bool)
    TASKS.append((NAMES[e], {k: v[m] for k, v in REPS.items()} if REPS else {}, e,
                  "REHAB24-6 (CC BY-NC 4.0, research use only)", POSE_MODEL))
if STS is not None:
    TASKS.append(("sit to stand", STS, 6, "UI-PRMD Vicon motion capture (public domain, ODC PDDL 1.0)", "heavy"))
CANDIDATES = {
    "logistic regression": lambda: logistic(0.1),
    "random forest": forest,
    "gradient boosting": boosting,
    "ensemble: logistic + forest + boosting": lambda: Ensemble([lambda: logistic(0.1), forest, boosting]),
}
BEST = {}
for task, data, e, source, pose in TASKS:
    if not data or len(set(data["person"])) < 3:
        print(f"{task}: not enough people for an honest test, skipped"); continue
    names, sig = signals(data["lm"], e)
    X = summarise(sig, data["duration"].astype(np.float32))
    y, who = data["mistake"], data["person"]
    print(f"\n{task}: {len(y)} samples, {len(set(who))} people, {y.mean():.0%} with a mistake")
    results = {}
    for name, make in CANDIDATES.items():
        s = scores(y, loso(make, X, y, who))
        results[name] = s
        print(f"  {name:42s} macro F1 {s['macro F1']:.2f}   AUC {s['AUC']:.2f}")
    best = max(results, key=lambda k: (round(results[k]["macro F1"], 3), results[k]["AUC"]))
    BEST[task] = (best, results[best], X, y, who, names, e, source, pose)
    print(f"  best: {best}")
""")

md(r"""
## 6. Export for the app

Trains the best model on everyone, checks that the exported file reproduces scikit-learn, and downloads it.
""")
code(r"""
import json
for task, (best, s, X, y, who, names, e, source, pose) in BEST.items():
    final = CANDIDATES[best]().fit(X, y)
    body = to_dict(final)
    gap = max(abs(predict_from_dict(body, row) - p) for row, p in zip(X[:60], final.predict_proba(X[:60])[:, 1]))
    assert gap < 1e-6, f"export does not reproduce scikit-learn ({gap})"
    spec = {"exercise": task, "model": best, "body_area": AREA[e], "one_sided": e in WORKING_SIDE_BY,
            "working_side_by": list(WORKING_SIDE_BY.get(e, [])), "pose_model": pose, "frames": 64,
            "signals": names, "stats": STATS, "features": [f"{n}:{st}" for n in names for st in STATS] + ["duration"],
            "tested_on_unseen_people": {k: round(float(v), 3) for k, v in s.items()},
            "training": {"samples": int(len(y)), "people": int(len(set(who))), "dataset": source},
            **body}
    out = Path(f"{task.replace(' ', '_')}.json")
    out.write_text(json.dumps(spec))
    print(f"saved {out} ({out.stat().st_size / 1e3:.0f} kB): {best}, macro F1 {s['macro F1']:.2f} on unseen people")
    try:
        from google.colab import files
        files.download(str(out))
    except ImportError:
        pass                                     # not on Colab: the file is in the current folder
shutil.rmtree(WORK, ignore_errors=True)
""")

nb = nbf.v4.new_notebook(cells=cells, metadata={"kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},
                                                 "language_info": {"name": "python"}})
nbf.write(nb, sys.argv[1] if len(sys.argv) > 1 else str(ML / "colab_train.ipynb"))
print("wrote", sys.argv[1] if len(sys.argv) > 1 else ML / "colab_train.ipynb", len(cells), "cells")
