"""Mendeley multi-view fitness dataset (squats) -> body points -> repetitions -> honest tests with REHAB.

"A Multi-View Raw Video Dataset of Seven Fitness Exercises with Good/Bad Form Labels" (Mendeley Data,
DOI 10.17632/kgbb3yn47p.3, CC BY 4.0): 26 people filmed on smartphones in a gym, bodyweight squats, three views
(front, side, diagonal). One label per CLIP (good or bad form); the dataset page does not say which mistakes make
a clip "bad" or how many repetitions a clip holds. fetch_mendeley_squats.py puts the 150 squat clips in
~/jhealth-cache/datasets/mendeley_kgbb3yn47p/. The clips are only ever opened with the video decoder.

Run ONE stage at a time, from ml/ (-I keeps Python from picking up code from anywhere but this folder):

    P=~/jhealth-cache/venv/bin/python
    OMP_NUM_THREADS=2 nice -n 10 $P -I mendeley_squat.py track --max-minutes 7.5   # resumable; repeat until done
    OMP_NUM_THREADS=2 nice -n 10 $P -I mendeley_squat.py reps                      # cut into repetitions
    OMP_NUM_THREADS=2 nice -n 10 $P -I mendeley_squat.py eval                      # 3a alone, 3b transfer, 3e what "bad" means
    OMP_NUM_THREADS=2 nice -n 10 $P -I mendeley_squat.py combined --weights equal  # 3c one model from all three datasets
    OMP_NUM_THREADS=2 nice -n 10 $P -I mendeley_squat.py combined --weights none   # 3c without dataset weights
    OMP_NUM_THREADS=2 nice -n 10 $P -I mendeley_squat.py curve                     # 3d learning curve, larger pool
    OMP_NUM_THREADS=2 nice -n 10 $P -I mendeley_squat.py export --weights equal    # candidate model, nothing replaced

track   the SAME tracker and settings as the heavy REHAB24-6 body points the squat model is trained on
        (extract_clips.track_video: pose_landmarker_heavy.task, VIDEO mode, one person, about 15 frames per second).
        One file per clip in ~/jhealth-cache/landmarks_mendeley/. Front and side views first, diagonal last.
reps    the project's own rep cutter (extract_clips.find_reps, checked by check_segmenter.py) with the squat settings.
        Every repetition gets its clip's label. Output: ~/jhealth-cache/mendeley_squat.npz
"""
import argparse
import json
import re
import sys
import time
import warnings
from pathlib import Path

import numpy as np

warnings.filterwarnings("ignore")
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

CACHE = Path.home() / "jhealth-cache"
SRC = CACHE / "datasets" / "mendeley_kgbb3yn47p"
LM = CACHE / "landmarks_mendeley"
REPS = CACHE / "mendeley_squat.npz"
OUT = HERE / "final_round_out"
NAME = re.compile(r"^subject_(\d{3})_squat_(good|bad)_(front|side|diagonal)\.mp4$")
EXPECTED = 150
T = 64
MAX_MISSING = 0.2          # as build_dataset.py: drop a rep if the tracker lost the person in more than 20% of it
GROUP = "phone (Mendeley, gym)"


def clip_files():
    """Finished downloads only (the fetch job writes <name>.part first), front and side views before diagonal."""
    files = [p for p in SRC.iterdir() if NAME.match(p.name)] if SRC.exists() else []
    return sorted(files, key=lambda p: (NAME.match(p.name).group(3) == "diagonal", p.name))


# ------------------------------------------------------------------------------------------------ 1. tracking

