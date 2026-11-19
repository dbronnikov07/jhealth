"""IntelliRehabDS (IRDS) arm exercises -> repetitions in the same format as our other data.

IRDS (Zenodo 4610859, CC BY 4.0; Miron et al., Data 2021): 29 people, 15 of them patients (mostly after a stroke)
and 14 healthy, filmed with a Kinect One while doing 9 rehab gestures standing, on a chair or in a wheelchair.
Each repetition is one file, and a physiotherapist marked it correct (1) or incorrect (2).

Gestures used here (the arm raises): 2/3 shoulder flexion left/right, 4/5 shoulder abduction left/right,
6 shoulder forward elevation (both arms). 0/1 (elbow flexion) and 7/8 (side tap) are left out.

The Kinect gives 25 joint positions in metres in the camera's frame (x to the sensor's left, y up, z away from
the sensor). We turn that into MediaPipe's layout (x to the image right, y down, z away from the camera): a
180-degree turn about the z axis, which keeps left and right correct. Only the 199 MB skeleton archive is
downloaded (never the 40 GB of depth images), read, and deleted; ~/jhealth-cache/irds.npz keeps the result.

    ~/jhealth-cache/venv/bin/python irds.py
"""
import re
import sys
import zipfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from build_dataset import resample  # noqa: E402

URL = "https://zenodo.org/api/records/4610859/files/SkeletonData.zip/content"
CACHE = Path.home() / "jhealth-cache"
KINECT_HZ = 30
GESTURES = {2: "shoulder flexion left", 3: "shoulder flexion right", 4: "shoulder abduction left",
            5: "shoulder abduction right", 6: "shoulder forward elevation"}
# Kinect v2 joint order (readme) -> MediaPipe index
K = dict(SpineBase=0, SpineMid=1, Neck=2, Head=3, ShoulderLeft=4, ElbowLeft=5, WristLeft=6, HandLeft=7,
         ShoulderRight=8, ElbowRight=9, WristRight=10, HandRight=11, HipLeft=12, KneeLeft=13, AnkleLeft=14,
         FootLeft=15, HipRight=16, KneeRight=17, AnkleRight=18, FootRight=19)
TO_MP = {0: "Head", 11: "ShoulderLeft", 12: "ShoulderRight", 13: "ElbowLeft", 14: "ElbowRight", 15: "WristLeft",
         16: "WristRight", 19: "HandLeft", 20: "HandRight", 23: "HipLeft", 24: "HipRight", 25: "KneeLeft",
         26: "KneeRight", 27: "AnkleLeft", 28: "AnkleRight", 29: "AnkleLeft", 30: "AnkleRight",
         31: "FootLeft", 32: "FootRight"}


def kinect_to_mediapipe(rows):
    """(frames, 75) Kinect camera-space joints -> (frames, 33, 3) MediaPipe-style world points around the hips."""
    J = np.asarray(rows, dtype=np.float64).reshape(len(rows), 25, 3)
    out = np.full((len(J), 33, 3), np.nan)
    for i, name in TO_MP.items():
        out[:, i] = J[:, K[name]]
    out[..., 0] *= -1   # x: sensor's left -> image right
    out[..., 1] *= -1   # y: up -> down
    centre = (out[:, 23] + out[:, 24]) / 2
    return out - centre[:, None, :]


def main():
    import requests
    tmp = CACHE / "irds_SkeletonData.zip"
    if not tmp.exists():
        print("downloading the 199 MB skeleton archive (depth images are skipped) ...", flush=True)
        with requests.get(URL, stream=True, timeout=120) as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
    cols = {k: [] for k in ("lm", "correct", "person", "gesture", "position", "rep", "duration")}
    with zipfile.ZipFile(tmp) as z:
        for name in z.namelist():
            m = re.search(r"Simplified/(\d+)_(\d+)_(\d+)_(\d+)_([12])_(\w+)\.txt$", name)
            if not m or int(m.group(3)) not in GESTURES:
                continue
            rows = [list(map(float, line.split(","))) for line in z.read(name).decode().splitlines() if line.count(",") >= 74]
            if len(rows) < 10:
                continue
            lm = kinect_to_mediapipe([r[:75] for r in rows])
            if np.isnan(lm[:, [11, 12, 13, 14, 15, 16, 23, 24]]).any():
                continue
            for k, v in (("lm", resample(lm, 64).astype(np.float16)), ("correct", int(m.group(5) == "1")),
                         ("person", int(m.group(1))), ("gesture", int(m.group(3))), ("position", m.group(6)),
                         ("rep", int(m.group(4))), ("duration", len(rows) / KINECT_HZ)):
                cols[k].append(v)
    out = {k: np.array(v) for k, v in cols.items()}
    out["duration"] = out["duration"].astype(np.float32)
    np.savez_compressed(CACHE / "irds.npz", **out)
    tmp.unlink()
    print(f"saved {CACHE / 'irds.npz'}: {len(out['correct'])} repetitions, {len(set(out['person']))} people, "
          f"{out['correct'].mean():.0%} correct")
    for g, name in GESTURES.items():
        m = out["gesture"] == g
        print(f"  {g} {name:28s} {m.sum():4d} reps, {out['correct'][m].mean():.0%} correct, people {len(set(out['person'][m]))}")


if __name__ == "__main__":
    main()
