"""STEP B for your own data: train the demo model on your teammates' clips and test it honestly.

Run after extract_clips.py:

    ~/jhealth-cache/venv/bin/python train_own.py                                   (squat)
    ~/jhealth-cache/venv/bin/python train_own.py --exercise arm_raise              (any of the four exercises)

What it does
  1. Loads your repetitions (data/own_reps.npz) and turns each into the same numbers the notebook uses.
  2. Tests three ways of training, ALWAYS on a teammate who is hidden from training (leave-one-person-out),
     and reports the same held-out predictions separately for iPhone and laptop clips when they are labelled:
       own only      train on the other teammates' clips
       public only   train on the public dataset (REHAB24-6) alone, never on your clips
       pooled        public data plus the other teammates' clips, your clips weighted higher
     This is the "fine-tuning" question answered with numbers: does the public data help, or do your clips alone win?
  3. Trains a second model that names the fault (shallow, knees_in, lean_forward, ...), tested the same way.
  4. Suggests thresholds for the spoken-cue rules from your own good and bad reps.
  5. Exports the best strategy, trained on everyone, to models/<exercise>_demo.json and copies it to the web
     app, which then prefers it over the public-data model.

The score printed for the winning strategy is the number for the slide: it is measured on a teammate the model never saw.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import notebook_code  # noqa: E402
from exercises import EXERCISES  # noqa: E402

# Which measurement should separate a fault from good reps, and in which direction (per exercise).
THRESHOLD_FEATURE = {
    "squat": {"shallow": ("avg_knee:min", "higher"), "knees_in": ("knee_gap:min", "lower"),
              "lean_forward": ("trunk_lean:max", "higher")},
    "sit_to_stand": {"knees_in": ("knee_gap:min", "lower"), "not_upright": ("avg_knee:max", "lower"),
                     "lean_forward": ("trunk_lean:max", "higher"), "too_fast": ("duration", "lower")},
    "seated_knee_extension": {"not_straight": ("work_knee:max", "lower"), "lean_back": ("trunk_lean:range", "higher"),
                              "no_hold": ("duration", "lower"), "too_fast": ("duration", "lower")},
    "arm_raise": {"not_high": ("work_shoulder:max", "lower"), "bent_elbow": ("work_elbow:min", "lower"),
                  "body_sway": ("trunk_lean:range", "higher"), "too_fast": ("duration", "lower")},
}
PUBLIC_EXERCISE = {"squat": 6, "arm_raise": 1}     # REHAB24-6 exercise used as "public data", if any
EXERCISE = "squat"


def featurize(ns, lm, duration):
    names, sig = ns["signals"](lm.astype(np.float32), EXERCISES[EXERCISE]["features"])
    feats = [f"{n}:{s}" for n in names for s in ns["STATS"]] + ["duration"]
    return ns["summarise"](sig, duration.astype(np.float32)), feats, names


def fit_logistic(ns, X, y, w=None):
    model = ns["logistic"]()
    if w is None:
        return model.fit(X, y)
    return model.fit(X, y, logisticregression__sample_weight=w)


def load_public(ns, views):
    if EXERCISE not in PUBLIC_EXERCISE:
        return None
    d = np.load(HERE / "data" / "reps.npz")
    m = d["exercise"] == PUBLIC_EXERCISE[EXERCISE]
    if views:
        m &= np.isin(d["view"], views)
    if not m.any():
        return None
    X, _, _ = featurize(ns, d["lm"][m], d["duration"][m])
    return X, 1 - d["correct"][m]


def device_breakdown(ns, y, prob, device):
    """Metrics by capture device, calculated only from held-person predictions.

    A one-class device subset cannot have a meaningful macro F1, so it is reported as
    unavailable rather than manufacturing a flattering number.
    """
    out = {}
    for d in sorted(set(device)):
        m = device == d
        row = {"reps": int(m.sum())}
        if len(set(y[m])) < 2:
            row["macro F1"] = None
            row["note"] = "needs both good and mistake reps"
        else:
            scores = ns["scores"](y[m], prob[m])
            row["macro F1"] = round(float(scores["macro F1"]), 3)
            row["accuracy"] = round(float(scores["accuracy"]), 3)
        out[str(d)] = row
    return out


def validation_objective(scores, by_device):
    """Choose a strategy that does not sacrifice one recorded device for the other.

    With labelled footage from two or more devices, the weakest per-device macro F1 is
    the selection objective. With only one known device (or old clips without device
    folders), preserve the project's original overall macro-F1 selection.
    """
    values = [row["macro F1"] for name, row in by_device.items()
              if name != "unknown" and row["macro F1"] is not None]
    return min(values) if len(values) >= 2 else float(scores["macro F1"])


def evaluate(ns, name, X, y, who, device, strategy, pub, own_weight):
    prob = np.zeros(len(y))
    for p in np.unique(who):
        hidden = who == p
        Xt, yt, wt = X[~hidden], y[~hidden], np.full((~hidden).sum(), own_weight)
        if strategy == "public only":
            Xt, yt, wt = pub
            wt = np.ones(len(yt))
        elif strategy == "pooled":
            Xt, yt, wt = np.vstack([pub[0], Xt]), np.r_[pub[1], yt], np.r_[np.ones(len(pub[1])), wt]
        elif len(np.unique(yt)) < 2:
            prob[hidden] = 0.5
            continue
        prob[hidden] = fit_logistic(ns, Xt, yt, wt if strategy != "own only" else None).predict_proba(X[hidden])[:, 1]
    s = ns["scores"](y, prob)
    per_person = {p: float(((prob[who == p] >= 0.5) == y[who == p]).mean()) for p in np.unique(who)}
    by_device = device_breakdown(ns, y, prob, device)
    for d, row in by_device.items():
        row["people"] = int(len(set(who[device == d])))
    return prob, s, per_person, by_device


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--exercise", choices=list(EXERCISES), default="squat")
    ap.add_argument("--own", type=Path, help="default: data/own_<exercise>.npz (data/own_reps.npz for the squat)")
    ap.add_argument("--out", type=Path, help="default: models/<exercise>_demo.json")
    ap.add_argument("--no-public", action="store_true", help="ignore the public data")
    ap.add_argument("--public-views", nargs="*", default=None, help="only these public camera views, e.g. front half-profile")
    ap.add_argument("--own-weight", type=float, default=3.0, help="how much more one of your reps counts than a public one")
    args = ap.parse_args()
    global EXERCISE
    EXERCISE = args.exercise
    if args.own is None:
        args.own = HERE / "data" / ("own_reps.npz" if EXERCISE == "squat" and not (HERE / "data" / "own_squat.npz").exists()
                                    else f"own_{EXERCISE}.npz")
    args.out = args.out or HERE / "models" / f"{EXERCISE}_demo.json"

    if not args.own.exists():
        sys.exit(f"{args.own} not found. Run extract_clips.py first (see docs/RECORDING.md).")
    ns = notebook_code.load()
    own = np.load(args.own)
    X, feats, sig_names = featurize(ns, own["lm"], own["duration"])
    y, who, label = 1 - own["good"], own["person"], own["label"]
    device = own["device"] if "device" in own.files else np.full(len(y), "unknown")
    people = sorted(set(who))
    print(f"your data: {len(y)} reps, {len(people)} people ({', '.join(people)}), "
          f"{int((y == 0).sum())} good and {int(y.sum())} with a fault")
    for d in sorted(set(device)):
        m = device == d
        print(f"   {str(d):14s} {int(m.sum()):4d} reps from {len(set(who[m]))} people")
    for lab in sorted(set(label)):
        print(f"   {lab:14s} {int((label == lab).sum()):4d} reps")
    if len(people) < 2:
        sys.exit("Need clips from at least 2 people, so one can be hidden for an honest test.")
    if len(set(y)) < 2:
        sys.exit("Need both good clips and clips with a fault.")

    pub = None
    if not args.no_public and (HERE / "data" / "reps.npz").exists():
        loaded = load_public(ns, args.public_views)
        if loaded is not None:
            pub = (loaded[0], loaded[1], None)
            print(f"public data: {len(loaded[1])} {EXERCISE} reps from REHAB24-6" + (f" (views: {args.public_views})" if args.public_views else ""))

    strategies = ["own only"] + (["public only", "pooled"] if pub else [])
    results = {}
    print(f"\nHidden-teammate test (each teammate is hidden in turn). macro F1: 1.0 perfect, always-'good' scores about "
          f"{ns['scores'](y, np.zeros(len(y)))['macro F1']:.2f}")
    print(f"  {'training on':14s} {'macro F1':>8s} {'AUC':>6s} {'accuracy':>9s}   accuracy per hidden person")
    for st in strategies:
        prob, s, per, by_device = evaluate(ns, st, X, y, who, device, st, pub, args.own_weight)
        results[st] = (prob, s, by_device, validation_objective(s, by_device))
        print(f"  {st:14s} {s['macro F1']:8.2f} {s['AUC']:6.2f} {s['accuracy']:9.2f}   " + "  ".join(f"{p} {a:.2f}" for p, a in per.items()))
    best = max(results, key=lambda k: (results[k][3], results[k][1]["macro F1"]))
    prob, s, by_device, objective = results[best]
    print(f"\nbest: {best}. This is the number for the slide: macro F1 {s['macro F1']:.2f}, AUC {s['AUC']:.2f}, "
          "measured on teammates the model never saw.")
    if set(device) != {"unknown"}:
        print(f"Selected for the weaker device too: device-floor macro F1 {objective:.2f}.")
        print("\nHeld-out result by capture device (do not claim a device that has no score):")
        for d, row in by_device.items():
            score = "not available" if row["macro F1"] is None else f"macro F1 {row['macro F1']:.2f}, accuracy {row['accuracy']:.2f}"
            print(f"   {d:14s} {row['reps']:4d} reps / {row['people']} people   {score}")

    faults = sorted(set(label) - {"good"})
    print("\nOf the reps with each fault, how many did the quality model flag (threshold 0.5)? And good reps passed:")
    for lab in ["good"] + faults:
        m = label == lab
        flagged = float((prob[m] >= 0.5).mean())
        print(f"   {lab:14s} {m.sum():4d} reps   flagged as a mistake: {flagged:5.0%}   mean quality score {100 * (1 - prob[m].mean()):4.0f}/100")

    # --- the model that names the fault
    fault_model, fault_acc = None, None
    if len(faults) >= 2 and all((label == f).sum() >= 8 for f in ["good"] + faults):
        from sklearn.linear_model import LogisticRegression
        from sklearn.metrics import confusion_matrix
        from sklearn.pipeline import make_pipeline
        from sklearn.preprocessing import StandardScaler
        make = lambda: make_pipeline(StandardScaler(), LogisticRegression(C=0.1, max_iter=4000, class_weight="balanced"))
        classes = ["good"] + faults
        pred = np.empty(len(y), dtype=object)
        for p in people:
            hidden = who == p
            pred[hidden] = make().fit(X[~hidden], label[~hidden]).predict(X[hidden])
        fault_acc = float((pred == label).mean())
        cm = confusion_matrix(label, pred, labels=classes)
        print(f"\nFault naming (hidden-teammate test): accuracy {fault_acc:.2f}  (guessing: {1 / len(classes):.2f})")
        print("  rows = what you did, columns = what the model said")
        print("  " + " " * 14 + "".join(f"{c:>14s}" for c in classes))
        for c, row in zip(classes, cm):
            print(f"  {c:14s}" + "".join(f"{v:14d}" for v in row))
        fault_model = make().fit(X, label)
    else:
        print("\n(fault naming skipped: needs at least 2 different faults with 8 or more reps each, plus good)")

    # --- thresholds for spoken-cue rules
    suggestions = {}
    print("\nSuggested thresholds for spoken cues (middle between the typical good rep and the typical bad rep):")
    for lab, (feat, direction) in THRESHOLD_FEATURE.get(EXERCISE, {}).items():
        if lab in label and feat in feats:
            i = feats.index(feat)
            g, b = np.median(X[label == "good", i]), np.median(X[label == lab, i])
            ok = (b > g) if direction == "higher" else (b < g)
            suggestions[lab] = {"feature": feat, "good_median": float(g), "fault_median": float(b), "threshold": float((g + b) / 2),
                                "fault_if": "above" if direction == "higher" else "below", "separates": bool(ok)}
            print(f"   {lab:14s} {feat:16s} good {g:7.2f}   {lab} {b:7.2f}   cue when {suggestions[lab]['fault_if']} {(g + b) / 2:7.2f}"
                  + ("" if ok else "   (WARNING: wrong direction, check the clips)"))

    # --- export
    Xtr, ytr, wtr = X, y, np.full(len(y), args.own_weight)
    if best == "pooled":
        Xtr, ytr, wtr = np.vstack([pub[0], X]), np.r_[pub[1], y], np.r_[np.ones(len(pub[1])), wtr]
    elif best == "public only":
        Xtr, ytr, wtr = pub[0], pub[1], np.ones(len(pub[1]))
    final = fit_logistic(ns, Xtr, ytr, wtr if best != "own only" else None)

    def pack(model):
        sc, lr = model[0], model[1]
        return {"classes": [int(c) if isinstance(c, (int, np.integer)) else str(c) for c in lr.classes_],
                "mean": sc.mean_.tolist(), "scale": sc.scale_.tolist(),
                "weights": lr.coef_.tolist(), "bias": lr.intercept_.tolist()}

    quality = pack(final)
    quality["weights"], quality["bias"] = quality["weights"][0], quality["bias"][0]   # binary: one weight vector
    fs = EXERCISES[EXERCISE]["features"]
    side = ns["WORKING_SIDE_BY"].get(fs)
    spec = {"exercise": f"{EXERCISE} (demo setup)", "strategy": best, "type": "logistic", "frames": 64,
            "signals": sig_names, "stats": ns["STATS"], "features": feats, "pose_model": "heavy",
            "one_sided": fs in (1, 4, 5), "working_side_by": list(side) if side else [],
            "quality": {"type": "logistic", **quality},
            "fault": ({"type": "softmax", **pack(fault_model)} if fault_model is not None else None),
            "rule_suggestions": suggestions,
            "tested_on_unseen_people": {k: round(float(v), 3) for k, v in s.items()} | {"by_capture_device": by_device, "device_floor_macro_F1": round(float(objective), 3)} | ({"fault_accuracy": round(fault_acc, 3)} if fault_acc else {}),
            "training": {"own_reps": int(len(y)), "own_people": people, "own_reps_by_capture_device": {str(d): int((device == d).sum()) for d in sorted(set(device))}, "public_reps": int(len(pub[1])) if pub and best != "own only" else 0}}
    args.out.parent.mkdir(exist_ok=True)
    args.out.write_text(json.dumps(spec))
    web = HERE.parent / "web" / "public" / "models"
    if web.exists() and args.out.resolve().parent == (HERE / "models").resolve():   # only real exports, not test runs
        import shutil
        shutil.copy(args.out, web / args.out.name)
        print(f"copied to web/public/models/{args.out.name}: the app now scores {EXERCISE} with it")

    z = (X[:20] - np.array(quality["mean"])) / np.array(quality["scale"])
    ours = 1 / (1 + np.exp(-(z @ np.array(quality["weights"]) + quality["bias"])))
    gap = np.abs(ours - final.predict_proba(X[:20])[:, 1]).max()
    print(f"\nsaved {args.out}  ({args.out.stat().st_size / 1e3:.0f} kB; plain-arithmetic check differs from scikit-learn by {gap:.0e})")


if __name__ == "__main__":
    main()