def stage_track(args):
    import extract_clips as ec
    LM.mkdir(parents=True, exist_ok=True)
    t0, last_new, seen, done_now, spent = time.time(), time.time(), set(), 0, []
    while True:
        files = clip_files()
        if {p.name for p in files} - seen:
            last_new = time.time()
        seen |= {p.name for p in files}
        todo = [p for p in files if not (LM / f"{p.stem}.npz").exists() and (args.diagonal or NAME.match(p.name).group(3) != "diagonal")]
        tracked = sum((LM / f"{p.stem}.npz").exists() for p in files)
        if not todo:
            if tracked >= EXPECTED or (len(files) >= EXPECTED and not args.diagonal):
                print(f"all available clips tracked ({tracked})", flush=True)
                return 0
            if time.time() - last_new > 180:
                print(f"no new clip for 3 minutes: stopping with {tracked} tracked of {len(files)} downloaded", flush=True)
                return 0
            if (time.time() - t0) / 60 > args.max_minutes:
                return 3
            time.sleep(10)
            continue
        path = todo[0]
        t = time.time()
        try:
            with ec.quiet_native_logs():
                trk = ec.track_video(path, "heavy")
        except Exception as e:                               # an unreadable clip must not stop the run
            trk = {"times": np.zeros(0), "world": np.zeros((0, 33, 3), np.float32), "vis": np.zeros((0, 33), np.float32),
                   "fps": 0.0, "width": 0, "height": 0}
            print(f"  could not decode {path.name}: {type(e).__name__}", flush=True)
        part = LM / f"{path.stem}.part.npz"
        np.savez_compressed(part, **trk)
        part.rename(LM / f"{path.stem}.npz")
        spent.append(time.time() - t)
        done_now += 1
        w = trk["world"]
        found = float((~np.isnan(w[:, 0, 0])).mean()) if len(w) else 0.0
        upright = float(np.nanmean((w[:, [11, 12], 1].mean(1) < w[:, [23, 24], 1].mean(1)))) if len(w) else 0.0
        print(f"[{tracked + 1:3d} tracked, {time.time() - t0:4.0f}s] {path.name:44s} {len(w):4d} frames, {trk['times'][-1] if len(w) else 0:5.1f} s of video, "
              f"{trk['width']}x{trk['height']} @ {float(trk['fps']):.0f} fps, person found {found:.0%}, upright {upright:.0%}, tracking took {spent[-1]:.0f} s", flush=True)
        if done_now == 3:
            per = float(np.mean(spent))
            print(f"  first 3 clips: {per:.1f} s per clip -> about {per * EXPECTED / 60:.0f} minutes for all {EXPECTED}, "
                  f"{per * EXPECTED * 2 / 3 / 60:.0f} minutes for front + side only", flush=True)
        if args.limit and done_now >= args.limit:
            return 0
        if (time.time() - t0) / 60 > args.max_minutes or (LM / "PAUSE").exists():   # touch PAUSE to free the CPU for another stage
            return 3


# ------------------------------------------------------------------------------------------------ 2. repetitions

