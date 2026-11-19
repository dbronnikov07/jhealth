"""Calibrate a motion-capture-trained model (sit-to-stand from UI-PRMD) to camera body points.

Why: a model trained on motion capture loses a lot when it scores camera body points (transfer_check.py: squats
0.83 -> 0.55 macro F1). Putting the camera data on its own scale, using the camera's own averages, won back a good
part of it (0.55 -> 0.69). For a logistic-regression model that is exact and simple: its "mean" and "scale" (the
averages it standardises with) are replaced by the camera's.

What you need: a few sit-to-stand clips recorded on the demo camera, any mix of good and bad, NO labels needed,
turned into repetitions by extract_clips.py. Then:

    ~/jhealth-cache/venv/bin/python calibrate_camera.py --own data/own_reps.npz
    (or select the clips: --labels good shallow ...  --people anna ben)

Writes models/sit_to_stand_camera.json and copies it to the web app, which then prefers it.
Light: a few seconds.
"""
import argparse
import json
import shutil
import sys
from datetime import date
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import notebook_code  # noqa: E402


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", type=Path, default=HERE / "models" / "sit_to_stand.json")
    ap.add_argument("--own", type=Path, required=True, help="repetitions from extract_clips.py (camera body points)")
    ap.add_argument("--labels", nargs="*", help="only clips with these labels (default: all)")
    ap.add_argument("--people", nargs="*", help="only these people (default: all)")
    ap.add_argument("--min-reps", type=int, default=20)
    args = ap.parse_args()

    spec = json.loads(args.model.read_text())
    if spec.get("type") != "logistic":
        sys.exit(f"{args.model.name} is a {spec.get('type')} model; camera calibration is only defined for logistic regression.")
    d = np.load(args.own, allow_pickle=False)
    keep = np.ones(len(d["good"]), bool)
    if args.labels:
        keep &= np.isin(d["label"], args.labels)
    if args.people:
        keep &= np.isin(d["person"], args.people)
    if keep.sum() < args.min_reps:
        sys.exit(f"only {keep.sum()} repetitions selected; record more (at least {args.min_reps}) for a stable calibration.")

    ns = notebook_code.load()
    names, sig = ns["signals"](d["lm"][keep].astype(np.float32), 6)      # sit-to-stand uses the squat's settings
    X = ns["summarise"](sig, d["duration"][keep].astype(np.float32))
    feats = [f"{n}:{s}" for n in names for s in ns["STATS"]] + ["duration"]
    if feats != spec["features"]:
        sys.exit("the clips' features do not match the model's; was the model trained with different settings?")

    calibrated = dict(spec)
    calibrated["mean"] = X.mean(0).tolist()
    calibrated["scale"] = np.where(X.std(0) > 1e-9, X.std(0), 1.0).tolist()
    calibrated["exercise"] = spec["exercise"]
    calibrated["calibration"] = {
        "what": "mean and scale replaced by camera body points' own (per-source standardisation)",
        "reps": int(keep.sum()), "people": sorted(set(map(str, d["person"][keep]))),
        "labels": sorted(set(map(str, d["label"][keep]))), "date": date.today().isoformat(),
        "expected": "on squats this recovered macro F1 0.55 -> 0.69 (transfer_check.py); check it on a held-out teammate",
    }
    out = args.model.with_name(args.model.stem + "_camera.json")
    out.write_text(json.dumps(calibrated))
    web = HERE.parent / "web" / "public" / "models"
    if web.exists():
        shutil.copy(out, web / out.name)
    print(f"calibrated on {keep.sum()} camera repetitions from {len(set(d['person'][keep]))} people -> {out.name}"
          + (" (copied to web/public/models: the app now uses it)" if web.exists() else ""))


if __name__ == "__main__":
    main()
