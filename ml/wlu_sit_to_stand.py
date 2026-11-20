"""WLU Rehabilitation Posture (Kaggle, MIT licence): the first labelled CAMERA clips of sit-to-stand we could find.

    https://www.kaggle.com/datasets/sulaimanmuhammed/wlu-rehabilitation-posture

339 short home videos (phones and webcams, faces pixelated), in folders "<exercise> Correct" / "<exercise> Incorrect".
We use only "Sit To Stand": its "Arm Raise" is both arms overhead, a different movement from our one-arm raise to
the side, and seated knee extension is no longer a camera exercise in the app.

The archive stays zipped (the laptop's disk is nearly full). Every step reads one clip at a time.

    python -I wlu_sit_to_stand.py track      # pose-track every sit-to-stand clip   -> ~/jhealth-cache/landmarks_wlu/
    python -I wlu_sit_to_stand.py describe   # what happens in every clip           -> final_round_out/wlu_clips.csv
    python -I wlu_sit_to_stand.py group      # group clips by room (nobody is named)  -> final_round_out/wlu_groups.json
    python -I wlu_sit_to_stand.py rules      # the app's rules on these clips, and better thresholds -> final_round_out/wlu_rules.json
    python -I wlu_sit_to_stand.py models     # what the trained models say about these repetitions  -> final_round_out/wlu_models.json
    python -I wlu_sit_to_stand.py chart      # docs/img/sit_to_stand_camera.png
"""
import argparse
import json
import sys
import time
import zipfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

CACHE = Path.home() / "jhealth-cache"
ZIP = CACHE / "datasets" / "wlu_rehab" / "wlu_rehab.zip"
TMP = CACHE / "datasets" / "wlu_rehab" / "tmp"
LANDMARKS = CACHE / "landmarks_wlu"
THUMBS = CACHE / "landmarks_wlu" / "thumbs"
FOLDERS = {"Blurred/Sit To Stand Correct/": "good", "Blurred/Sit To Stand Incorrect/": "bad"}


def clips():
    """(key, label, zip entry) for every sit-to-stand video, in a stable order."""
    z = zipfile.ZipFile(ZIP)
    out = []
    for info in z.infolist():
        for folder, label in FOLDERS.items():
            if info.filename.startswith(folder) and not info.is_dir():
                stem, ext = info.filename[len(folder):].rsplit(".", 1)
                out.append((f"{label}__{stem}_{ext.lower()}", label, info))
    return z, sorted(out, key=lambda c: c[0])


def thumbnails(path, key):
    """First, middle and last frame, small, side by side: enough to see the room, the person and the movement."""
    import cv2
    cap = cv2.VideoCapture(str(path))
    try:
        cap.set(cv2.CAP_PROP_ORIENTATION_AUTO, 1)
    except Exception:
        pass
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    tiles = []
    for pos in (0.05, 0.3, 0.5, 0.7, 0.95):
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(n * pos))
        ok, frame = cap.read()
        if not ok:
            continue
        h, w = frame.shape[:2]
        s = 200 / max(h, w)
        small = cv2.resize(frame, (max(1, int(w * s)), max(1, int(h * s))))
        tile = np.full((200, 200, 3), 30, np.uint8)
        tile[:small.shape[0], :small.shape[1]] = small
        tiles.append(tile)
    cap.release()
    if tiles:
        THUMBS.mkdir(parents=True, exist_ok=True)
        cv2.imwrite(str(THUMBS / f"{key}.jpg"), np.hstack(tiles), [cv2.IMWRITE_JPEG_QUALITY, 70])