def stage_reps(args):
    import extract_clips as ec
    from build_dataset import fill_gaps, resample
    from exercises import EXERCISES
    ex = EXERCISES["squat"]
    cols = {k: [] for k in ("lm", "correct", "person", "view", "clip", "rep", "duration", "min_knee", "depth", "app_check")}
    table = []
    for f in sorted(LM.glob("subject_*.npz")):
        m = NAME.match(f.stem + ".mp4")
        if not m or f.name.endswith(".part.npz"):
            continue
        person, label, view = m.groups()
        d = np.load(f)
        times, world, vis = d["times"], d["world"], d["vis"]
        row = {"clip": f.stem, "person": person, "label": label, "view": view, "frames": int(len(world)), "seconds": float(times[-1]) if len(times) else 0.0,
               "found": 0.0, "joints_clear": 0.0, "upright": 0.0, "rejected": "", "reps": 0, "skipped": 0, "dropped_lost_person": 0, "dropped_flipped_body": 0}
        table.append(row)
        if len(world) < 20:
            continue
        found = ~np.isnan(world[:, 0, 0])
        row["found"] = float(found.mean())
        row["joints_clear"] = float(ec.clear_joint_frames(found, vis, "squat").mean())    # the app's camera preflight; reported, not used to drop
        up = world[:, [11, 12], 1].mean(1) < world[:, [23, 24], 1].mean(1)          # shoulders above hips (y points down)
        row["upright"] = float(up[found].mean()) if found.any() else 0.0
        # Clip gate: the person is found in at least 60% of frames (as extract_clips.py). The app's second check, both
        # legs clearly visible in 75% of frames, is recorded per rep ("app_check") but NOT used to drop clips: a side
        # view hides the far leg, and the REHAB profile views the model is trained on were kept without that check.
        if found.mean() < 0.6:
            row["rejected"] = "person found in under 60% of frames"
            continue
        fps = 1.0 / float(np.median(np.diff(times)))             # the real sampling rate (15 for 30 or 60 fps video)
        raw = ex["rep_signal"](fill_gaps(world.astype(np.float64).copy()))
        reps, _, skipped = ec.find_reps(raw, fps, ex["min_depth"])   # the project's cutter, squat settings, default edge and padding
        row["skipped"] = len(skipped)
        for i, r in enumerate(reps, 1):
            seg = world[r["start"]:r["end"] + 1].astype(np.float64).copy()
            if np.isnan(seg[:, 0, 0]).mean() > MAX_MISSING:
                row["dropped_lost_person"] += 1
                continue
            if up[r["start"]:r["end"] + 1].mean() < 0.9:          # the tracker drew the body upside down: not a usable rep
                row["dropped_flipped_body"] += 1
                continue
            cols["lm"].append(resample(fill_gaps(seg), T).astype(np.float16))
            for k, v in (("correct", int(label == "good")), ("person", person), ("view", view), ("clip", f.stem), ("rep", i),
                         ("duration", float(times[r["end"]] - times[r["start"]] + 1 / fps)), ("min_knee", r["min_knee"]), ("depth", r["depth"]),
                         ("app_check", row["joints_clear"] >= 0.75)):
                cols[k].append(v)
            row["reps"] += 1
    out = {k: np.array(v) for k, v in cols.items()}
    out["duration"] = out["duration"].astype(np.float32)
    np.savez_compressed(REPS, **out)
    OUT.mkdir(exist_ok=True)
    n = np.array([r["reps"] for r in table])
    per_person = {p: int((out["person"] == p).sum()) for p in sorted({r["person"] for r in table})}
    pp = np.array(list(per_person.values()))
    summary = {
        "clips_downloaded": len(clip_files()), "clips_tracked": len(table), "clips_with_zero_reps": int((n == 0).sum()),
        "zero_rep_clips": [r["clip"] for r in table if r["reps"] == 0],
        "clips_by_view": {v: sum(r["view"] == v for r in table) for v in ("front", "side", "diagonal")},
        "clips_rejected_person_found_under_60pct": {v: sum(r["view"] == v and bool(r["rejected"]) for r in table) for v in ("front", "side", "diagonal")},
        "clips_the_app_camera_check_would_refuse (both legs clear in under 75% of frames)": {v: sum(r["view"] == v and r["joints_clear"] < 0.75 for r in table) for v in ("front", "side", "diagonal")},
        "zero_rep_clips_by_view": {v: sum(r["view"] == v and r["reps"] == 0 for r in table) for v in ("front", "side", "diagonal")},
        "zero_rep_clips_by_label": {l: sum(r["label"] == l and r["reps"] == 0 for r in table) for l in ("good", "bad")},
        "reps_from_clips_the_app_check_accepts": int(np.sum(out["app_check"])) if len(out["app_check"]) else 0,
        "clips_where_body_is_upside_down_in_over_10pct_of_frames": {v: sum(r["view"] == v and r["upright"] < 0.9 for r in table) for v in ("front", "side", "diagonal")},
        "reps_dropped_flipped_body": int(sum(r["dropped_flipped_body"] for r in table)),
        "clips_with_reps_by_view": {v: sum(r["view"] == v and r["reps"] > 0 for r in table) for v in ("front", "side", "diagonal")},
        "people_by_view": {v: len({r["person"] for r in table if r["view"] == v and r["reps"] > 0}) for v in ("front", "side", "diagonal")},
        "reps": int(len(out["correct"])), "reps_good": int(out["correct"].sum()), "reps_bad": int((1 - out["correct"]).sum()),
        "reps_by_view": {v: {"good": int(((out["view"] == v) & (out["correct"] == 1)).sum()), "bad": int(((out["view"] == v) & (out["correct"] == 0)).sum())} for v in ("front", "side", "diagonal")},
        "people": len(per_person), "people_with_reps": int((pp > 0).sum()),
        "reps_per_person": {"min": int(pp.min()), "median": float(np.median(pp)), "max": int(pp.max())},
        "reps_per_clip": {"min": int(n.min()), "median": float(np.median(n)), "max": int(n.max())},
        "skipped_dips": int(sum(r["skipped"] for r in table)), "reps_dropped_person_lost": int(sum(r["dropped_lost_person"] for r in table)),
        "median_rep_seconds": float(np.median(out["duration"])) if len(out["duration"]) else None,
        "per_person": per_person, "clips": table}
    (OUT / "mendeley_reps.json").write_text(json.dumps(summary, indent=1))
    print(json.dumps({k: v for k, v in summary.items() if k not in ("clips", "per_person")}, indent=1))
    print(f"saved {REPS} ({REPS.stat().st_size / 1e6:.1f} MB)")


