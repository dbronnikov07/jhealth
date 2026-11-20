"""Final training round (19 November): squat and arm raise on camera data, reported per device group.

Every number is leave-one-person-out: all repetitions of the hidden person (every camera and view) are out of
training. Settings are fixed in this file, or chosen inside the training people only (the nested-C logistic).
Features are the unchanged notebook features (the browser's features.ts computes the same ones).

Device groups:  "phone" = REHAB26-ViewAngles (3 iPhones, front to profile, 5 people)
                "fixed camera (webcam-like)" = REHAB24-6 (2 fixed cameras, 9 people for these exercises)

Run ONE stage at a time (each is a few minutes on two cores), from ml/:

    P=~/jhealth-cache/venv/bin/python
    OMP_NUM_THREADS=2 nice -n 10 $P final_round.py families squat      # a + c: baseline and model families
    OMP_NUM_THREADS=2 nice -n 10 $P final_round.py families arm_raise
    OMP_NUM_THREADS=2 nice -n 10 $P final_round.py aug squat           # b: landmark-level augmentation
    OMP_NUM_THREADS=2 nice -n 10 $P final_round.py aug arm_raise
    OMP_NUM_THREADS=2 nice -n 10 $P final_round.py control squat       # b: control (plain repetition), same for arm_raise
    OMP_NUM_THREADS=2 nice -n 10 $P final_round.py curve squat         # e: learning curve
    OMP_NUM_THREADS=2 nice -n 10 $P final_round.py curve arm_raise
    OMP_NUM_THREADS=2 nice -n 10 $P final_round.py extras              # d, f, g + lab datasets
    OMP_NUM_THREADS=2 nice -n 10 $P final_round.py export squat --config "<name as printed>"   # writes a candidate

Results go to ml/final_round_out/ (small JSON + the held-out probabilities). Charts: final_round_charts.py.
"""
import argparse
import json
import sys
import time
import warnings
from pathlib import Path

import numpy as np

warnings.filterwarnings("ignore")
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import notebook_code  # noqa: E402
from exercises import EXERCISES  # noqa: E402
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier  # noqa: E402
from sklearn.linear_model import LogisticRegression  # noqa: E402
from sklearn.metrics import confusion_matrix, f1_score, precision_score, recall_score, roc_auc_score  # noqa: E402
from sklearn.model_selection import GroupKFold  # noqa: E402
from sklearn.pipeline import make_pipeline  # noqa: E402
from sklearn.preprocessing import StandardScaler  # noqa: E402
from train_exercise import SOURCES, featurize  # noqa: E402
from train_squat import Ensemble, predict_from_dict, to_dict  # noqa: E402

CACHE = Path.home() / "jhealth-cache"
OUT = HERE / "final_round_out"
CAMERA = ["REHAB24 camera", "REHAB26 camera"]
DEVICE = {"REHAB24 camera": "fixed camera (webcam-like)", "REHAB26 camera": "phone"}
EX_ID = {"squat": 6, "arm_raise": 1}
# The mistakes the app names out loud, as they are called in REHAB26. ("Body swaying" has no REHAB26 arm-raise label.)
COACHABLE = {"squat": ["ERR_SHALLOW_SQUAT", "ERR_KNEES_INSIDE", "ERR_LIFTED_HEELS", "ERR_KNEES_FORWARD"],
             "arm_raise": ["ERR_LOW_ABDUCTION", "ERR_BENT_ARM"]}
BASELINE = "ensemble | balanced"          # what models/squat.json and models/arm_raise.json were on 19 Nov, 13:12


# ------------------------------------------------------------------------------------------------ models

def lr(C=0.1, cw="balanced"):
    return make_pipeline(StandardScaler(), LogisticRegression(C=C, max_iter=4000, class_weight=cw))


def rf(cw="balanced", n=300):
    return RandomForestClassifier(n_estimators=n, min_samples_leaf=2, class_weight=cw, n_jobs=2, random_state=0)


def hgb(cw="balanced", it=200):
    return HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=it, class_weight=cw, random_state=0)