def track(max_minutes):
    from extract_clips import quiet_native_logs, track_video
    z, todo = clips()
    LANDMARKS.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(parents=True, exist_ok=True)
    t0, done = time.time(), 0
    for n, (key, label, info) in enumerate(todo, 1):
        out = LANDMARKS / f"{key}.npz"
        if out.exists():
            continue
        if max_minutes and time.time() - t0 > max_minutes * 60:
            print(f"[track] stopping after {max_minutes} min, run again to continue", flush=True)
            break
        tmp = TMP / ("clip." + info.filename.rsplit(".", 1)[-1].lower())
        tmp.write_bytes(z.read(info))
        t1 = time.time()
        try:
            thumbnails(tmp, key)
            with quiet_native_logs():
                trk = track_video(tmp, "heavy")
        finally:
            tmp.unlink(missing_ok=True)
        np.savez_compressed(out, label=label, source=info.filename, **trk)
        found = ~np.isnan(trk["world"][:, 0, 0]) if len(trk["world"]) else np.zeros(0, bool)
        done += 1
        print(f"[{n:3d}/{len(todo)} {time.time() - t0:4.0f}s] {key:22s} {len(trk['times']):3d} frames, "
              f"{trk['times'][-1] if len(trk['times']) else 0:4.1f} s, {trk['width']}x{trk['height']} @ {trk['fps']:.0f} fps, "
              f"person found {found.mean() if len(found) else 0:.0%}, took {time.time() - t1:.0f} s", flush=True)
    left = sum(1 for key, _, _ in todo if not (LANDMARKS / f"{key}.npz").exists())
    print(f"[track] {done} clips tracked now, {left} left of {len(todo)}", flush=True)


# ---------------------------------------------------------------- what is in each clip

STAND_DEG, SIT_DEG = 135.0, 115.0     # knee angle from the camera's 3D points: standing is about 150 to 160, sitting 75 to 100


def posture_path(knee):
    """The clip as a string of postures, e.g. "USU" = up (standing), sat down, stood up again.

    U = standing (knee straighter than STAND_DEG), S = sitting (more bent than SIT_DEG). Anything between the two
    lines keeps the previous posture, so a half-hearted rise from the chair never counts as standing.
    """
    path, state = "", None
    for k in knee:
        new = "U" if k >= STAND_DEG else "S" if k <= SIT_DEG else state
        if new and new != state:
            path += new
            state = new
    return path


def describe():
    """One row per clip: label, posture path, what our repetition counter finds. Printed and saved as CSV."""
    import csv
    from scipy.signal import savgol_filter
    from build_dataset import fill_gaps
    from exercises import EXERCISES, knee_both
    from extract_clips import SAMPLE_FPS, clear_joint_frames, find_reps
    rows = []
    for f in sorted(LANDMARKS.glob("*.npz")):
        d = np.load(f)
        world, vis = d["world"].astype(np.float64), d["vis"]
        found = ~np.isnan(world[:, 0, 0]) if len(world) else np.zeros(0, bool)
        row = {"clip": f.stem, "label": str(d["label"]), "seconds": round(float(d["times"][-1]), 1) if len(found) else 0,
               "size": f"{int(d['width'])}x{int(d['height'])}", "found": round(float(found.mean()), 2) if len(found) else 0}
        if len(found) < 12 or found.mean() < 0.6:
            rows.append({**row, "legs_clear": 0, "path": "", "knee_min": "", "knee_max": "", "reps": 0, "skipped": 0})
            continue
        clear = clear_joint_frames(found, vis, "sit_to_stand")
        knee = knee_both(fill_gaps(world.copy()))
        win = max(5, int(round(0.5 * SAMPLE_FPS)) | 1)
        smooth = savgol_filter(knee, win, 2) if len(knee) > win + 2 else knee
        reps, _, skipped = find_reps(knee, SAMPLE_FPS, EXERCISES["sit_to_stand"]["min_depth"])
        rows.append({**row, "legs_clear": round(float(clear.mean()), 2), "path": posture_path(smooth),
                     "knee_min": int(round(smooth.min())), "knee_max": int(round(smooth.max())),
                     "reps": len(reps), "skipped": len(skipped)})
    out = HERE / "final_round_out" / "wlu_clips.csv"
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
    from collections import Counter
    for label in ("good", "bad"):
        sub = [r for r in rows if r["label"] == label]
        print(f"\n{label}: {len(sub)} clips")
        for path, n in Counter(r["path"] or "(person not found)" for r in sub).most_common():
            reps = Counter(r["reps"] for r in sub if (r["path"] or "(person not found)") == path)
            print(f"   {path:20s} {n:3d} clips   repetitions our counter finds: {dict(sorted(reps.items()))}")
    print(f"\nsaved {out}")
    return rows