# ------------------------------------------------------------------------------------------------ 3. evaluation

SRC_NAME = {"REHAB26 camera": "phone (REHAB26)", "REHAB24 camera": "fixed camera (REHAB24-6)", "Mendeley camera": GROUP}
REHAB_ONLY = OUT / "squat.json"              # the REHAB-only model exported earlier today (final_round.py export squat)
EQUAL, PLAIN = "ensemble | balanced + datasets weighted equally", "ensemble | balanced"


def load_all():
    import final_round as fr
    import notebook_code
    ns = notebook_code.load()
    D = fr.load_camera("squat", ns)
    M = np.load(REPS)
    Xm = fr.feats_of(ns, "squat", M["lm"].astype(np.float32), M["duration"].astype(np.float32))
    n = len(Xm)
    A = {"X": np.vstack([D["X"], Xm]), "y": np.concatenate([D["y"], 1 - M["correct"]]).astype(int),
         "who": np.concatenate([D["who"], np.array([f"MD-{q}" for q in M["person"]])]),
         "src": np.concatenate([D["src"], np.array(["Mendeley camera"] * n)]),
         "view": np.concatenate([np.array([""] * len(D["y"])), M["view"]]), "names": D["names"], "dur_m": M["duration"], "depth_m": M["min_knee"],
         "app_ok": np.concatenate([np.zeros(len(D["y"]), bool), M["app_check"].astype(bool)])}
    feats = [f"{a}:{b}" for a in D["names"] for b in ns["STATS"]] + ["duration"]
    return fr, ns, A, feats


def groups(fr, A, prob, rows=None):
    """Metrics per dataset (device group), per Mendeley view, and pooled. Needs both classes in a group."""
    ok = ~np.isnan(prob) if rows is None else rows
    sets = [("all", ok)] + [(SRC_NAME[k], ok & (A["src"] == k)) for k in SRC_NAME] + [(f"Mendeley {v}", ok & (A["view"] == v)) for v in ("front", "side", "diagonal")] + [("Mendeley, clips the app's camera check accepts", ok & A["app_ok"])]
    return {name: fr.metrics(A["y"][m], prob[m]) | {"people": int(len(set(A["who"][m])))} for name, m in sets if m.any() and len(set(A["y"][m])) == 2}


def show(name, g):
    print(f"  {name}")
    for k, v in g.items():
        print(f"      {k:48s} {v['people']:3d} people {v['reps']:5d} reps ({v['mistake_reps']:4d} mistakes)  macro F1 {v['macro_f1']:.3f}  AUC {v['auc']:.3f}  "
              f"precision {v['precision_mistake']:.3f}  recall {v['recall_mistake']:.3f}  floor {v['floor_always_correct']:.3f}", flush=True)


def save(key, value, probs=None):
    f = OUT / "mendeley_eval.json"
    res = json.loads(f.read_text()) if f.exists() else {}
    res[key] = value
    f.write_text(json.dumps(res, indent=1))
    if probs is not None:
        pf = OUT / "probs_mendeley.npz"
        allp = dict(np.load(pf)) if pf.exists() else {}
        allp.update(probs)
        np.savez_compressed(pf, **allp)


def ensemble_lopo(fr, D, weight=None):
    """The app's model family: soft vote of logistic (C=0.1), forest and boosting, each person hidden in turn."""
    return np.mean([fr.lopo(make, D, weight=weight) for make in (lambda: fr.lr(0.1), fr.rf, fr.hgb)], axis=0)


