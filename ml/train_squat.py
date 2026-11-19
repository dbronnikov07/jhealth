"""The squat model for the demo: heavy-tracker landmarks, several models compared honestly, the best exported.

Light: it only reads body points that extract_poses.py already produced (a few MB), so it runs in about a minute
on two CPU cores. The heavy part (turning videos into body points) is not done here.

    ~/jhealth-cache/venv/bin/python train_squat.py            compare, print the table
    ~/jhealth-cache/venv/bin/python train_squat.py --export   ...and export the winner to models/ and the web app

Every score is measured on a person the model never saw (leave one person out), as in the notebook.
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
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.pipeline import make_pipeline  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402

SQUAT = 6
CACHE = Path.home() / "jhealth-cache"


def logistic(C=0.1):
    return make_pipeline(StandardScaler(), LogisticRegression(C=C, max_iter=4000, class_weight="balanced"))


def forest():
    return RandomForestClassifier(n_estimators=300, min_samples_leaf=2, class_weight="balanced", n_jobs=2, random_state=0)


def boosting():
    return HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=200, class_weight="balanced", random_state=0)


class Ensemble:
    """Average of the members' mistake probabilities. Simple, and usually steadier than any single member."""
    def __init__(self, makers):
        self.makers = makers

    def fit(self, X, y):
        self.members = [m().fit(X, y) for m in self.makers]
        return self

    def predict_proba(self, X):
        p = np.mean([m.predict_proba(X)[:, 1] for m in self.members], axis=0)
        return np.stack([1 - p, p], axis=1)


def load(path, ns):
    d = np.load(path)
    m = d["exercise"] == SQUAT
    names, sig = ns["signals"](d["lm"][m].astype(np.float32), SQUAT)
    X = ns["summarise"](sig, d["duration"][m].astype(np.float32))
    feats = [f"{n}:{s}" for n in names for s in ns["STATS"]] + ["duration"]
    pose = str(d["pose_model"]) if "pose_model" in d.files else ("heavy" if "heavy" in path.name else "full")
    return X, 1 - d["correct"][m], d["person"][m], feats, names, d["lm"][m], d["duration"][m], pose


def loso(make, X, y, who, extra=None):
    """Leave one person out. `extra` = (X, y, who) added to training only, never containing the hidden person."""
    prob = np.zeros(len(y))
    for p in np.unique(who):
        hidden = who == p
        Xt, yt = X[~hidden], y[~hidden]
        if extra is not None:
            keep = extra[2] != p
            Xt, yt = np.vstack([Xt, extra[0][keep]]), np.r_[yt, extra[1][keep]]
        prob[hidden] = make().fit(Xt, yt).predict_proba(X[hidden])[:, 1]
    return prob


def to_dict(model):
    if isinstance(model, Ensemble):
        return {"type": "ensemble", "members": [to_dict(m) for m in model.members]}
    if isinstance(model, HistGradientBoostingClassifier):
        trees = []
        for (predictor,) in model._predictors:
            n = predictor.nodes
            trees.append({"feature": n["feature_idx"].tolist(), "threshold": n["num_threshold"].tolist(),
                          "left": n["left"].tolist(), "right": n["right"].tolist(),
                          "leaf": n["is_leaf"].astype(int).tolist(), "value": n["value"].tolist()})
        return {"type": "boosting", "baseline": float(np.ravel(model._baseline_prediction)[0]), "trees": trees}
    if isinstance(model, RandomForestClassifier):
        trees = []
        for est in model.estimators_:
            t = est.tree_
            v = t.value[:, 0, :]
            trees.append({"feature": t.feature.tolist(), "threshold": t.threshold.tolist(), "left": t.children_left.tolist(),
                          "right": t.children_right.tolist(), "p_mistake": (v[:, 1] / v.sum(1)).tolist()})
        return {"type": "forest", "trees": trees}
    if hasattr(model, "named_steps"):
        sc, lr = model[0], model[1]
        return {"type": "logistic", "mean": sc.mean_.tolist(), "scale": sc.scale_.tolist(),
                "weights": lr.coef_[0].tolist(), "bias": float(lr.intercept_[0])}
    raise ValueError("this model type cannot be exported to the browser")