class NestedC:
    """Logistic regression whose C is chosen by grouped cross-validation over the TRAINING people only."""
    GRID = (0.01, 0.03, 0.1, 0.3, 1.0)

    def __init__(self, cw):
        self.cw = cw

    def fit(self, X, y, groups):
        best = (-1.0, None)
        for C in self.GRID:
            pr = np.zeros(len(y))
            for a, b in GroupKFold(4).split(X, y, groups):
                pr[b] = lr(C, self.cw).fit(X[a], y[a]).predict_proba(X[b])[:, 1]
            f = f1_score(y, pr > 0.5, average="macro")
            if f > best[0] + 1e-9:
                best = (f, C)
        self.C = best[1]
        self.model = lr(self.C, self.cw).fit(X, y)
        return self

    def predict_proba(self, X):
        return self.model.predict_proba(X)


def fit(model, X, y, w=None, groups=None):
    if isinstance(model, NestedC):
        return model.fit(X, y, groups)
    if w is None:
        return model.fit(X, y)
    if hasattr(model, "named_steps"):
        return model.fit(X, y, logisticregression__sample_weight=w)
    return model.fit(X, y, sample_weight=w)


# ------------------------------------------------------------------------------------------------ data

def load_camera(ex, ns):
    parts = [(name, *SOURCES[ex][name]()) for name in CAMERA]
    lm = np.concatenate([p[1] for p in parts])
    dur = np.concatenate([p[4] for p in parts]).astype(np.float32)
    y = np.concatenate([p[2] for p in parts]).astype(int)
    who = np.concatenate([p[3] for p in parts])
    src = np.concatenate([[p[0]] * len(p[2]) for p in parts])
    r26 = np.load(CACHE / f"rehab26_ex{EX_ID[ex]}.npz")
    err = np.concatenate([np.where(parts[0][2] == 1, "unnamed (REHAB24)", ""), r26["error"]])
    assert (r26["error"] != "").astype(int).tolist() == parts[1][2].astype(int).tolist()
    X, names = featurize(ns, lm, dur, EXERCISES[ex]["features"])
    return dict(lm=lm, dur=dur, y=y, who=who, src=src, err=err, X=X, names=names)


def feats_of(ns, ex, lm, dur):
    return featurize(ns, lm, dur, EXERCISES[ex]["features"])[0]


# ------------------------------------------------------------------------------------------------ augmentation
# Applied to body points BEFORE the (unchanged) feature code, and only ever used for training rows.

def rot_y(lm, deg):
    """Turn the whole body around the vertical axis (MediaPipe world: y is vertical)."""
    a = np.radians(deg)
    c, s = np.cos(a), np.sin(a)
    R = np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]], dtype=np.float32)
    return (lm @ R.T).astype(np.float32)


def camera_noise(lm, rng):
    """What a propped-up phone does to MediaPipe's 3D points: a tilted camera (pitch +-10, roll +-6 degrees),
    depth (z) over- or under-estimated (x0.8 to x1.25), and each body point placed about 1 cm off for the whole rep."""
    n = len(lm)
    out = lm.astype(np.float32).copy()
    out[..., 2] *= rng.uniform(0.8, 1.25, n)[:, None, None]
    pitch, roll = np.radians(rng.uniform(-10, 10, n))[:, None, None], np.radians(rng.uniform(-6, 6, n))[:, None, None]
    yy, zz = out[..., 1].copy(), out[..., 2].copy()
    out[..., 1], out[..., 2] = np.cos(pitch) * yy - np.sin(pitch) * zz, np.sin(pitch) * yy + np.cos(pitch) * zz
    xx, yy = out[..., 0].copy(), out[..., 1].copy()
    out[..., 0], out[..., 1] = np.cos(roll) * xx - np.sin(roll) * yy, np.sin(roll) * xx + np.cos(roll) * yy
    torso = np.linalg.norm((lm[:, :, 11] + lm[:, :, 12]) / 2 - (lm[:, :, 23] + lm[:, :, 24]) / 2, axis=-1).mean(1)
    out += (rng.normal(0, 1, (n, 1, 33, 3)) * (0.02 * torso)[:, None, None, None]).astype(np.float32)
    return out


# ------------------------------------------------------------------------------------------------ testing