def stage_eval(args):
    """3a Mendeley alone, 3b the REHAB-only model applied as it is, 3e what separates 'bad' from 'good'."""
    from train_squat import predict_from_dict
    fr, ns, A, feats = load_all()
    md = A["src"] == "Mendeley camera"
    print(f"Mendeley: {md.sum()} reps, {len(set(A['who'][md]))} people, {A['y'][md].mean():.1%} labelled bad")

    # 3b. transfer: no retraining, the exported JSON evaluated with plain arithmetic (what the browser does)
    spec = json.loads(REHAB_ONLY.read_text())
    assert spec["features"] == feats and spec["training"]["sources"] == ["REHAB24 camera", "REHAB26 camera"]
    pt = np.full(len(A["y"]), np.nan)
    pt[md] = [predict_from_dict(spec, row) for row in A["X"][md]]
    g = groups(fr, A, pt)
    show("3b. REHAB-only model (current squat.json) applied to Mendeley, no retraining", g)
    thr = spec.get("flag_threshold")
    flag = pt[md] >= thr
    tp = int((flag & (A["y"][md] == 1)).sum())
    at_thr = {"threshold": thr, "flagged": int(flag.sum()), "precision": tp / max(1, int(flag.sum())), "recall": tp / max(1, int(A["y"][md].sum())),
              "share_of_good_reps_called_mistake_at_0.5": float((pt[md][A["y"][md] == 0] > 0.5).mean())}
    print("      at the app's flag cut-off:", json.dumps(at_thr))
    save("3b_transfer", {"groups": g, "at_flag_threshold": at_thr, "model": spec["training"]}, {"transfer": pt})

    # 3e. what does "bad" mean here? standardised difference of the feature means, bad minus good
    X, y, who = A["X"][md], A["y"][md], A["who"][md]
    sd = X.std(0) + 1e-9
    d = (X[y == 1].mean(0) - X[y == 0].mean(0)) / sd
    people = [q for q in np.unique(who) if len(set(y[who == q])) == 2]
    per = np.array([(X[(who == q) & (y == 1)].mean(0) - X[(who == q) & (y == 0)].mean(0)) / sd for q in people])
    order = np.argsort(-np.abs(d))
    top = [{"feature": feats[j], "standardised_difference_bad_minus_good": float(d[j]), "mean_good": float(X[y == 0, j].mean()), "mean_bad": float(X[y == 1, j].mean()),
            "people_with_the_same_direction": int((np.sign(per[:, j]) == np.sign(d[j])).sum()), "people_with_both_labels": len(people)} for j in order[:15]]
    print("  3e. features that differ most between bad and good reps (bad minus good, in standard deviations)")
    for t in top:
        print(f"      {t['feature']:32s} {t['standardised_difference_bad_minus_good']:+.2f}   good {t['mean_good']:9.3f}  bad {t['mean_bad']:9.3f}   "
              f"same direction in {t['people_with_the_same_direction']} of {t['people_with_both_labels']} people")
    by_view = {v: [feats[j] for j in np.argsort(-np.abs((X[(y == 1) & (A["view"][md] == v)].mean(0) - X[(y == 0) & (A["view"][md] == v)].mean(0)) / sd))[:5]]
               for v in ("front", "side", "diagonal") if ((A["view"][md] == v) & (y == 1)).any() and ((A["view"][md] == v) & (y == 0)).any()}
    plain = {"good": {"median_seconds": float(np.median(A["dur_m"][y == 0])), "median_lowest_knee_angle": float(np.median(A["depth_m"][y == 0]))},
             "bad": {"median_seconds": float(np.median(A["dur_m"][y == 1])), "median_lowest_knee_angle": float(np.median(A["depth_m"][y == 1]))}}
    jk, jd = feats.index("avg_knee:min"), feats.index("duration")       # context: how deep and how fast each dataset's squats are
    context = {SRC_NAME[k]: {lab: {"reps": int(((A["src"] == k) & (A["y"] == v)).sum()),
                                   "median_lowest_knee_angle": float(np.median(A["X"][(A["src"] == k) & (A["y"] == v), jk])),
                                   "median_seconds": float(np.median(A["X"][(A["src"] == k) & (A["y"] == v), jd]))}
                             for lab, v in (("correct or good", 0), ("mistake or bad", 1))} for k in SRC_NAME}
    print("      top 5 per view:", json.dumps(by_view))
    print("      plain:", json.dumps(plain))
    print("      depth and tempo by dataset:", json.dumps(context))
    save("3e_what_bad_means", {"top": top, "top5_by_view": by_view, "plain": plain, "depth_and_tempo_by_dataset": context})

    # 3a. Mendeley alone, each person hidden in turn (all views of that person hidden together)
    Dm = {"X": X, "y": y, "who": who}
    pa = np.full(len(A["y"]), np.nan)
    pa[md] = ensemble_lopo(fr, Dm)
    g = groups(fr, A, pa)
    show("3a. trained on Mendeley alone, leave one person out", g)
    save("3a_mendeley_alone", {"groups": g}, {"mendeley_alone": pa})