# ---------------------------------------------------------------- who is who

GROUPS_FILE = HERE / "final_round_out" / "wlu_groups.json"


def group(threshold):
    """The dataset does not say who is in which clip, so we group clips by ROOM: same room, same camera position.

    Each clip's first frame is shrunk to 6x6 colour blocks; clips whose blocks look alike are put together
    (agglomerative clustering). Contact sheets are written so a human can check every group by eye. A "group" is a
    recording set-up, which is at least as strict as a person for testing: nobody's room is in both training and test.
    """
    import cv2
    from scipy.cluster.hierarchy import fcluster, linkage
    keys, feats, strips = [], [], {}
    for f in sorted(THUMBS.glob("*.jpg")):
        strip = cv2.imread(str(f))
        tile = strip[:, :200]
        used = tile[(tile.sum(2) > 95).any(1)][:, (tile.sum(2) > 95).any(0)]        # drop the grey padding
        if used.size == 0:
            continue
        lab = cv2.cvtColor(cv2.resize(used, (6, 6), interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2LAB).astype(np.float32)
        lab[..., 0] *= 0.5                                                           # brightness changes between takes
        aspect = used.shape[1] / used.shape[0]
        feats.append(np.concatenate([lab.ravel(), [aspect * 60]]))
        keys.append(f.stem); strips[f.stem] = strip
    ids = fcluster(linkage(np.array(feats), "average"), threshold, "distance")
    order = sorted(set(ids), key=lambda g: -int((ids == g).sum()))
    groups = {k: f"room{order.index(g) + 1:02d}" for k, g in zip(keys, ids)}
    GROUPS_FILE.write_text(json.dumps(groups, indent=1, sort_keys=True))
    sheet_dir = CACHE / "datasets" / "wlu_rehab" / "sheets"
    sheet_dir.mkdir(parents=True, exist_ok=True)
    for old in sheet_dir.glob("*.jpg"):
        old.unlink()
    rows = []
    for g in sorted(set(groups.values())):
        members = [k for k in keys if groups[k] == g]
        print(f"{g}: {len(members):3d} clips   good {sum(k.startswith('good') for k in members):2d}  bad {sum(k.startswith('bad') for k in members):2d}")
        for k in members[:3] + members[-1:]:
            row = cv2.resize(strips[k][:, :600], (360, 120))
            cv2.putText(row, f"{g} {k}", (4, 14), cv2.FONT_HERSHEY_SIMPLEX, 0.42, (0, 255, 255), 1)
            rows.append(row)
    per_col = 14
    cols = [rows[i:i + per_col] for i in range(0, len(rows), per_col)]
    for n in range(0, len(cols), 4):
        page = [np.vstack(c + [np.zeros_like(rows[0])] * (per_col - len(c))) for c in cols[n:n + 4]]
        cv2.imwrite(str(sheet_dir / f"groups_{n // 4 + 1}.jpg"), np.hstack(page), [cv2.IMWRITE_JPEG_QUALITY, 72])
    print(f"{len(set(groups.values()))} groups, sheets in {sheet_dir}")


# ---------------------------------------------------------------- the app's rules on real home clips

FINAL_GROUPS = HERE / "wlu_groups.json"      # clip -> recording set-up (six of them), made by `group` and checked by eye
RULES_BEFORE = dict(upright=155.0, knees_in="any", timing=True)       # web/src/lib/pose/exercises.ts until 19 Nov 2026
RULES_NOW = dict(upright=145.0, knees_in="facing", timing=True)       # ... and after this check (UPRIGHT_KNEE, FACING_MIN)
KNEES_IN_RATIO, FACING_MIN, MIN_DEPTH = 0.8, 0.6, 30.0


def measure_clip(d):
    """What the app's sit-to-stand rules look at, measured on one clip. None when the person was not tracked.

    The app counts a repetition as standing -> sitting -> standing. Half of these clips start on the chair instead
    (sitting -> standing -> sitting), so both orders count as one complete cycle here; the angles and times that the
    rules read are the same in either order.
    """
    from scipy.signal import savgol_filter
    from build_dataset import fill_gaps
    from exercises import knee_both
    from extract_clips import SAMPLE_FPS, find_reps
    world = d["world"].astype(np.float64)
    found = ~np.isnan(world[:, 0, 0]) if len(world) else np.zeros(0, bool)
    if len(found) < 12 or found.mean() < 0.6:
        return None
    w = fill_gaps(world.copy())
    t = d["times"].astype(np.float64)
    knee = knee_both(w)
    win = max(5, int(round(0.5 * SAMPLE_FPS)) | 1)
    k = savgol_filter(knee, win, 2) if len(knee) > win + 2 else knee
    dips, _, _ = find_reps(knee, SAMPLE_FPS, MIN_DEPTH)
    peaks, _, _ = find_reps(300.0 - knee, SAMPLE_FPS, MIN_DEPTH)
    out = {"cycle": "", "stand": float(k.max()), "seat": float(k.min()), "descent_s": np.nan, "active_s": np.nan,
           "knees_in_share": 0.0, "knees_in_facing_share": 0.0, "facing": np.nan}
    if dips:                                    # the app's own order: stand, sit, stand
        r = max(dips, key=lambda r: r["depth"])
        s, e, v = r["start"], r["end"], r["valley"]
        top = s + int(np.argmax(k[s:v + 1]))
        out.update(cycle="stand-sit-stand", stand=r["min_knee"] + r["depth"], seat=r["min_knee"], descent_s=t[v] - t[top])
        out["active_s"] = t[e] - t[s]
    elif peaks:                                 # starts on the chair: sit, stand, sit
        r = max(peaks, key=lambda r: r["depth"])
        s, e, v = r["start"], r["end"], r["valley"]
        low = v + int(np.argmin(k[v:e + 1]))
        out.update(cycle="sit-stand-sit", stand=float(k[v]), seat=300.0 - (r["min_knee"] + r["depth"]), descent_s=t[low] - t[v])
        out["active_s"] = t[e] - t[s]
    if out["cycle"]:
        ratio = np.abs(w[s:e + 1, 25, 0] - w[s:e + 1, 26, 0]) / (np.abs(w[s:e + 1, 27, 0] - w[s:e + 1, 28, 0]) + 1e-9)
        bent = k[s:e + 1] < min(150.0, out["stand"] - MIN_DEPTH)
        across = w[s:e + 1, 11] - w[s:e + 1, 12]
        facing = np.abs(across[:, 0]) / (np.linalg.norm(across, axis=1) + 1e-9)        # 1 = front on, 0 = side on
        out["knees_in_share"] = float((bent & (ratio < KNEES_IN_RATIO)).mean())
        out["knees_in_facing_share"] = float((bent & (ratio < KNEES_IN_RATIO) & (facing >= FACING_MIN)).mean())
        out["facing"] = float(np.median(facing))
    return out


def verdict(m, upright, knees_in, timing):
    """The rule that fires first, or "" when the repetition passes. Same order as the app."""
    if m is None:
        return "not tracked"
    if not m["cycle"]:
        return "no complete repetition"
    if knees_in and m["knees_in_share" if knees_in == "any" else "knees_in_facing_share"] >= 0.25:
        return "knees_in"
    if m["stand"] < upright:
        return "not_upright"
    if timing and m["descent_s"] < 0.8:
        return "sit_slowly"
    if timing and m["active_s"] < 1.5:
        return "too_fast"
    return ""


def scores(y, said_mistake):
    """y and said_mistake are 0/1 arrays, 1 = incorrect clip / the rules objected."""
    from sklearn.metrics import f1_score
    y, p = np.asarray(y), np.asarray(said_mistake)
    return dict(n=int(len(y)), accuracy=float((y == p).mean()), macro_f1=float(f1_score(y, p, average="macro")),
                correct_accepted=float((p[y == 0] == 0).mean()), incorrect_caught=float((p[y == 1] == 1).mean()))


def rules():
    """How the app's sit-to-stand rules do on 127 real home clips, and which thresholds would do better.

    Thresholds are never chosen on the clips they are tested on: each recording set-up is hidden in turn, the best
    setting is picked on the other five, and that setting is scored on the hidden one.
    """
    import csv
    import itertools
    from collections import Counter
    groups = json.loads(FINAL_GROUPS.read_text())
    keys, ms = [], []
    for f in sorted(LANDMARKS.glob("*.npz")):
        keys.append(f.stem); ms.append(measure_clip(np.load(f)))
    y = np.array([int(k.startswith("bad")) for k in keys])
    g = np.array([groups[k] for k in keys])

    with open(HERE / "final_round_out" / "wlu_measures.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["clip", "setup", "label", "cycle", "stand_deg", "seat_deg", "descent_s", "active_s", "facing", "rules_before", "rules_now"])
        for k, gi, m in zip(keys, g, ms):
            if m is None:
                w.writerow([k, gi, k.split("__")[0], "not tracked"]); continue
            w.writerow([k, gi, k.split("__")[0], m["cycle"], round(m["stand"], 1), round(m["seat"], 1), round(m["descent_s"], 2),
                        round(m["active_s"], 2), round(m["facing"], 2), verdict(m, **RULES_BEFORE) or "ok", verdict(m, **RULES_NOW) or "ok"])

    def run(cfg):
        return np.array([int(bool(verdict(m, **cfg))) for m in ms])

    results = {}
    for n, (name, cfg) in enumerate((("before", RULES_BEFORE), ("now", RULES_NOW)), 1):
        print(f"{n}. The app's rules {name}: {cfg}")
        said = [verdict(m, **cfg) or "ok" for m in ms]
        for label, what in ((0, "correct clips"), (1, "incorrect clips")):
            c = Counter(s for s, yi in zip(said, y) if yi == label)
            print(f"   {what:16s} ({int((y == label).sum())}): " + ", ".join(f"{k} {v}" for k, v in c.most_common()))
        sc = scores(y, run(cfg))
        per = {s: float((run(cfg)[g == s] == y[g == s]).mean()) for s in sorted(set(g))}
        print(f"   agreement with the dataset's labels: accuracy {sc['accuracy']:.3f}, macro F1 {sc['macro_f1']:.3f}; "
              f"correct clips accepted {sc['correct_accepted']:.0%}, incorrect clips caught {sc['incorrect_caught']:.0%}")
        print("   per set-up accuracy: " + ", ".join(f"{s} {a:.2f}" for s, a in per.items()) + "\n")
        results[name] = {"rules": cfg, **sc, "said": dict(Counter(said)), "per_setup_accuracy": per}

    stand = np.array([m["stand"] for m in ms if m and m["cycle"]])
    stand_good = np.array([m["stand"] for m, yi in zip(ms, y) if m and m["cycle"] and yi == 0])
    print(f"3. Knee angle when standing, correct clips with a full cycle (n={len(stand_good)}): "
          f"median {np.median(stand_good):.0f}, 10th percentile {np.percentile(stand_good, 10):.0f}, "
          f"below 155: {(stand_good < 155).mean():.0%}, below 145: {(stand_good < 145).mean():.0%}, below 140: {(stand_good < 140).mean():.0%}")

    grid = [dict(upright=u, knees_in=ki, timing=ti) for u, ki, ti in itertools.product(
        (135.0, 140.0, 145.0, 150.0, 155.0), ("any", "facing", False), (True, False))]
    preds = [run(c) for c in grid]

    def best_on(mask):
        f = [scores(y[mask], p[mask])["macro_f1"] for p in preds]
        return int(np.argmax(f))

    held = np.zeros(len(y), int)
    picked = []
    for setup in sorted(set(g)):
        test = g == setup
        i = best_on(~test)
        held[test] = preds[i][test]
        picked.append((setup, grid[i]))
    tuned = scores(y, held)
    print("\n4. Thresholds picked on five set-ups, scored on the sixth (every set-up hidden in turn)")
    for setup, cfg in picked:
        m = g == setup
        sc = scores(y[m], held[m])
        print(f"   {setup}: {int(m.sum()):3d} clips, accuracy {sc['accuracy']:.2f}   picked {cfg}")
    print(f"   all held-out clips: accuracy {tuned['accuracy']:.3f}, macro F1 {tuned['macro_f1']:.3f}; "
          f"correct clips accepted {tuned['correct_accepted']:.0%}, incorrect clips caught {tuned['incorrect_caught']:.0%}")
    out = {"dataset": "WLU Rehabilitation Posture, Sit To Stand", "clips": int(len(y)), "correct": int((y == 0).sum()),
           "incorrect": int((y == 1).sum()), "setups": {s: int((g == s).sum()) for s in sorted(set(g))},
           "cycles": dict(Counter(m["cycle"] or "none" for m in ms if m)),
           "rules_before": results["before"], "rules_now": results["now"],
           "held_out_tuned": {**tuned, "picked": [{"setup": s, **c} for s, c in picked]},
           "stand_knee_correct": {"n": int(len(stand_good)), "median": float(np.median(stand_good)), "p10": float(np.percentile(stand_good, 10)),
                                  "below_155": float((stand_good < 155).mean()), "below_145": float((stand_good < 145).mean())}}
    (HERE / "final_round_out" / "wlu_rules.json").write_text(json.dumps(out, indent=1))
    print("\nsaved final_round_out/wlu_rules.json and wlu_measures.csv")


# ---------------------------------------------------------------- the trained models on these repetitions

REPS_FILE = CACHE / "wlu_sit_to_stand.npz"


def cut_reps():
    """Stand-sit-stand repetitions exactly as the app cuts them (64 frames each). Clips that start on the chair give none."""
    from build_dataset import fill_gaps, resample
    from exercises import knee_both
    from extract_clips import SAMPLE_FPS, T, find_reps
    groups = json.loads(FINAL_GROUPS.read_text())
    cols = {k: [] for k in ("lm", "y", "group", "duration", "clip")}
    for f in sorted(LANDMARKS.glob("*.npz")):
        d = np.load(f)
        world = d["world"].astype(np.float64)
        found = ~np.isnan(world[:, 0, 0]) if len(world) else np.zeros(0, bool)
        if len(found) < 12 or found.mean() < 0.6:
            continue
        w, t = fill_gaps(world.copy()), d["times"]
        reps, _, _ = find_reps(knee_both(w), SAMPLE_FPS, MIN_DEPTH)
        for r in reps:
            cols["lm"].append(resample(w[r["start"]:r["end"] + 1], T).astype(np.float32))
            cols["y"].append(int(f.stem.startswith("bad"))); cols["group"].append(groups[f.stem])
            cols["duration"].append(float(t[r["end"]] - t[r["start"]] + 1 / SAMPLE_FPS)); cols["clip"].append(f.stem)
    out = {k: np.array(v) for k, v in cols.items()}
    np.savez_compressed(REPS_FILE, **out)
    print(f"saved {REPS_FILE}: {len(out['y'])} repetitions ({int((out['y'] == 0).sum())} from correct clips, "
          f"{int(out['y'].sum())} from incorrect clips), {len(set(out['group']))} set-ups")
    return out


def models():
    """What the trained models say about real sit-to-stand repetitions filmed at home.

    The app scores sit-to-stand with the SQUAT model as a stand-in (web/src/lib/pose/loader.ts). ml/models/sit_to_stand.json
    is the logistic model trained on motion capture (UI-PRMD). Neither has seen a camera sit-to-stand before.
    """
    import notebook_code
    from sklearn.metrics import roc_auc_score
    from train_squat import predict_from_dict
    d = cut_reps()
    ns = notebook_code.load()
    names, sig = ns["signals"](d["lm"].astype(np.float32), 6)
    X = ns["summarise"](sig, d["duration"].astype(np.float32))
    feats = [f"{n}:{st}" for n in names for st in ns["STATS"]] + ["duration"]
    y = d["y"]
    out = {"reps": int(len(y)), "from_correct_clips": int((y == 0).sum()), "from_incorrect_clips": int(y.sum())}
    for name in ("squat", "sit_to_stand"):
        spec = json.loads((HERE / "models" / f"{name}.json").read_text())
        assert spec["features"] == feats, f"{name}: features differ"
        p = np.array([predict_from_dict(spec, x) for x in X])
        thr = spec.get("flag_threshold", 0.5)
        row = {"flag_threshold": thr, "auc": float(roc_auc_score(y, p)),
               "median_p_mistake_correct": float(np.median(p[y == 0])), "median_p_mistake_incorrect": float(np.median(p[y == 1])),
               "correct_flagged": float((p[y == 0] >= thr).mean()), "incorrect_flagged": float((p[y == 1] >= thr).mean()),
               "median_quality_shown_correct": float(np.median(100 * (1 - p[y == 0])))}
        out[name] = row
        print(f"{name:13s} model: AUC {row['auc']:.2f}; p(mistake) median {row['median_p_mistake_correct']:.2f} on correct reps, "
              f"{row['median_p_mistake_incorrect']:.2f} on incorrect; flagged at {thr:.2f}: {row['correct_flagged']:.0%} of correct, "
              f"{row['incorrect_flagged']:.0%} of incorrect; quality shown for a correct rep: {row['median_quality_shown_correct']:.0f} out of 100")
    # The motion-capture model again, put on the camera's own scale (calibrate_camera.py), using only the OTHER set-ups.
    spec = json.loads((HERE / "models" / "sit_to_stand.json").read_text())
    p = np.zeros(len(y))
    for setup in sorted(set(d["group"])):
        test = d["group"] == setup
        cal = dict(spec, mean=X[~test].mean(0).tolist(), scale=(X[~test].std(0) + 1e-6).tolist())
        p[test] = [predict_from_dict(cal, x) for x in X[test]]
    out["sit_to_stand_calibrated_held_out"] = {"auc": float(roc_auc_score(y, p)), "correct_flagged": float((p[y == 0] >= 0.5).mean()),
                                               "incorrect_flagged": float((p[y == 1] >= 0.5).mean())}
    print(f"sit_to_stand  model on the camera's scale (other set-ups only): AUC {out['sit_to_stand_calibrated_held_out']['auc']:.2f}; "
          f"flagged at 0.50: {(p[y == 0] >= 0.5).mean():.0%} of correct, {(p[y == 1] >= 0.5).mean():.0%} of incorrect")
    (HERE / "final_round_out" / "wlu_models.json").write_text(json.dumps(out, indent=1))


# ---------------------------------------------------------------- chart

def chart():
    """docs/img/sit_to_stand_camera.png: where a standing knee really measures, and the rules before and after."""
    import csv
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    main_c, second, highlight, mistake, ink, muted, grid = "#2a3da3", "#3f8cf2", "#ffb020", "#a8201a", "#1a1a1a", "#555555", "#e3e3e3"
    plt.rcParams.update({"font.size": 12, "font.family": "DejaVu Sans", "text.color": ink, "axes.labelcolor": ink,
                         "axes.edgecolor": muted, "xtick.color": ink, "ytick.color": ink, "axes.titlesize": 13,
                         "axes.titleweight": "bold", "axes.spines.top": False, "axes.spines.right": False,
                         "figure.facecolor": "white", "axes.facecolor": "white", "savefig.facecolor": "white",
                         "legend.frameon": False, "legend.fontsize": 11})
    res = json.loads((HERE / "final_round_out" / "wlu_rules.json").read_text())
    rows = list(csv.DictReader(open(HERE / "final_round_out" / "wlu_measures.csv")))
    stand = np.array([float(r["stand_deg"]) for r in rows if r["label"] == "good" and r["cycle"] not in ("", "not tracked")])
    fig, (a, b) = plt.subplots(1, 2, figsize=(8, 4.4), constrained_layout=True, gridspec_kw={"width_ratios": [1, 1.15]})
    a.hist(stand, bins=np.arange(140, 181, 2.5), color=second, edgecolor="white")
    a.axvline(155, color=mistake, lw=2); a.axvline(145, color=main_c, lw=2)
    top = a.get_ylim()[1]
    a.text(155.6, top * 0.97, "old line 155:\n47% of correct\nclips below it", color=mistake, fontsize=10, va="top")
    a.text(144.4, top * 0.60, "new line 145:\n1% below", color=main_c, fontsize=10, va="top", ha="right")
    a.set_xlim(124, 181)
    a.set_title("Knee angle while standing,\n79 correct home clips", fontsize=12)
    a.set_xlabel("degrees (a straight leg would be 180)"); a.set_ylabel("clips")
    a.grid(axis="y", color=grid, linewidth=0.8); a.set_axisbelow(True)
    names = ["Agrees with\nthe labels", "Correct clips\naccepted", "Incorrect clips\ncaught"]
    keys = ["accuracy", "correct_accepted", "incorrect_caught"]
    x = np.arange(3)
    for off, (key, label, colour) in zip((-0.2, 0.2), (("rules_before", "Rules before", "#9aa3b5"), ("rules_now", "Rules now", main_c))):
        bars = b.bar(x + off, [res[key][k] for k in keys], 0.38, color=colour, label=label)
        for bar in bars:
            b.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.015, f"{bar.get_height():.0%}", ha="center", fontsize=10)
    b.set_xticks(x); b.set_xticklabels(names, fontsize=10.5)
    b.set_ylim(0, 1.12); b.set_yticks(np.arange(0, 1.01, 0.2)); b.set_yticklabels([f"{v:.0%}" for v in np.arange(0, 1.01, 0.2)])
    b.grid(axis="y", color=grid, linewidth=0.8); b.set_axisbelow(True)
    b.set_title("The app's sit-to-stand rules on\n127 home clips, 6 rooms", fontsize=12)
    b.legend(loc="upper left", ncol=2, bbox_to_anchor=(0, 1.0))
    out = HERE.parent / "docs" / "img" / "sit_to_stand_camera.png"
    fig.savefig(out, dpi=200); plt.close(fig)
    print("wrote", out)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("step", choices=["track", "describe", "group", "rules", "models", "chart"])
    ap.add_argument("--threshold", type=float, default=260.0, help="group: how different two rooms must look")
    ap.add_argument("--max-minutes", type=float, default=0)
    args = ap.parse_args()
    if args.step == "track":
        track(args.max_minutes)
    elif args.step == "describe":
        describe()
    elif args.step == "group":
        group(args.threshold)
    elif args.step == "rules":
        rules()
    elif args.step == "models":
        models()
    elif args.step == "chart":
        chart()


if __name__ == "__main__":
    main()
