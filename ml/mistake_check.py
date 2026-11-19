"""How well can the app catch each NAMED mistake, on people it never saw? (REHAB26: camera, MediaPipe, 5 people)

REHAB26 gives the exact mistake of every incorrect repetition (too shallow, knees inside, arm too low, bent arm, ...).
For each mistake we take its repetitions plus all correct ones and run two honest leave-one-person-out tests:

  one-number rule   the single measurement and threshold that best separate the mistake from good reps, chosen on
                    the other four people only (this is what a spoken cue like "bend a little deeper" uses)
  model             a logistic regression on all features, mistake vs good

Every view angle (front to profile) is included, so the number covers how the patient places the camera.

    ~/jhealth-cache/venv/bin/python mistake_check.py
"""
import sys
import warnings
from pathlib import Path

import numpy as np

warnings.filterwarnings("ignore")
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import notebook_code  # noqa: E402
from sklearn.metrics import f1_score  # noqa: E402
from train_squat import logistic  # noqa: E402

CACHE = Path.home() / "jhealth-cache"
EX = {6: ("Squat", 6), 1: ("Arm raise to the side (abduction)", 1)}


def best_rule(X, y):
    """Feature, threshold and direction with the best macro F1 on (X, y)."""
    best = (-1, 0, 0.0, 1)
    for j in range(X.shape[1]):
        v = X[:, j]
        for t in np.quantile(v, np.linspace(0.05, 0.95, 37)):
            for sign in (1, -1):
                f = f1_score(y, sign * v > sign * t, average="macro")
                if f > best[0]:
                    best = (f, j, t, sign)
    return best[1:]


def main():
    ns = notebook_code.load()
    for ex_id, (title, fs) in EX.items():
        f = CACHE / f"rehab26_ex{ex_id}.npz"
        if not f.exists():
            print(f"{f.name} missing: run rehab26.py first")
            continue
        d = np.load(f)
        names, sig = ns["signals"](d["lm"].astype(np.float32), fs)
        X = ns["summarise"](sig, d["duration"].astype(np.float32))
        feats = [f"{n}:{s}" for n in names for s in ns["STATS"]] + ["duration"]
        good = d["correct"] == 1
        print(f"\n{title}: {len(good)} rep-views, 5 people, all camera angles")
        print(f"  {'mistake':26s} {'reps':>5s}  {'one-number rule':>16s}  {'model':>6s}   rule chosen most often")
        for err in sorted(set(d["error"]) - {""}):
            m = good | (d["error"] == err)
            Xm, ym, who = X[m], (d["error"][m] == err).astype(int), d["person"][m]
            pr, pm, chosen = np.zeros(len(ym), int), np.zeros(len(ym)), []
            for p in np.unique(who):
                h = who == p
                j, t, sign = best_rule(Xm[~h], ym[~h])
                chosen.append(feats[j])
                pr[h] = sign * Xm[h, j] > sign * t
                pm[h] = logistic(0.1).fit(Xm[~h], ym[~h]).predict_proba(Xm[h])[:, 1]
            top = max(set(chosen), key=chosen.count)
            print(f"  {err.replace('ERR_', '').lower():26s} {ym.sum():5d}  {f1_score(ym, pr, average='macro'):16.2f}  "
                  f"{f1_score(ym, pm > 0.5, average='macro'):6.2f}   {top} ({chosen.count(top)}/5)", flush=True)


if __name__ == "__main__":
    main()