def dataset_weights(A):
    """Each dataset counts the same in training, however many repetitions it has (the recipe of the current model)."""
    def w(tr):
        s = A["src"][tr]
        names = np.unique(s)
        return np.array([len(s) / (len(names) * (s == v).sum()) for v in names])[np.searchsorted(names, s)]
    return w


def stage_combined(args):
    """3c. One model from REHAB24-6 + REHAB26 + Mendeley, every one of the people hidden in turn."""
    fr, ns, A, feats = load_all()
    name = EQUAL if args.weights == "equal" else PLAIN
    prob = ensemble_lopo(fr, A, weight=dataset_weights(A) if args.weights == "equal" else None)
    g = groups(fr, A, prob)
    show(f"3c. REHAB24-6 + REHAB26 + Mendeley, leave one person out: {name}", g)
    per_person = {q: float(fr.f1_score(A["y"][A["who"] == q], prob[A["who"] == q] > 0.5, average="macro")) for q in np.unique(A["who"])}
    save(f"3c_combined | {name}", {"groups": g, "per_person_macro_f1": per_person, "people": int(len(set(A["who"]))), "reps": int(len(A["y"]))}, {f"combined | {name}": prob})


def stage_curve(args):
    """3d. Learning curve over the larger pool: hidden person as always, training people drawn at random from the rest."""
    fr, ns, A, feats = load_all()
    X, y, who = A["X"], A["y"], A["who"]
    people = np.unique(who)
    rng = np.random.default_rng(7)
    sizes = [k for k in (2, 5, 10, 13, 20, 30) if k < len(people) - 1] + [len(people) - 1]
    out = {"model": "soft vote of logistic (C=0.1) + forest (100 trees), balanced", "repeats": args.repeats, "people": int(len(people)), "points": {}}
    for k in sizes:
        runs = []
        for r in range(1 if k == len(people) - 1 else args.repeats):
            prob, n_train = np.full(len(y), np.nan), []
            for q in people:
                others = people[people != q]
                while True:
                    tr = np.isin(who, rng.choice(others, k, replace=False))
                    if len(set(y[tr])) == 2:
                        break
                n_train.append(int(tr.sum()))
                prob[who == q] = fr.lite().fit(X[tr], y[tr]).predict_proba(X[who == q])[:, 1]
            runs.append({name: m["macro_f1"] for name, m in groups(fr, A, prob).items()} | {"train_reps": float(np.mean(n_train))})
        out["points"][str(k)] = runs
        print(f"  {k:2d} training people ({np.mean([r['train_reps'] for r in runs]):6.0f} reps): " + ", ".join(
            f"{n} {np.mean([r[n] for r in runs]):.3f} (sd {np.std([r[n] for r in runs]):.3f})" for n in ("all",) + tuple(SRC_NAME.values()) if n in runs[0]), flush=True)
        (OUT / "curve_squat_mendeley.json").write_text(json.dumps(out, indent=1))


