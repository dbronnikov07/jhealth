"""Choose when the app should SAY "that rep had a mistake": a cut-off that keeps false alarms rare.

A model gives every repetition a probability of a mistake. Where we draw the line decides the trade-off:
  precision  of the reps we flag, how many really had a mistake (a false alarm discourages a patient)
  recall     of the reps that had a mistake, how many we flag
For a home-rehab coach, precision matters more: an older patient told "wrong" after a good rep stops trusting it.

This script runs the same honest test as train_exercise.py (camera datasets, each person hidden in turn, the same
model type as the export), collects the hidden people's probabilities, and picks the lowest cut-off whose precision
is at least --target (default 0.90). It writes the cut-off and the measured precision/recall into the exported model
(models/<exercise>.json and the web copy). The quality score shown to the patient is unchanged; the cut-off only
decides when the app flags a rep.

    ~/jhealth-cache/venv/bin/python operating_point.py squat arm_raise
"""
import argparse
import json
import shutil
import sys
import warnings
from pathlib import Path

import numpy as np

warnings.filterwarnings("ignore")
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import notebook_code  # noqa: E402
from exercises import EXERCISES  # noqa: E402
from train_exercise import CANDIDATES, SOURCES, featurize  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("exercises", nargs="+")
    ap.add_argument("--target", type=float, default=0.90)
    args = ap.parse_args()
    ns = notebook_code.load()
    for ex in args.exercises:
        spec_path = HERE / "models" / f"{ex}.json"
        spec = json.loads(spec_path.read_text())
        make = CANDIDATES[spec["model"]]
        train_srcs = spec["training"]["sources"]
        parts = [(name, *SOURCES[ex][name]()) for name in train_srcs]
        X = np.vstack([featurize(ns, lm, dur, EXERCISES[ex]["features"])[0] for _, lm, _, _, dur in parts])
        y = np.concatenate([p[2] for p in parts]).astype(int)
        who = np.concatenate([p[3] for p in parts])
        prob = np.zeros(len(y))
        for p in np.unique(who):
            h = who == p
            prob[h] = make().fit(X[~h], y[~h]).predict_proba(X[h])[:, 1]

        rows = []
        for t in np.round(np.arange(0.30, 0.96, 0.01), 2):
            flag = prob >= t
            tp = int((flag & (y == 1)).sum())
            prec = tp / max(1, flag.sum())
            rec = tp / max(1, (y == 1).sum())
            rows.append((t, prec, rec, int(flag.sum())))
        ok = [r for r in rows if r[1] >= args.target and r[3] >= 20]
        chosen = ok[0] if ok else max(rows, key=lambda r: (r[1], r[2]))
        at_half = min(rows, key=lambda r: abs(r[0] - 0.5))
        print(f"\n{ex}: {len(y)} reps from {len(set(who))} people (camera), {y.mean():.0%} with a mistake")
        print(f"  cut-off 0.50: precision {at_half[1]:.2f}, recall {at_half[2]:.2f}")
        print(f"  cut-off {chosen[0]:.2f}: precision {chosen[1]:.2f}, recall {chosen[2]:.2f}"
              + ("" if ok else f"  (precision {args.target} not reachable; best available)"))
        for t, prec, rec, n in rows[::5]:
            print(f"    {t:.2f}  precision {prec:.2f}  recall {rec:.2f}  flagged {n}")

        spec["flag_threshold"] = float(chosen[0])
        spec["operating_point"] = {
            "what": "flag a rep as a mistake only when p(mistake) >= flag_threshold",
            "target_precision": args.target, "precision": round(chosen[1], 3), "recall": round(chosen[2], 3),
            "at_0.5": {"precision": round(at_half[1], 3), "recall": round(at_half[2], 3)},
            "tested_on": f"leave-one-person-out over {len(set(who))} people of {', '.join(train_srcs)}",
        }
        spec_path.write_text(json.dumps(spec))
        web = HERE.parent / "web" / "public" / "models" / spec_path.name
        if web.exists():
            shutil.copy(spec_path, web)
        print(f"  saved flag_threshold {chosen[0]:.2f} into {spec_path.name}" + (" and the web copy" if web.exists() else ""))


if __name__ == "__main__":
    main()
