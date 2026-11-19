"""Write a worked example for the browser port test: one repetition, Python's features and Python's score.

    ~/jhealth-cache/venv/bin/python make_parity.py squat arm_raise

For each exercise it reads the exported model (models/<exercise>.json), takes one real repetition, rounds its body
points to 5 decimals (the JSON precision), computes the features and the mistake probability in plain Python, and
writes models/parity_<exercise>.json. web/scripts/pose.test.ts then checks the browser gets the same numbers.
For the arm raise it uses a LEFT-arm repetition, so the browser's mirroring (working side -> "right") is tested too.
"""
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import notebook_code  # noqa: E402
from exercises import EXERCISES  # noqa: E402
from train_squat import predict_from_dict  # noqa: E402

CACHE = Path.home() / "jhealth-cache"


def example(exercise):
    if exercise == "arm_raise":
        d = np.load(CACHE / "irds.npz")
        i = int(np.flatnonzero(d["gesture"] == 4)[0])              # shoulder abduction, LEFT arm
        return d["lm"][i].astype(np.float64), float(d["duration"][i])
    d = np.load(HERE / "data" / "reps_heavy_all.npz")
    i = int(np.flatnonzero(d["exercise"] == 6)[0])
    return d["lm"][i].astype(np.float64), float(d["duration"][i])


def main(exercises):
    ns = notebook_code.load()
    for ex in exercises:
        spec = json.loads((HERE / "models" / f"{ex}.json").read_text())
        lm, dur = example(ex)
        rounded = np.nan_to_num(lm, nan=0.0).round(5)      # joints a Kinect does not track (face, fingers) are unused
        names, sig = ns["signals"](rounded[None], EXERCISES[ex]["features"])
        assert list(names) == spec["signals"], f"{ex}: feature names differ from the model's"
        x = ns["summarise"](sig, np.array([dur]))[0]
        z = x if "input_scale" not in spec else (x - np.array(spec["input_scale"]["mean"])) / np.array(spec["input_scale"]["scale"])
        p = float(predict_from_dict(spec, z))
        out = HERE / "models" / f"parity_{ex}.json"
        out.write_text(json.dumps({"exercise": ex, "landmarks": rounded.tolist(), "duration": dur,
                                   "features_from_rounded": x.tolist(), "p_mistake_from_rounded": p}))
        print(f"{out.name}: p(mistake) = {p:.4f}")


if __name__ == "__main__":
    main(sys.argv[1:] or ["squat"])
