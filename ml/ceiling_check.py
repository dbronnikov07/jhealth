"""DIAGNOSTIC - is our score limited by the pose tracker, or by the labels and the people?

REHAB24-6 was recorded in a motion-capture lab. Besides the videos it ships "ground truth" joint
positions measured with markers on the body suit. Those are far more precise than anything a
webcam model can guess from a flat picture.

So we run the SAME features and the SAME honest test twice:
    1. on the MediaPipe body points (what the browser will see)     <- the notebook's numbers
    2. on the motion-capture joints (a near-perfect ruler)           <- computed here

If the motion-capture score is much higher, the pose tracker is the bottleneck and a better tracker
or more camera data is worth chasing. If it is about the same, the limit is the labels and the
small number of people, and no amount of fiddling with the tracker will fix it.

Run:    ~/jhealth-cache/venv/bin/python ceiling_check.py
It reuses the feature code from train_model.ipynb (the notebook stays the single source of truth).
"""
import csv
import sys
import warnings
from pathlib import Path

import nbformat
import numpy as np

warnings.filterwarnings("ignore")
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from build_dataset import fill_gaps, resample  # noqa: E402

CACHE = Path.home() / "jhealth-cache"
MOCAP = CACHE / "mocap"
ZIP_URL = "https://zenodo.org/api/records/13305826/files/3d_joints.zip/content"
T = 64

# mocap joint (index in joints_names.txt)  ->  the MediaPipe slot our features read
MOCAP_TO_MP = {11: 7, 12: 12, 13: 8, 14: 13, 15: 9, 16: 14,      # shoulders, elbows, wrists
               23: 16, 24: 21, 25: 17, 26: 22, 27: 18, 28: 23}   # hips, knees, ankles
HEAD, HIPS = 4, 0


def fetch_mocap(videos):
    """Download only the 30 fps joint files we need (about 1 MB each) out of the 550 MB zip."""
    from remotezip import RemoteZip
    MOCAP.mkdir(exist_ok=True)
    todo = [v for v in videos if not (MOCAP / f"{v[1]}.npy").exists()]
    if not todo:
        return
    print(f"downloading {len(todo)} mocap files ...")
    with RemoteZip(ZIP_URL) as z:
        for ex, vid in todo:
            (MOCAP / f"{vid}.npy").write_bytes(z.read(f"Ex{ex}/{vid}-30fps.npy"))


def to_mediapipe_layout(joints):
    """(frames, 26, 3 or 4) mocap -> (frames, 33, 3) in metres, y pointing down like MediaPipe's world."""
    j = joints[..., :3].astype(np.float64) / 100.0            # virtual centimetres -> metres
    up = (j[:, HEAD] - j[:, HIPS]).mean(0)
    up /= np.linalg.norm(up)
    target = np.array([0.0, -1.0, 0.0])                       # "up" must become -y
    v = np.cross(up, target); s = np.linalg.norm(v); c = float(up @ target)
    if s < 1e-8:
        R = np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0])
    else:                                                     # proper rotation (keeps left/right handedness)
        K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
        R = np.eye(3) + K + K @ K * ((1 - c) / s ** 2)
    out = np.zeros((len(j), 33, 3))
    for mp_i, mc_i in MOCAP_TO_MP.items():
        out[:, mp_i] = j[:, mc_i] @ R.T
    return out


def build_mocap_reps():
    rows = [r for r in csv.DictReader(open(CACHE / "Segmentation.csv"), delimiter=";")
            if r["mocap_erroneous"] == "0"]
    fetch_mocap(sorted({(int(r["exercise_id"]), r["video_id"]) for r in rows}))
    cols = {k: [] for k in ("lm", "exercise", "person", "correct", "cam", "view", "subtype", "video", "rep", "duration")}
    cache = {}
    for r in rows:
        v = r["video_id"]
        if v not in cache:
            cache[v] = to_mediapipe_layout(np.load(MOCAP / f"{v}.npy"))
        a, b = int(r["first_frame"]), int(r["last_frame"])
        seg = cache[v][a:b + 1]
        if len(seg) < 10:
            continue
        cols["lm"].append(resample(seg, T).astype(np.float32))
        cols["exercise"].append(int(r["exercise_id"])); cols["person"].append(int(r["person_id"]))
        cols["correct"].append(int(r["correctness"])); cols["cam"].append(17)
        cols["view"].append(r["cam17_orientation"]); cols["subtype"].append(r["exercise_subtype"])
        cols["video"].append(v); cols["rep"].append(int(r["repetition_number"]))
        cols["duration"].append((b - a + 1) / 30)
    out = {k: np.array(x) for k, x in cols.items()}
    out["duration"] = out["duration"].astype(np.float32)
    return out


def notebook_namespace(reps_path):
    """Run the notebook's setup and feature cells, but pointed at a different reps file."""
    nb = nbformat.read(HERE / "train_model.ipynb", 4)
    src = [c.source for c in nb.cells if c.cell_type == "code"]
    ns = {}
    setup = src[0].replace('DATA = Path("data/reps.npz") if Path("data/reps.npz").exists() else Path("reps.npz")',
                           f"DATA = Path({str(reps_path)!r})")
    setup = setup.replace('d = np.load(DATA)', 'd = dict(np.load(DATA)); d["lm"] = d["lm"].astype(np.float16)')
    exec(setup, ns)
    for s in src[1:]:
        if s.startswith(("# MediaPipe numbers", "STATS =", "def leave_one_person_out", "def always_correct")):
            exec(s, ns)
    return ns


def macro_f1_table(ns, label):
    out = {}
    for e in ns["EXERCISES"]:
        y, who, x = ns["Y"][e], ns["WHO"][e], ns["X"][e]
        res = {}
        for name, make in (("logistic", ns["logistic"]), ("forest", ns["forest"])):
            res[name] = ns["scores"](y, ns["leave_one_person_out"](make, x, y, who))["macro F1"]
        out[ns["NAMES"][e]] = res
        print(f"  {label:10s} {ns['NAMES'][e]:14s} n={len(y):4d}  logistic {res['logistic']:.2f}   forest {res['forest']:.2f}", flush=True)
    return out


if __name__ == "__main__":
    reps = build_mocap_reps()
    path = CACHE / "reps_mocap.npz"
    np.savez_compressed(path, **reps)
    print(f"mocap reps: {len(reps['correct'])}")
    print("\nSAME features, SAME honest test (hide one person), two different rulers:")
    camera = macro_f1_table(notebook_namespace(HERE / "data" / "reps.npz"), "MediaPipe")
    truth = macro_f1_table(notebook_namespace(path), "mocap")
    print("\nmacro F1, best of the two simple models, on unseen people:")
    print(f"  {'exercise':14s} {'MediaPipe':>10s} {'mocap':>8s}")
    for k in camera:
        print(f"  {k:14s} {max(camera[k].values()):10.2f} {max(truth[k].values()):8.2f}")