def lopo(make, D, extra=None, weight=None, rows=None, log=None):
    """Hide each person in turn. `extra`: feature arrays of augmented copies (training rows only are used).
    `weight`: function(training mask) -> sample weights. `rows`: mask of rows that may be used at all."""
    X, y, who = D["X"], D["y"], D["who"]
    rows = np.ones(len(y), bool) if rows is None else rows
    prob = np.full(len(y), np.nan)
    for p in np.unique(who[rows]):
        hid = (who == p) & rows
        tr = (who != p) & rows
        Xtr, ytr, gtr = X[tr], y[tr], who[tr]
        wtr = None if weight is None else weight(tr)
        if extra:
            Xtr = np.vstack([Xtr] + [A[tr] for A in extra])
            ytr, gtr = np.tile(ytr, 1 + len(extra)), np.tile(gtr, 1 + len(extra))
            wtr = None if wtr is None else np.tile(wtr, 1 + len(extra))
        m = fit(make(), Xtr, ytr, wtr, gtr)
        if log is not None and isinstance(m, NestedC):
            log.append(m.C)
        prob[hid] = m.predict_proba(X[hid])[:, 1]
    return prob


def metrics(y, prob, thr=0.5):
    pred = prob > thr
    return {"reps": int(len(y)), "mistake_reps": int(y.sum()),
            "macro_f1": float(f1_score(y, pred, average="macro")), "auc": float(roc_auc_score(y, prob)),
            "precision_mistake": float(precision_score(y, pred, zero_division=0)),
            "recall_mistake": float(recall_score(y, pred)),
            "floor_always_correct": float(f1_score(y, np.zeros(len(y), int), average="macro"))}


def by_device(D, prob, rows=None):
    rows = ~np.isnan(prob) if rows is None else rows
    out = {}
    for name, m in [("all camera", rows)] + [(DEVICE[s], rows & (D["src"] == s)) for s in CAMERA]:
        if m.any() and len(set(D["y"][m])) == 2:
            out[name] = metrics(D["y"][m], prob[m]) | {"people": int(len(set(D["who"][m])))}
    return out


def line(name, r):
    def cell(k):
        m = r.get(k)
        return "       (none)       " if m is None else f"{m['macro_f1']:.3f} {m['auc']:.3f} {m['precision_mistake']:.2f}/{m['recall_mistake']:.2f}"
    return f"  {name:58s} phone {cell('phone')} | fixed {cell(DEVICE['REHAB24 camera'])} | all {cell('all camera')}"


class Store:
    """Held-out probabilities (npz) and metrics (json) per exercise, added to by each stage."""
    def __init__(self, ex):
        OUT.mkdir(exist_ok=True)
        self.pf, self.rf_ = OUT / f"probs_{ex}.npz", OUT / f"results_{ex}.json"
        self.probs = dict(np.load(self.pf)) if self.pf.exists() else {}
        self.res = json.loads(self.rf_.read_text()) if self.rf_.exists() else {}

    def add(self, name, D, prob, **more):
        self.probs[name] = prob
        self.res[name] = by_device(D, prob) | more
        print(line(name, self.res[name]), flush=True)
        np.savez_compressed(self.pf, **self.probs)
        self.rf_.write_text(json.dumps(self.res, indent=1))


def device_weights(D):
    """Each device group counts the same in training, however many repetitions it has."""
    def w(tr):
        s = D["src"][tr]
        return np.array([len(s) / (2 * (s == v).sum()) for v in s])
    return w


def header(ex, D):
    print(f"\n{ex}: {len(D['y'])} reps, {len(set(D['who']))} people")
    for s in CAMERA:
        m = D["src"] == s
        print(f"  {DEVICE[s]:28s} {s:16s} {m.sum():5d} reps, {len(set(D['who'][m])):2d} people, {D['y'][m].mean():.1%} with a mistake")
    print("  columns per group: macro F1, AUC, precision/recall of the mistake class (cut-off 0.5)")


# ------------------------------------------------------------------------------------------------ stages

