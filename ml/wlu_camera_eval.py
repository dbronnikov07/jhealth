"""Evaluate the Kaggle WLU camera sit-to-stand clips without polluting the app score.

WLU Rehabilitation Posture (Kaggle, MIT licence) provides 79 ``Correct`` and
48 ``Incorrect`` ordinary-camera sit-to-stand *clips*.  It does not publish
participant IDs or repetition boundaries.  This evaluator therefore makes no
claim about person-held-out, per-repetition performance.  It treats every
usable clip as one provisional example and holds out visual recording setups
(rooms/camera positions) inferred by ``wlu_sit_to_stand.py group``.

It is deliberately a fixed baseline: the current feature set and the same
three-model vote used for the camera exercises.  It is not a model-selection
loop and it never exports a model to the browser.

Run after all WLU clips were tracked and grouped:
  P=~/jhealth-cache/venv/bin/python
  OMP_NUM_THREADS=2 nice -n 10 $P -I wlu_camera_eval.py
"""
import json
import sys
from pathlib import Path

import numpy as np
from sklearn.model_selection import GroupKFold

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import final_round as fr  # noqa: E402
import notebook_code  # noqa: E402
from build_dataset import fill_gaps, resample  # noqa: E402
from extract_clips import clear_joint_frames  # noqa: E402
from train_squat import predict_from_dict  # noqa: E402

CACHE = Path.home() / "jhealth-cache"
LANDMARKS = CACHE / "landmarks_wlu"
OUT = HERE / "final_round_out"
GROUPS = OUT / "wlu_groups.json"
APP_MODEL = HERE / "models" / "sit_to_stand.json"


def load():
    """Return one fixed-length body-point sequence per usable labelled clip."""
    if not GROUPS.exists():
        raise SystemExit(f"Missing {GROUPS}. Run `python -I wlu_sit_to_stand.py group` first.")
    groups = json.loads(GROUPS.read_text())
    rows = []
    for path in sorted(LANDMARKS.glob("*.npz")):
        d = np.load(path)
        label = str(d["label"])
        if label not in ("good", "bad") or path.stem not in groups:
            continue
        world, vis = d["world"].astype(np.float64), d["vis"]
        found = ~np.isnan(world[:, 0, 0]) if len(world) else np.zeros(0, bool)
        if len(world) < 12 or found.mean() < 0.60:
            continue
        times = d["times"].astype(float)
        dt = float(np.median(np.diff(times))) if len(times) > 1 else 1 / 15
        rows.append({
            "clip": path.stem,
            "group": groups[path.stem],
            "y": int(label == "bad"),
            "lm": resample(fill_gaps(world.copy()), 64).astype(np.float32),
            "duration": float(times[-1] - times[0] + dt),
            "found": float(found.mean()),
            "app_camera_gate": bool(clear_joint_frames(found, vis, "sit_to_stand").mean() >= 0.75),
        })
    if not rows:
        raise SystemExit("No usable WLU clips were found.")
    return rows


def group_stats(rows):
    stats = {}
    for r in rows:
        g = stats.setdefault(r["group"], {"clips": 0, "good": 0, "bad": 0})
        g["clips"] += 1
        g["bad" if r["y"] else "good"] += 1
    return stats


def setup_held_out_vote(X, y, groups):
    """A fixed baseline; each full visual setup is unseen by the vote."""
    n_splits = min(5, len(set(groups)))
    if n_splits < 2:
        raise SystemExit("Need at least two inferred recording setups for a held-setup test.")
    prob = np.full(len(y), np.nan)
    for tr, te in GroupKFold(n_splits=n_splits).split(X, y, groups):
        if len(set(y[tr])) < 2:
            raise SystemExit("A training fold has only one label; WLU cannot be evaluated honestly this way.")
        members = [fr.lr(0.1), fr.rf(), fr.hgb()]
        prob[te] = np.mean([m.fit(X[tr], y[tr]).predict_proba(X[te])[:, 1] for m in members], axis=0)
    return prob


def main():
    rows = load()
    ns = notebook_code.load()
    lm = np.stack([r["lm"] for r in rows])
    dur = np.array([r["duration"] for r in rows], dtype=np.float32)
    y = np.array([r["y"] for r in rows])
    groups = np.array([r["group"] for r in rows])
    X = fr.feats_of(ns, "sit_to_stand", lm, dur)

    # This source turned out to be one visual setup.  Without at least two
    # setups (and without author-provided people), any train/test number would
    # let the model see the same environment in both sides of the split.  Save
    # an explicit rejection report instead of emitting an attractive but
    # meaningless F1 score.
    setups = group_stats(rows)
    if len(setups) < 2:
        report = {
            "source": "https://www.kaggle.com/datasets/sulaimanmuhammed/wlu-rehabilitation-posture",
            "licence": "MIT (as listed on Kaggle)",
            "exercise": "sit-to-stand",
            "clips": int(len(rows)),
            "bad_clips": int(y.sum()),
            "recording_setups": setups,
            "decision": "REJECTED FOR MODEL TRAINING: the inferred grouping found one visual setup, WLU publishes no participant IDs, and clip labels cannot support a setup-held-out or person-held-out F1. Do not train, export, or quote a score from this source.",
        }
        OUT.mkdir(exist_ok=True)
        (OUT / "wlu_camera_eval.json").write_text(json.dumps(report, indent=2))
        print(json.dumps(report, indent=2))
        return

    # This checks transfer of the existing Vicon-only model.  It is evaluated
    # exactly as the browser evaluates JSON; it is not used to tune anything.
    app = json.loads(APP_MODEL.read_text())
    if len(app["features"]) != X.shape[1]:
        raise SystemExit("Feature mismatch with sit_to_stand.json; do not compare the models.")
    p_transfer = np.array([predict_from_dict(app, row) for row in X])
    p_wlu = setup_held_out_vote(X, y, groups)
    gate = np.array([r["app_camera_gate"] for r in rows])

    def score(p, mask):
        if mask.sum() == 0 or len(set(y[mask])) < 2:
            return None
        return fr.metrics(y[mask], p[mask])

    report = {
        "source": "https://www.kaggle.com/datasets/sulaimanmuhammed/wlu-rehabilitation-posture",
        "licence": "MIT (as listed on Kaggle)",
        "exercise": "sit-to-stand",
        "unit": "one whole labelled clip, not a validated repetition",
        "split": "GroupKFold by inferred visual recording setup (room/camera position), not person ID; WLU does not publish participant IDs.",
        "clips": int(len(rows)),
        "bad_clips": int(y.sum()),
        "recording_setups": setups,
        "app_camera_gate_accepts": int(gate.sum()),
        "results": {
            "Vicon_only_model_zero_shot_on_WLU_camera": score(p_transfer, np.ones(len(y), bool)),
            "WLU_camera_only_fixed_ensemble_held_setup": score(p_wlu, np.ones(len(y), bool)),
            "WLU_camera_only_fixed_ensemble_held_setup_gate_accepted": score(p_wlu, gate),
        },
        "decision": "Do not claim this as the app's F1 and do not export a model from this run. It can become training data only after clip-to-repetition boundaries and person/setup grouping are manually audited.",
    }
    OUT.mkdir(exist_ok=True)
    (OUT / "wlu_camera_eval.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