def stage_export(args):
    """Train the combined configuration on everyone and write final_round_out/squat_with_mendeley.json. Nothing is replaced."""
    from exercises import EXERCISES
    from train_squat import Ensemble, predict_from_dict, to_dict
    fr, ns, A, feats = load_all()
    name = EQUAL if args.weights == "equal" else PLAIN
    res = json.loads((OUT / "mendeley_eval.json").read_text())[f"3c_combined | {name}"]
    prob = np.load(OUT / "probs_mendeley.npz")[f"combined | {name}"]
    w = dataset_weights(A)(np.ones(len(A["y"]), bool)) if args.weights == "equal" else None
    final = Ensemble([])
    final.members = [fr.fit(make(), A["X"], A["y"], w) for make in (lambda: fr.lr(0.1), fr.rf, fr.hgb)]
    body = to_dict(final)
    probe = A["X"][:: max(1, len(A["X"]) // 60)]
    gap = max(abs(predict_from_dict(body, row) - q) for row, q in zip(probe, final.predict_proba(probe)[:, 1]))
    assert gap < 1e-6, f"the exported model does not reproduce scikit-learn ({gap})"
    op, at = fr.operating_point(A["y"], prob, A["who"])
    devs = {k: {"reps": v["reps"], "people": v["people"], "macro F1": round(v["macro_f1"], 3), "AUC": round(v["auc"], 3),
                "precision (mistake)": round(v["precision_mistake"], 3), "recall (mistake)": round(v["recall_mistake"], 3)} for k, v in res["groups"].items()}
    fixed, phone = devs[SRC_NAME["REHAB24 camera"]], devs[SRC_NAME["REHAB26 camera"]]
    spec = {
        "exercise": "squat", "model": "ensemble (logistic + forest + boosting)", "frames": 64, "signals": A["names"], "stats": ns["STATS"], "features": feats,
        "one_sided": False, "working_side_by": [], "pose_model": "heavy",
        "tested_on_unseen_people": {"source": "REHAB24 camera", "macro F1": fixed["macro F1"], "AUC": fixed["AUC"], "training": f"three camera datasets; {name}",
                                    "same strategy on other sources": f"REHAB26 camera: {phone['macro F1']:.3f}; Mendeley camera: {devs[GROUP]['macro F1']:.3f}",
                                    "by_capture_device": devs},
        "training": {"samples": int(len(A["y"])), "people": int(len(set(A["who"]))), "sources": list(SRC_NAME), "script": "ml/mendeley_squat.py", "config": name},
        **body,
    }
    if op["threshold"] is not None:
        spec["flag_threshold"] = op["threshold"]
        spec["operating_point"] = {
            "what": "flag a rep as a mistake only when p(mistake) >= flag_threshold", "target_precision": 0.9,
            "precision": round(op["pooled"]["precision"], 3), "recall": round(op["pooled"]["recall"], 3),
            "at_0.5": {"precision": round(op["at_0.5"]["precision"], 3), "recall": round(op["at_0.5"]["recall"], 3)},
            "by_dataset": {SRC_NAME[k]: at(op["threshold"], A["src"] == k) for k in SRC_NAME},
            "tested_on": f"leave-one-person-out over {len(set(A['who']))} people of {', '.join(SRC_NAME)}"}
    save(f"operating_point | {name}", op | ({"by_dataset": spec["operating_point"]["by_dataset"]} if op["threshold"] is not None else {}))
    out = OUT / "squat_with_mendeley.json"
    out.write_text(json.dumps(spec))
    print(f"wrote candidate {out} ({out.stat().st_size // 1024} kB), largest difference from scikit-learn {gap:.1e}; nothing replaced")
    print("operating point:", json.dumps(spec.get("operating_point")))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=["track", "reps", "eval", "combined", "curve", "export"])
    ap.add_argument("--weights", choices=["equal", "none"], default="equal", help="combined / export: weight the three datasets equally (the current model's recipe) or not")
    ap.add_argument("--repeats", type=int, default=3, help="curve: random draws per size")
    ap.add_argument("--max-minutes", type=float, default=7.5, help="track: stop after the clip in progress once this long has passed (run again to resume)")
    ap.add_argument("--limit", type=int, default=0, help="track: stop after this many clips")
    ap.add_argument("--no-diagonal", dest="diagonal", action="store_false", help="track: front and side views only")
    args = ap.parse_args()
    t = time.time()
    code = {"track": stage_track, "reps": stage_reps, "eval": stage_eval, "combined": stage_combined, "curve": stage_curve, "export": stage_export}[args.stage](args)
    print(f"[{args.stage}] {time.time() - t:.0f} s", flush=True)
    return code or 0


if __name__ == "__main__":
    sys.exit(main())