def stage_families(ex, ns):
    D = load_camera(ex, ns)
    header(ex, D)
    S = Store(ex)
    for tag, cw in (("balanced", "balanced"), ("unweighted", None)):
        cs = []
        for fam, make in (("logistic C=0.1", lambda cw=cw: lr(0.1, cw)), ("logistic C=nested", lambda cw=cw: NestedC(cw)),
                          ("forest", lambda cw=cw: rf(cw)), ("boosting", lambda cw=cw: hgb(cw))):
            t = time.time()
            prob = lopo(make, D, log=cs)
            S.add(f"{fam} | {tag}", D, prob, seconds=round(time.time() - t, 1), **({"C_per_fold": cs} if "nested" in fam else {}))
        S.add(f"ensemble | {tag}", D, np.mean([S.probs[f"{f} | {tag}"] for f in ("logistic C=0.1", "forest", "boosting")], axis=0))
        S.add(f"ensemble (nested-C logistic) | {tag}", D,
              np.mean([S.probs[f"{f} | {tag}"] for f in ("logistic C=nested", "forest", "boosting")], axis=0))
    tag, w = "balanced + devices weighted equally", device_weights(D)
    for fam, make in (("logistic C=0.1", lambda: lr(0.1)), ("forest", rf), ("boosting", hgb)):
        S.add(f"{fam} | {tag}", D, lopo(make, D, weight=w))
    S.add(f"ensemble | {tag}", D, np.mean([S.probs[f"{f} | {tag}"] for f in ("logistic C=0.1", "forest", "boosting")], axis=0))


def aug_sets(ex, ns, D):
    """Feature arrays of augmented copies of every rep (fixed seed). Only training rows are ever used."""
    rng = np.random.default_rng(20261119)
    Xm = feats_of(ns, ex, ns["mirror"](D["lm"]), D["dur"])
    yaws = {a: feats_of(ns, ex, rot_y(D["lm"], a), D["dur"]) for a in (-30, -15, 15, 30)}
    pick = rng.choice([-30, -15, 15, 30], len(D["y"]))
    Xy = np.stack([yaws[a][i] for i, a in enumerate(pick)])
    sd = D["X"].std(0) + 1e-9
    report = {"mirror: largest feature change, in standard deviations": float((np.abs(Xm - D["X"]) / sd).max()),
              "yaw +-15/+-30: largest feature change, in standard deviations": float(max((np.abs(v - D["X"]) / sd).max() for v in yaws.values()))}
    cam = [feats_of(ns, ex, camera_noise(D["lm"], rng), D["dur"]) for _ in range(2)]
    report["camera tilt+depth+offset: median feature change, in standard deviations"] = float(np.median(np.abs(cam[0] - D["X"]) / sd))
    return {"aug mirror+yaw": [Xm, Xy], "aug camera tilt+depth+offset": cam}, report


def stage_aug(ex, ns):
    D = load_camera(ex, ns)
    header(ex, D)
    S = Store(ex)
    sets, report = aug_sets(ex, ns, D)
    for k, v in report.items():
        print(f"  {k}: {v:.2e}")
    S.res["_augmentation_check"] = report
    for tag, extra in sets.items():
        for fam, make in (("logistic C=0.1", lambda: lr(0.1)), ("forest", rf), ("boosting", hgb)):
            S.add(f"{fam} | balanced | {tag}", D, lopo(make, D, extra=extra))
        S.add(f"ensemble | balanced | {tag}", D,
              np.mean([S.probs[f"{f} | balanced | {tag}"] for f in ("logistic C=0.1", "forest", "boosting")], axis=0))


