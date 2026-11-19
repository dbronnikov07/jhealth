"""Train and honestly test one jHealth exercise model from every dataset we have for it.

    ~/jhealth-cache/venv/bin/python train_exercise.py arm_raise             # compare, print the table
    ~/jhealth-cache/venv/bin/python train_exercise.py squat --export        # ...and export the winner

What it does, in order:
  1. Loads every source for the exercise (camera: REHAB24-6 heavy tracker, REHAB26 MediaPipe; lab: UI-PRMD Vicon,
     IntelliRehabDS Kinect). All are already turned into MediaPipe's 33-point layout and cut into repetitions by
     their own scripts (build_dataset.py, rehab26.py, uiprmd.py, irds.py).
  2. Computes the same features the browser computes (notebook signals + 11 statistics per signal).
  3. Tests on people the model never saw: every person in the TEST source is hidden in turn; the model trains on
     everyone else, from every source. People never cross from training to test, even between sources.
  4. Tries training on the test source alone, on all sources, and on all sources with each source put on its own
     scale ("per-source standardisation": subtract the source's average and divide by its spread, which removes
     most of the difference between a camera and a motion-capture lab).
Every number printed is macro F1 (and AUC) on unseen people of the named test source.
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
from sklearn.metrics import f1_score, roc_auc_score  # noqa: E402
from train_squat import Ensemble, boosting, forest, logistic, predict_from_dict, to_dict  # noqa: E402

CACHE = Path.home() / "jhealth-cache"
DATA = HERE / "data"


# ---------------------------------------------------------------- sources: (landmarks, mistake 0/1, person, duration)

def rehab24(ex_id, heavy=True):
    f = DATA / ("reps_heavy_all.npz" if heavy else "reps.npz")
    d = np.load(f)
    m = d["exercise"] == ex_id
    return d["lm"][m].astype(np.float32), 1 - d["correct"][m], np.array([f"R24-{p}" for p in d["person"][m]]), d["duration"][m]


def rehab26(ex_id):
    d = np.load(CACHE / f"rehab26_ex{ex_id}.npz")
    return d["lm"].astype(np.float32), 1 - d["correct"], np.array([f"R26-{p}" for p in d["person"]]), d["duration"]


def uiprmd(code):
    d = np.load(CACHE / f"uiprmd_{code}.npz")
    return d["lm"].astype(np.float32), d["y"], np.array([f"UI-{p}" for p in d["who"]]), d["dur"]


def irds(gestures):
    d = np.load(CACHE / "irds.npz")
    m = np.isin(d["gesture"], gestures)
    return d["lm"][m].astype(np.float32), 1 - d["correct"][m], np.array([f"IR-{p}" for p in d["person"][m]]), d["duration"][m]


SOURCES = {
    "squat": {"REHAB24 camera": lambda: rehab24(6), "REHAB26 camera": lambda: rehab26(6), "UI-PRMD deep squat": lambda: uiprmd("m01")},
    "sit_to_stand": {"UI-PRMD sit-to-stand": lambda: uiprmd("m05")},
    "arm_raise": {"REHAB24 camera": lambda: rehab24(1), "REHAB26 camera": lambda: rehab26(1),
                  "UI-PRMD shoulder abduction": lambda: uiprmd("m07"), "IRDS abduction (patients)": lambda: irds([4, 5])},
    "seated_knee_extension": {},
}


def featurize(ns, lm, dur, feature_set):
    names, sig = ns["signals"](lm, feature_set)
    X = ns["summarise"](sig, dur.astype(np.float32))
    return X, names


def zscore_by(X, groups, stats=None):
    """Put each group (source) on its own scale. Returns (X, {group: (mean, std)})."""
    out, stats = np.empty_like(X), dict(stats or {})
    for g in np.unique(groups):
        m = groups == g
        if g not in stats:
            sd = X[m].std(0)
            stats[g] = (X[m].mean(0), np.where(sd > 1e-9, sd, 1.0))
        out[m] = (X[m] - stats[g][0]) / stats[g][1]
    return out, stats


CANDIDATES = {
    "logistic": lambda: logistic(0.1),
    "forest": forest,
    "boosting": boosting,
    "ensemble (logistic + forest + boosting)": lambda: Ensemble([lambda: logistic(0.1), forest, boosting]),
}


def loso(make, X, y, who, src, test_src, train_srcs, per_source):
    """Hide each person of test_src in turn; train on everyone else from train_srcs."""
    test = src == test_src
    prob = np.full(len(y), np.nan)
    for p in np.unique(who[test]):
        hidden = who == p
        train = np.isin(src, train_srcs) & ~hidden
        Xtr, Xte = X[train], X[hidden]
        if per_source:
            # the hidden person's own source is scaled with statistics from that source's OTHER people only
            Xtr, stats = zscore_by(Xtr, src[train])
            Xte, _ = zscore_by(Xte, src[hidden], stats)
        prob[hidden] = make().fit(Xtr, y[train]).predict_proba(Xte)[:, 1]
    p, t = prob[test], y[test]
    return f1_score(t, p > 0.5, average="macro"), roc_auc_score(t, p)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("exercise", choices=list(SOURCES))
    ap.add_argument("--test", nargs="*", help="which sources to report (default: all)")
    ap.add_argument("--models", nargs="*", default=list(CANDIDATES))
    ap.add_argument("--export", action="store_true", help="export the best camera-tested strategy")
    ap.add_argument("--strategy", help="export this training strategy instead of the best (name as printed)")
    ap.add_argument("--model", dest="export_model", help="export this model instead of the best (name as printed)")
    args = ap.parse_args()

    ns = notebook_code.load()
    cfg = EXERCISES[args.exercise]
    parts, missing = [], []
    for name, load in SOURCES[args.exercise].items():
        try:
            lm, y, who, dur = load()
        except FileNotFoundError as e:
            missing.append(f"{name} ({Path(str(e).split(': ')[-1].strip(chr(39))).name})")
            continue
        parts.append((name, lm, y, who, dur))
    if missing:
        print("not on disk yet, skipped:", ", ".join(missing))
    X = np.vstack([featurize(ns, p[1], p[4], cfg["features"])[0] for p in parts])
    names = featurize(ns, parts[0][1][:2], parts[0][4][:2], cfg["features"])[1]
    y = np.concatenate([p[2] for p in parts]).astype(int)
    who = np.concatenate([p[3] for p in parts])
    src = np.concatenate([[p[0]] * len(p[2]) for p in parts])
    print(f"\n{cfg['name']}: {len(y)} samples from {len(set(who))} people")
    for p in parts:
        print(f"  {p[0]:30s} {len(p[2]):5d} samples, {len(set(p[3])):2d} people, {p[2].mean():.0%} with a mistake")

    results = []
    for test_src in (args.test or [p[0] for p in parts]):
        others = [p[0] for p in parts]
        strategies = [("this source only", [test_src], False)]
        cams = [o for o in others if "camera" in o]
        if len(cams) > 1 and test_src in cams:
            strategies += [("camera sources only", cams, False)]
        if len(others) > 1:
            strategies += [("all sources", others, False), ("all sources, each on its own scale", others, True)]
        print(f"\n  tested on unseen people of: {test_src}")
        print(f"    {'training':38s} {'model':42s} {'macro F1':>8s} {'AUC':>6s}")
        for label, train_srcs, per_source in strategies:
            for mname in args.models:
                f1, auc = loso(CANDIDATES[mname], X, y, who, src, test_src, train_srcs, per_source)
                results.append((test_src, label, mname, f1, auc, train_srcs, per_source))
                print(f"    {label:38s} {mname:42s} {f1:8.3f} {auc:6.3f}", flush=True)

    if not args.export:
        return
    camera = [r for r in results if "camera" in r[0]] or results
    if args.strategy or args.export_model:
        camera = [r for r in camera if r[1] == (args.strategy or r[1]) and r[2] == (args.export_model or r[2])]
        if not camera:
            sys.exit("no tested result matches --strategy/--model")
    best = max(camera, key=lambda r: (round(r[3], 3), r[4]))
    also = [f"{r[0]}: {r[3]:.3f}" for r in results if r[1] == best[1] and r[2] == best[2] and r is not best]
    test_src, label, mname, f1, auc, train_srcs, per_source = best
    print(f"\nexporting: trained on {label}, {mname}: macro F1 {f1:.3f}, AUC {auc:.3f} on unseen people of {test_src}")
    train = np.isin(src, train_srcs)
    Xtr, stats = (zscore_by(X[train], src[train]) if per_source else (X[train], None))
    final = CANDIDATES[mname]().fit(Xtr, y[train])
    body = to_dict(final)
    probe = Xtr[:60]
    gap = max(abs(predict_from_dict(body, row) - q) for row, q in zip(probe, final.predict_proba(probe)[:, 1]))
    assert gap < 1e-6, f"the exported model does not reproduce scikit-learn ({gap})"
    feats = [f"{n}:{s}" for n in names for s in ns["STATS"]] + ["duration"]
    side = ns["WORKING_SIDE_BY"].get(cfg["features"]) if hasattr(ns["WORKING_SIDE_BY"], "get") else None
    spec = {
        "exercise": args.exercise, "model": mname, "frames": 64, "signals": names, "stats": ns["STATS"], "features": feats,
        "one_sided": cfg["features"] in (1, 4, 5), "working_side_by": list(side) if side else [],
        "pose_model": "heavy",
        "tested_on_unseen_people": {"source": test_src, "macro F1": round(float(f1), 3), "AUC": round(float(auc), 3),
                                    "training": label, "same strategy on other sources": "; ".join(also)},
        "training": {"samples": int(train.sum()), "people": int(len(set(who[train]))), "sources": list(train_srcs)},
        **body,
    }
    if per_source:
        cam = "REHAB24 camera" if "REHAB24 camera" in stats else test_src
        # The browser sees camera body points: scale its features like the camera source before the model.
        spec["input_scale"] = {"source": cam, "mean": stats[cam][0].tolist(), "scale": stats[cam][1].tolist()}
    out = HERE / "models" / f"{args.exercise}.json"
    out.write_text(json.dumps(spec))
    web = HERE.parent / "web" / "public" / "models"
    if web.exists():
        shutil.copy(out, web / out.name)
    print(f"wrote {out} ({out.stat().st_size // 1024} kB)" + (" and copied it to the web app" if web.exists() else ""))


if __name__ == "__main__":
    main()