def predict_from_dict(m, x):
    """The exported model evaluated with plain arithmetic: what the browser does (web/src/lib/pose/model.ts)."""
    if m["type"] == "ensemble":
        return float(np.mean([predict_from_dict(k, x) for k in m["members"]]))
    if m["type"] == "logistic":
        z = m["bias"] + sum(w * (v - mu) / sd for w, v, mu, sd in zip(m["weights"], x, m["mean"], m["scale"]))
        return 1 / (1 + np.exp(-z))
    if m["type"] == "boosting":
        raw = m["baseline"]
        for t in m["trees"]:
            node = 0
            while not t["leaf"][node]:
                node = t["left"][node] if x[t["feature"][node]] <= t["threshold"][node] else t["right"][node]
            raw += t["value"][node]
        return 1 / (1 + np.exp(-raw))
    total = 0.0
    for t in m["trees"]:
        node = 0
        while t["left"][node] != -1:
            node = t["left"][node] if x[t["feature"][node]] <= t["threshold"][node] else t["right"][node]
        total += t["p_mistake"][node]
    return total / len(m["trees"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reps", type=Path, default=HERE / "data" / "reps_heavy.npz")
    ap.add_argument("--export", action="store_true")
    ap.add_argument("--only", help="skip the comparison: score and export just this candidate (name as printed)")
    args = ap.parse_args()

    ns = notebook_code.load()
    scores = ns["scores"]
    X, y, who, feats, sig_names, lm, dur, pose = load(args.reps, ns)
    print(f"squats: {len(y)} samples, {len(set(who))} people, {y.mean():.0%} with a mistake, tracker: {pose}\n")

    mocap = None
    if (CACHE / "reps_mocap.npz").exists():
        Xm, ym, wm, *_ = load(CACHE / "reps_mocap.npz", ns)
        mocap = (Xm, ym, wm)

    candidates = {
        "logistic regression": lambda: logistic(0.1),
        "random forest": forest,
        "gradient boosting": boosting,
        "ensemble: logistic + forest": lambda: Ensemble([lambda: logistic(0.1), forest]),
        "ensemble: logistic + forest + boosting": lambda: Ensemble([lambda: logistic(0.1), forest, boosting]),
    }
    results = {}
    print(f"  {'model':48s} {'macro F1':>8s} {'AUC':>6s} {'accuracy':>9s}")
    for name, make in candidates.items():
        if args.only and name != args.only:
            continue
        s = scores(y, loso(make, X, y, who))
        results[name] = (s, make, None)
        print(f"  {name:48s} {s['macro F1']:8.2f} {s['AUC']:6.2f} {s['accuracy']:9.2f}")
    if mocap is not None and not args.only:
        for name in ("logistic regression", "ensemble: logistic + forest"):
            s = scores(y, loso(candidates[name], X, y, who, extra=mocap))
            results[f"{name} + mocap in training"] = (s, candidates[name], mocap)
            print(f"  {name + ' + mocap in training':48s} {s['macro F1']:8.2f} {s['AUC']:6.2f} {s['accuracy']:9.2f}")

    best = max(results, key=lambda k: (round(results[k][0]["macro F1"], 3), results[k][0]["AUC"]))
    s, make, extra = results[best]
    print(f"\nbest: {best}: macro F1 {s['macro F1']:.2f}, AUC {s['AUC']:.2f} on people the model never saw")
    print("(choosing the best of several on the same test flatters it slightly; your own recorded clips are the fair check)")
    if not args.export:
        return

    Xt, yt = (X, y) if extra is None else (np.vstack([X, extra[0]]), np.r_[y, extra[1]])
    final = make().fit(Xt, yt)
    body = to_dict(final)
    gap = max(abs(predict_from_dict(body, row) - p) for row, p in zip(X[:60], final.predict_proba(X[:60])[:, 1]))
    print(f"exported model vs scikit-learn, largest difference over 60 reps: {gap:.1e}")
    assert gap < 1e-6, "the exported model does not reproduce scikit-learn"
    spec = {"exercise": "squat", "model": best, "body_area": "legs", "one_sided": False, "working_side_by": [],
            "pose_model": pose, "frames": 64, "signals": sig_names, "stats": ns["STATS"], "features": feats,
            "tested_on_unseen_people": {k: round(float(v), 3) for k, v in s.items()},
            "training": {"samples": int(len(yt)), "people": int(len(set(who))), "dataset": "REHAB24-6 (CC BY-NC 4.0, research use only)"
                         + (" + its motion-capture joints" if extra is not None else "")},
            **body}
    models = HERE / "models"
    (models / "squat.json").write_text(json.dumps(spec))

    # Worked example for the browser port test: one repetition, rounded, with what Python computes from it.
    rounded = lm[0].astype(np.float64).round(5)
    names_r, sig_r = ns["signals"](rounded[None], SQUAT)
    x_r = ns["summarise"](sig_r, dur[:1].astype(np.float64))[0]
    (models / "parity_test.json").write_text(json.dumps({
        "exercise": "squat", "landmarks": rounded.tolist(), "duration": float(dur[0]),
        "features": x_r.tolist(), "p_mistake": float(final.predict_proba(x_r[None])[0, 1]),
        "features_from_rounded": x_r.tolist(), "p_mistake_from_rounded": float(final.predict_proba(x_r[None])[0, 1])}))
    web = HERE.parent / "web" / "public" / "models"
    if web.exists():
        shutil.copy(models / "squat.json", web / "squat.json")
    print(f"exported models/squat.json ({(models / 'squat.json').stat().st_size / 1e3:.0f} kB, tracker {pose}) and parity_test.json"
          + (", copied to web/public/models" if web.exists() else ""))


if __name__ == "__main__":
    main()