def stage_control(ex, ns):
    """Control for experiment b. Mirroring and yaw turns barely change the features (they are angles and distances
    measured relative to the body and to 'down'), so that 'augmentation' mostly repeats each rep three times. This
    measures plain repetition (every training rep three times, nothing else) and how much a yaw turn moves a feature."""
    D = load_camera(ex, ns)
    header(ex, D)
    S = Store(ex)
    sd, n_sig = D["X"].std(0) + 1e-9, len(D["names"])
    change = np.max([np.abs(feats_of(ns, ex, rot_y(D["lm"], a), D["dur"]) - D["X"]) / sd for a in (-30, -15, 15, 30)], axis=0)
    moved = change > 0.01
    by_stat = {st: float(moved[:, [c for c in range(n_sig * 11) if c % 11 == j]].mean()) for j, st in enumerate(ns["STATS"])}
    S.res["_yaw_check"] = {"share of feature values a yaw turn moves by more than 0.01 standard deviations": float(moved.mean()),
                           "by statistic": by_stat, "median change in standard deviations": float(np.median(change))}
    print("  yaw turn:", json.dumps(S.res["_yaw_check"]))
    tag = "control, each rep repeated x3"
    for fam, make in (("logistic C=0.1", lambda: lr(0.1)), ("forest", rf), ("boosting", hgb)):
        S.add(f"{fam} | balanced | {tag}", D, lopo(make, D, extra=[D["X"], D["X"]]))
    S.add(f"ensemble | balanced | {tag}", D,
          np.mean([S.probs[f"{f} | balanced | {tag}"] for f in ("logistic C=0.1", "forest", "boosting")], axis=0))


def lite():
    """A lighter stand-in for the exported ensemble so the learning curve fits in a few minutes: logistic + forest with
    100 trees, soft vote. Gradient boosting is left out here (about 3 s per fit on this laptop, 240 fits needed)."""
    return Ensemble([lambda: lr(0.1), lambda: rf(n=100)])


def stage_curve(ex, ns, sizes=(2, 4, 7, 10), repeats=4):
    D = load_camera(ex, ns)
    header(ex, D)
    X, y, who = D["X"], D["y"], D["who"]
    people = np.unique(who)
    rng = np.random.default_rng(7)
    out = {"model": "soft vote of logistic (C=0.1) + forest (100 trees), balanced", "repeats": repeats, "points": {}}
    for k in list(sizes) + [len(people) - 1]:
        runs = []
        for r in range(1 if k == len(people) - 1 else repeats):
            prob, n_train = np.full(len(y), np.nan), []
            for p in people:
                others = people[people != p]
                while True:
                    tr = np.isin(who, rng.choice(others, k, replace=False))
                    if len(set(y[tr])) == 2:
                        break
                n_train.append(int(tr.sum()))
                prob[who == p] = lite().fit(X[tr], y[tr]).predict_proba(X[who == p])[:, 1]
            runs.append({g: m["macro_f1"] for g, m in by_device(D, prob).items()} | {"train_reps": float(np.mean(n_train))})
        out["points"][str(k)] = runs
        print(f"  {k:2d} training people ({np.mean([r['train_reps'] for r in runs]):6.0f} reps on average): " + ", ".join(
            f"{g} {np.mean([r[g] for r in runs]):.3f} (sd {np.std([r[g] for r in runs]):.3f})" for g in runs[0] if g != "train_reps"), flush=True)
    (OUT / f"curve_{ex}.json").write_text(json.dumps(out, indent=1))


def operating_point(y, prob, who, target=0.90):
    grid = np.round(np.arange(0.30, 0.96, 0.01), 2)

    def choose(yy, pp):
        for t in grid:
            flag = pp >= t
            if flag.sum() >= 20 and (flag & (yy == 1)).sum() / flag.sum() >= target:
                return float(t)
        return None

    def at(t, m=None):
        m = np.ones(len(y), bool) if m is None else m
        flag = prob[m] >= t
        tp = int((flag & (y[m] == 1)).sum())
        return {"flagged": int(flag.sum()), "precision": tp / max(1, int(flag.sum())), "recall": tp / max(1, int((y[m] == 1).sum()))}

    t = choose(y, prob)
    out = {"target_precision": target, "threshold": t, "pooled": at(t) if t is not None else None, "at_0.5": at(0.5)}
    # the same rule with the cut-off chosen WITHOUT the person it is applied to (other people's held-out predictions)
    flag, ok = np.zeros(len(y), bool), True
    ts = []
    for p in np.unique(who):
        h = who == p
        tp_ = choose(y[~h], prob[~h])
        ok &= tp_ is not None
        ts.append(tp_)
        flag[h] = prob[h] >= (tp_ if tp_ is not None else 2.0)
    tp = int((flag & (y == 1)).sum())
    out["cutoff_chosen_without_the_tested_person"] = {
        "thresholds": ts, "flagged": int(flag.sum()), "precision": tp / max(1, int(flag.sum())), "recall": tp / max(1, int((y == 1).sum()))}
    return out, at


