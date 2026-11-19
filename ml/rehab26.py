"""REHAB26-ViewAngles -> repetitions in the same format as our REHAB24-6 data.

REHAB26-ViewAngles (Zenodo 23018128, CC BY-NC 4.0, from the REHAB24-6 group): 5 people, three synchronised
iPhones filming each repetition from a different angle (people turned 0 to 90 degrees, so front, half-profile and
profile views), and the authors already ran MediaPipe Pose on every video. Per exercise about 556 repetitions,
half correct and half with one named mistake (for squats: knees inside, too shallow, lifted heels, torso to the
side, knees forward).

We only stream the MediaPipe files we need (squat and arm abduction, about 245 MB) out of the 686 MB archive,
one file at a time; the 8.4 GB of video is never touched. Each repetition is cut out with the authors' frame
numbers, stretched to 64 frames, and saved to ~/jhealth-cache/rehab26_ex<id>.npz (a few MB).

    ~/jhealth-cache/venv/bin/python rehab26.py            # squat (6) and arm abduction (1)
    ~/jhealth-cache/venv/bin/python rehab26.py 6          # just the squat
"""
import csv
import io
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from build_dataset import fill_gaps, resample  # noqa: E402

RECORD = "https://zenodo.org/api/records/23018128/files"
CACHE = Path.home() / "jhealth-cache"
FPS = 30
T = 64


def segmentation():
    import requests
    text = requests.get(f"{RECORD}/Segmentation.csv/content", timeout=60).text
    return list(csv.DictReader(io.StringIO(text), delimiter=";"))


def to_world(arr):
    """The authors' *_3d.npy arrays: (frames, 33, 3 or more). Keep x, y, z."""
    a = np.asarray(arr, dtype=np.float64)
    if a.ndim == 2:
        a = a.reshape(len(a), 33, -1)
    return a[:, :, :3]


def build(exercise):
    from remotezip import RemoteZip
    rows = [r for r in segmentation() if r["exercise_id"] == str(exercise)]
    by_video = {}
    for r in rows:
        by_video.setdefault(r["video_id"], []).append(r)
    cols = {k: [] for k in ("lm", "correct", "person", "cam", "view_angle", "orientation", "error", "rep", "duration")}
    with RemoteZip(f"{RECORD}/jointSequences-mediapipe.zip/content") as z:
        for video, reps in sorted(by_video.items()):
            for cam in (1, 2, 3):
                name = f"mediapipe/ex{exercise}/{video}_cam{cam}_3d.npy"
                try:
                    world = to_world(np.load(io.BytesIO(z.read(name)), allow_pickle=False))
                except KeyError:
                    print("missing", name)
                    continue
                for r in reps:
                    a, b = int(r["first_frame"]), int(r["last_frame"])
                    seg = world[a:b + 1].copy()
                    if len(seg) < 8 or np.isnan(seg).mean() > 0.3:
                        continue
                    seg = fill_gaps(seg)
                    o = int(r["person_orientation"])
                    view = {1: -o, 2: 45 - o, 3: 90 - o}[cam]          # 0 = facing the camera, +-90 = profile
                    for k, v in (("lm", resample(seg, T).astype(np.float16)), ("correct", int(r["correctness_score"] == "1")),
                                 ("person", r["person"]), ("cam", cam), ("view_angle", view), ("orientation", o),
                                 ("error", r["error_description"] or ""), ("rep", int(r["repetition_number"])),
                                 ("duration", (b - a + 1) / FPS)):
                        cols[k].append(v)
            print(f"  {video}: {len(reps)} repetitions x 3 cameras", flush=True)
    out = {k: np.array(v) for k, v in cols.items()}
    out["duration"] = out["duration"].astype(np.float32)
    path = CACHE / f"rehab26_ex{exercise}.npz"
    np.savez_compressed(path, **out)
    print(f"saved {path}: {len(out['correct'])} rep-views, {out['correct'].mean():.0%} correct, people {sorted(set(out['person']))}")


if __name__ == "__main__":
    for ex in (sys.argv[1:] or ["6", "1"]):
        build(int(ex))