def stage_extras(ns, configs):
    res = {}
    for ex in ("squat", "arm_raise"):
        D = load_camera(ex, ns)
        S = Store(ex)
        y, who, src, err = D["y"], D["who"], D["src"], D["err"]
        r26, good = src == "REHAB26 camera", D["y"] == 0
        res[ex] = {}
        for cfg in dict.fromkeys(configs[ex]):
            prob = S.probs[cfg]
            e = res[ex][cfg] = {"main": by_device(D, prob)}
            # f. operating point
            op, at = operating_point(y, prob, who)
            if op["threshold"] is not None:
                op["by_device"] = {DEVICE[s]: at(op["threshold"], src == s) for s in CAMERA}
            e["operating_point"] = op
            # d. coachable mistakes (REHAB26 = phone only): the SAME model's held-out predictions, other mistakes left out
            coach = r26 & (good | np.isin(err, COACHABLE[ex]))
            e["coachable_same_model"] = metrics(y[coach], prob[coach]) | {"people": int(len(set(who[coach])))}
            e["per_mistake_same_model"] = {}
            for name in sorted(set(err[r26]) - {""}):
                m = r26 & (good | (err == name))
                e["per_mistake_same_model"][name] = metrics(y[m], prob[m]) | {
                    "share_flagged_at_0.5": float((prob[r26 & (err == name)] > 0.5).mean()), "coachable": name in COACHABLE[ex]}
            e["confusion_at_0.5"] = confusion_matrix(y, prob > 0.5).tolist()
            e["per_person_macro_f1"] = {p: float(f1_score(y[who == p], prob[who == p] > 0.5, average="macro")) for p in np.unique(who)}
        # Selection check. Picking the best of many configurations on the same held-out people flatters the winner.
        # Here the configuration used for each person is picked WITHOUT that person: best weaker-device macro F1 on
        # the other people's held-out predictions. No model is refitted; this only re-uses stored predictions.
        names = [k for k in S.probs if not np.isnan(S.probs[k]).any()]
        sel, picked = np.full(len(y), np.nan), []
        for p in np.unique(who):
            o = who != p
            floor = [min(f1_score(y[o & (src == s)], S.probs[k][o & (src == s)] > 0.5, average="macro") for s in CAMERA) for k in names]
            picked.append(names[int(np.argmax(floor))])
            sel[who == p] = S.probs[picked[-1]][who == p]
        res[ex]["selection_check"] = {"configurations": len(names), "picked": {k: picked.count(k) for k in dict.fromkeys(picked)}, "main": by_device(D, sel)}
        # d. a model trained only on correct vs coachable (REHAB26's other mistakes removed from training and test)
        rows = ~(r26 & ~good & ~np.isin(err, COACHABLE[ex]))
        dedicated = {}
        for fam, make in (("logistic C=0.1", lambda: lr(0.1)), ("forest", rf), ("boosting", hgb)):
            prob = np.full(len(y), np.nan)
            for p in np.unique(who[r26]):
                tr, hid = rows & (who != p), rows & (who == p)
                prob[hid] = make().fit(D["X"][tr], y[tr]).predict_proba(D["X"][hid])[:, 1]
            dedicated[fam] = prob
        pe = np.mean(list(dedicated.values()), axis=0)
        m = r26 & rows
        res[ex]["coachable_dedicated_ensemble"] = metrics(y[m], pe[m]) | {"people": int(len(set(who[m]))),
                                                                         "trained_on": "REHAB24 (all) + REHAB26 correct and coachable reps, hidden person out"}
        # per-mistake detector exactly as mistake_check.py: logistic, REHAB26 only, correct vs one mistake
        res[ex]["per_mistake_detector"] = {}
        for name in sorted(set(err[r26]) - {""}):
            m = r26 & (good | (err == name))
            Xm, ym, wm = D["X"][m], (err[m] == name).astype(int), who[m]
            pr = np.zeros(len(ym))
            for p in np.unique(wm):
                h = wm == p
                pr[h] = lr(0.1).fit(Xm[~h], ym[~h]).predict_proba(Xm[h])[:, 1]
            res[ex]["per_mistake_detector"][name] = metrics(ym, pr) | {"coachable": name in COACHABLE[ex], "people": int(len(set(wm)))}
        print(f"\n{ex}")
        for cfg, e in res[ex].items():
            if not isinstance(e, dict) or "operating_point" not in e:
                continue
            print(line(cfg, e["main"]))
            op = e["operating_point"]
            print(f"    operating point: {json.dumps(op)}")
            c = e["coachable_same_model"]
            print(f"    coachable (phone, {c['people']} people, {c['reps']} reps): macro F1 {c['macro_f1']:.3f}, AUC {c['auc']:.3f}, "
                  f"precision {c['precision_mistake']:.3f}, recall {c['recall_mistake']:.3f}")
            for name, v in e["per_mistake_same_model"].items():
                print(f"      {name:24s} macro F1 {v['macro_f1']:.3f}  flagged {v['share_flagged_at_0.5']:.2f}  ({v['mistake_reps']} reps)")
            print(f"    confusion [[correct kept, correct flagged], [mistake missed, mistake flagged]]: {e['confusion_at_0.5']}")
        print(line("configuration picked without the tested person", res[ex]["selection_check"]["main"]))
        print("    picked:", res[ex]["selection_check"]["picked"])
        c = res[ex]["coachable_dedicated_ensemble"]
        print(f"  coachable, dedicated ensemble ({c['people']} people, {c['reps']} reps): macro F1 {c['macro_f1']:.3f}, AUC {c['auc']:.3f}, "
              f"precision {c['precision_mistake']:.3f}, recall {c['recall_mistake']:.3f}")
        for name, v in res[ex]["per_mistake_detector"].items():
            print(f"    detector {name:24s} macro F1 {v['macro_f1']:.3f} ({v['mistake_reps']} reps)")

    # g + lab datasets: this dataset only, each person hidden in turn, two fixed model families
    lab = {}
    for ex, name in (("sit_to_stand", "UI-PRMD sit-to-stand"), ("squat", "UI-PRMD deep squat"),
                     ("arm_raise", "UI-PRMD shoulder abduction"), ("arm_raise", "IRDS abduction (patients)")):
        lm, y, who, dur = SOURCES[ex][name]()
        X = feats_of(ns, ex, lm, dur.astype(np.float32))
        D = {"X": X, "y": y.astype(int), "who": who}
        pl = lopo(lambda: lr(0.1), D)
        pe = np.mean([pl, lopo(rf, D)], axis=0)
        lab[name] = {"exercise": ex, "people": int(len(set(who))), "logistic C=0.1": metrics(D["y"], pl), "logistic + forest": metrics(D["y"], pe)}
        print(f"\n{name}: {len(y)} reps, {len(set(who))} people, {D['y'].mean():.1%} with a mistake")
        for k in ("logistic C=0.1", "logistic + forest"):
            v = lab[name][k]
            print(f"   {k:16s} macro F1 {v['macro_f1']:.3f}, AUC {v['auc']:.3f}, precision {v['precision_mistake']:.3f}, recall {v['recall_mistake']:.3f}")
    res["lab"] = lab
    (OUT / "extras.json").write_text(json.dumps(res, indent=1))


def stage_export(ex, ns, config):
    """Train `config` on every camera person and write final_round_out/<exercise>.json (a candidate, nothing replaced)."""
    D = load_camera(ex, ns)
    S = Store(ex)
    assert config in S.res, f"no held-out result for {config!r}"
    X, y = D["X"], D["y"]
    w = None
    if " | aug " in config:
        extra = aug_sets(ex, ns, D)[0]["aug " + config.split(" | aug ")[1]]
        X, y = np.vstack([X] + extra), np.tile(y, 1 + len(extra))
    if "devices weighted equally" in config:
        w = device_weights(D)(np.ones(len(D["y"]), bool))
    cw = None if "unweighted" in config else "balanced"
    fam = config.split(" | ")[0]
    makers = {"logistic C=0.1": lambda: lr(0.1, cw), "forest": lambda: rf(cw), "boosting": lambda: hgb(cw)}
    members = [fit(makers[f](), X, y, w) for f in (makers if fam == "ensemble" else [fam])]
    if fam == "ensemble":
        final = Ensemble([])
        final.members = members
    else:
        final = members[0]
    body = to_dict(final)
    probe = D["X"][:: max(1, len(D["X"]) // 60)]
    gap = max(abs(predict_from_dict(body, row) - q) for row, q in zip(probe, final.predict_proba(probe)[:, 1]))
    assert gap < 1e-6, f"the exported model does not reproduce scikit-learn ({gap})"
    r = S.res[config]
    op, at = operating_point(D["y"], S.probs[config], D["who"])
    cfg = EXERCISES[ex]
    side = ns["WORKING_SIDE_BY"].get(cfg["features"])
    devs = {k: {"reps": v["reps"], "people": v["people"], "macro F1": round(v["macro_f1"], 3), "AUC": round(v["auc"], 3),
                "precision (mistake)": round(v["precision_mistake"], 3), "recall (mistake)": round(v["recall_mistake"], 3)}
            for k, v in r.items() if isinstance(v, dict) and "macro_f1" in v}
    spec = {
        "exercise": ex, "model": "ensemble (logistic + forest + boosting)" if fam == "ensemble" else fam,
        "frames": 64, "signals": D["names"], "stats": ns["STATS"],
        "features": [f"{n}:{s}" for n in D["names"] for s in ns["STATS"]] + ["duration"],
        "one_sided": cfg["features"] in (1, 4, 5), "working_side_by": list(side) if side else [], "pose_model": "heavy",
        "tested_on_unseen_people": {"source": "REHAB24 camera", "macro F1": devs[DEVICE["REHAB24 camera"]]["macro F1"],
                                    "AUC": devs[DEVICE["REHAB24 camera"]]["AUC"], "training": f"camera sources only; {config}",
                                    "same strategy on other sources": f"REHAB26 camera: {devs['phone']['macro F1']:.3f}",
                                    "by_capture_device": devs},
        "training": {"samples": int(len(D["y"])), "people": int(len(set(D["who"]))), "sources": CAMERA,
                     "script": "ml/final_round.py", "config": config, "rows_with_augmented_copies": int(len(y))},
        **body,
    }
    if op["threshold"] is not None:
        spec["flag_threshold"] = op["threshold"]
        spec["operating_point"] = {
            "what": "flag a rep as a mistake only when p(mistake) >= flag_threshold", "target_precision": 0.9,
            "precision": round(op["pooled"]["precision"], 3), "recall": round(op["pooled"]["recall"], 3),
            "at_0.5": {"precision": round(op["at_0.5"]["precision"], 3), "recall": round(op["at_0.5"]["recall"], 3)},
            "tested_on": f"leave-one-person-out over {len(set(D['who']))} people of {', '.join(CAMERA)}"}
    out = OUT / f"{ex}.json"
    out.write_text(json.dumps(spec))
    print(f"wrote candidate {out} ({out.stat().st_size // 1024} kB), largest difference from scikit-learn {gap:.1e}; nothing replaced")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=["families", "aug", "control", "curve", "extras", "export"])
    ap.add_argument("exercise", nargs="?", choices=list(EX_ID))
    ap.add_argument("--config", help="export / extras: configuration name as printed")
    ap.add_argument("--final-squat", default=BASELINE)
    ap.add_argument("--final-arm", default=BASELINE)
    args = ap.parse_args()
    t = time.time()
    ns = notebook_code.load()
    if args.stage == "extras":
        stage_extras(ns, {"squat": [BASELINE, args.final_squat], "arm_raise": [BASELINE, args.final_arm]})
    elif args.stage == "export":
        stage_export(args.exercise, ns, args.config)
    else:
        {"families": stage_families, "aug": stage_aug, "control": stage_control, "curve": stage_curve}[args.stage](args.exercise, ns)
    print(f"\n[{args.stage} {args.exercise or ''}] {time.time() - t:.0f} s")


if __name__ == "__main__":
    main()
