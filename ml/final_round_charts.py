"""Charts for docs/ML_RESULTS.md from the numbers final_round.py measured (final_round_out/*.json).

    OMP_NUM_THREADS=2 nice -n 10 ~/jhealth-cache/venv/bin/python final_round_charts.py

Every chart is 1600 px wide (8 in at 200 dpi), white background. Nothing is computed here except sums for display.
"""
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402

HERE = Path(__file__).resolve().parent
OUT = HERE / "final_round_out"
IMG = HERE.parent / "docs" / "img"
MAIN, SECOND, HIGHLIGHT, MISTAKE = "#2a3da3", "#3f8cf2", "#ffb020", "#a8201a"
INK, MUTED, GRID = "#1a1a1a", "#555555", "#e3e3e3"
FIXED, PHONE, ALL = "fixed camera (webcam-like)", "phone", "all camera"
TITLE = {"squat": "Chair squat", "arm_raise": "Arm raise to the side"}
plt.rcParams.update({"font.size": 12, "font.family": "DejaVu Sans", "text.color": INK, "axes.labelcolor": INK,
                     "axes.edgecolor": MUTED, "xtick.color": INK, "ytick.color": INK, "axes.titlesize": 13,
                     "axes.titleweight": "bold", "axes.spines.top": False, "axes.spines.right": False,
                     "figure.facecolor": "white", "axes.facecolor": "white", "savefig.facecolor": "white",
                     "legend.frameon": False, "legend.fontsize": 11})


def load(name):
    return json.loads((OUT / name).read_text())


def save(fig, name):
    IMG.mkdir(parents=True, exist_ok=True)
    fig.savefig(IMG / name, dpi=200)
    plt.close(fig)
    print("wrote", IMG / name)


def yaxis(ax, label="Macro F1 (0 = worst, 1 = perfect)"):
    ax.set_ylim(0, 1)
    ax.set_yticks(np.arange(0, 1.01, 0.2))
    ax.set_ylabel(label)
    ax.grid(axis="y", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def label_bars(ax, bars, fmt="{:.3f}", size=10):
    for b in bars:
        if b.get_height() > 0:
            ax.text(b.get_x() + b.get_width() / 2, b.get_height() + 0.012, fmt.format(b.get_height()), ha="center", va="bottom", fontsize=size)


def model_comparison(res):
    fams = [("logistic C=nested | balanced", "Logistic\nregression"), ("forest | balanced", "Random\nforest"),
            ("boosting | balanced", "Gradient\nboosting"), ("ensemble | balanced", "Soft-vote\nensemble\n(before)"),
            ("ensemble | balanced + devices weighted equally", "Final:\nensemble,\ndevices\nequal")]
    fig, axes = plt.subplots(1, 2, figsize=(8, 4.7), sharey=True, constrained_layout=True)
    for ax, (grp, name) in zip(axes, ((PHONE, "Phone (REHAB26, 5 people)"), (FIXED, "Fixed camera (REHAB24-6, 9 people)"))):
        x = np.arange(len(fams))
        for i, (ex, col) in enumerate((("squat", MAIN), ("arm_raise", SECOND))):
            vals = [res[ex][k][grp]["macro_f1"] for k, _ in fams]
            bars = ax.bar(x + (i - 0.5) * 0.4, vals, 0.36, color=col, label=TITLE[ex])
            label_bars(ax, bars, size=7.5)
            floor = res[ex][fams[0][0]][grp]["floor_always_correct"]
            ax.axhline(floor, color=MISTAKE, linewidth=1.4, linestyle=(0, (4, 2)) if i == 0 else (0, (1, 1.5)),
                       label=f'Always say "correct": {TITLE[ex].lower()} {floor:.3f}')
        ax.set_xticks(x, [n for _, n in fams], fontsize=8)
        ax.set_title(name, fontsize=11.5)
        yaxis(ax, "Macro F1 (0 = worst, 1 = perfect)" if ax is axes[0] else "")
        ax.legend(loc="upper center", fontsize=8.5, ncol=1, bbox_to_anchor=(0.5, 1.0))
        ax.set_ylim(0, 1.18)
    fig.suptitle("Macro F1 by model family, tested on people never seen in training", fontsize=13, fontweight="bold")
    save(fig, "model_comparison.png")


def f1_by_device(res, final, lab):
    fig, ax = plt.subplots(figsize=(8, 4.6), constrained_layout=True)
    x = np.arange(3)
    for i, (grp, col, name) in enumerate(((PHONE, MAIN, "Phone (REHAB26 iPhones, 5 people)"), (FIXED, SECOND, "Fixed camera, webcam-like (REHAB24-6, 9 people)"))):
        vals = [res[ex][final[ex]][grp]["macro_f1"] for ex in ("squat", "arm_raise")] + [0]
        bars = ax.bar(x + (i - 0.5) * 0.36, vals, 0.32, color=col, label=name)
        label_bars(ax, bars, size=11)
    s = lab["UI-PRMD sit-to-stand"]
    ax.text(2, 0.42, f"No labelled camera\ndata exists.\n\nMotion capture only\n(UI-PRMD, {s['people']} people,\n{s['logistic C=0.1']['reps']} reps):\n0.904 on 18 Nov, "
            f"{s['logistic C=0.1']['macro_f1']:.3f} re-measured", ha="center", va="center", fontsize=10.5, color=MUTED)
    ax.set_xticks(x, ["Chair squat", "Arm raise to the side", "Sit-to-stand"])
    yaxis(ax)
    ax.set_ylim(0, 1.12)
    ax.legend(loc="upper left", ncol=1)
    ax.set_title("Final models: macro F1 on unseen people, by filming device")
    save(fig, "f1_by_device.png")


def confusion(ex, cm, people):
    cm = np.array(cm)
    pct = cm / cm.sum(1, keepdims=True)
    fig, ax = plt.subplots(figsize=(8, 5.6), constrained_layout=True)
    cmap = matplotlib.colors.LinearSegmentedColormap.from_list("one_hue", ["#eef1fb", MAIN])
    ax.imshow(pct, cmap=cmap, vmin=0, vmax=1)
    for i in range(2):
        for j in range(2):
            ax.text(j, i, f"{cm[i, j]:,}\n{pct[i, j]:.1%} of the row", ha="center", va="center", fontsize=17,
                    color="white" if pct[i, j] > 0.55 else INK, fontweight="bold" if i == j else "normal")
    ax.set_xticks([0, 1], ['Model said "correct"', 'Model said "mistake"'], fontsize=13)
    ax.set_yticks([0, 1], ["Person did it\ncorrectly", "Person made\na mistake"], fontsize=13)
    ax.xaxis.tick_top()
    ax.tick_params(length=0)
    for s in ax.spines.values():
        s.set_visible(False)
    ax.set_xlabel(f"Repetitions (count) of {people} people, each tested by a model that never saw them; cut-off 0.5", fontsize=10.5, color=MUTED)
    ax.set_title(f"{TITLE[ex]}: what the model said about {cm.sum():,} held-out repetitions", pad=14)
    save(fig, f"confusion_{ex}.png")


def learning_curve():
    fig, axes = plt.subplots(1, 2, figsize=(8, 4.4), sharey=True, constrained_layout=True)
    for ax, ex in zip(axes, ("squat", "arm_raise")):
        c = load(f"curve_{ex}.json")
        ks = sorted(int(k) for k in c["points"])
        for grp, col, name in ((PHONE, MAIN, "Phone"), (FIXED, SECOND, "Fixed camera"), (ALL, HIGHLIGHT, "All reps pooled")):
            mean = np.array([np.mean([r[grp] for r in c["points"][str(k)]]) for k in ks])
            sd = np.array([np.std([r[grp] for r in c["points"][str(k)]]) for k in ks])
            ax.fill_between(ks, mean - sd, mean + sd, color=col, alpha=0.18, linewidth=0)
            ax.plot(ks, mean, color=col, linewidth=2, marker="o", markersize=6, label=name)
        ax.set_xticks(ks)
        ax.set_xlabel("People in training (number)")
        ax.set_title(TITLE[ex], fontsize=12)
        yaxis(ax, "Macro F1 on held-out people" if ax is axes[0] else "")
        ax.set_ylim(0.3, 1.0)
        ax.set_yticks(np.arange(0.3, 1.01, 0.1))
    axes[0].legend(loc="upper left")
    fig.suptitle(f"Score on unseen people vs people in training (band: {c['repeats']} random draws)", fontsize=12.5, fontweight="bold")
    save(fig, "learning_curve.png")


def mistakes_detected(extras, final):
    rows = []
    for ex in ("squat", "arm_raise"):
        det, same = extras[ex]["per_mistake_detector"], extras[ex][final[ex]]["per_mistake_same_model"]
        for name in sorted(det, key=lambda n: -det[n]["macro_f1"]):
            nice = name.replace("ERR_", "").replace("_", " ").lower()
            rows.append((f"{'Squat' if ex == 'squat' else 'Arm raise'}: {nice}" + ("\n(the app names it)" if det[name]["coachable"] else ""),
                         det[name]["macro_f1"], same[name]["macro_f1"], det[name]["floor_always_correct"]))
    fig, ax = plt.subplots(figsize=(8, 6.4), constrained_layout=True)
    y = np.arange(len(rows))[::-1]
    b1 = ax.barh(y + 0.2, [r[1] for r in rows], 0.36, color=MAIN, label="Detector trained for this one mistake (logistic)")
    b2 = ax.barh(y - 0.2, [r[2] for r in rows], 0.36, color=SECOND, label="The app's correct / mistake model")
    for bars in (b1, b2):
        for b in bars:
            ax.text(b.get_width() + 0.01, b.get_y() + b.get_height() / 2, f"{b.get_width():.3f}", va="center", fontsize=9.5)
    floor = float(np.mean([r[3] for r in rows]))
    ax.axvline(floor, color=MISTAKE, linewidth=1.4, linestyle=(0, (4, 2)), label=f'Always say "correct" ({floor:.3f})')
    ax.set_yticks(y, [r[0] for r in rows], fontsize=10)
    ax.set_xlim(0, 1.08)
    ax.set_xlabel("Macro F1, correct reps vs this one mistake (0 to 1)")
    ax.grid(axis="x", color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)
    ax.legend(loc="upper center", bbox_to_anchor=(0.35, -0.11), ncol=1, fontsize=10)
    fig.suptitle("Each named mistake: phone footage, 5 unseen people (REHAB26)", fontsize=13, fontweight="bold")
    save(fig, "mistakes_detected.png")


def augmentation(res):
    cfgs = [("ensemble | balanced", MAIN, "No augmentation"), ("ensemble | balanced | aug mirror+yaw", SECOND, "Mirror + yaw turns"),
            ("ensemble | balanced | aug camera tilt+depth+offset", HIGHLIGHT, "Camera tilt + depth + offset")]
    if any(k not in res[ex] for ex in ("squat", "arm_raise") for k, _, _ in cfgs):
        print("augmentation results missing: augmentation.png not drawn")
        return
    groups = [("squat", PHONE, "Squat\nphone"), ("squat", FIXED, "Squat\nfixed camera"), ("arm_raise", PHONE, "Arm raise\nphone"), ("arm_raise", FIXED, "Arm raise\nfixed camera")]
    fig, ax = plt.subplots(figsize=(8, 4.6), constrained_layout=True)
    x = np.arange(len(groups))
    for i, (k, col, name) in enumerate(cfgs):
        bars = ax.bar(x + (i - 1) * 0.27, [res[ex][k][g]["macro_f1"] for ex, g, _ in groups], 0.25, color=col, label=name)
        label_bars(ax, bars, size=8.5)
    ax.set_xticks(x, [g[2] for g in groups])
    yaxis(ax)
    ax.set_ylim(0, 1.12)
    ax.legend(loc="upper center", ncol=3, fontsize=10)
    ax.set_title("Augmenting body points in training: before and after")
    save(fig, "augmentation.png")


def main():
    res = {ex: load(f"results_{ex}.json") for ex in ("squat", "arm_raise")}
    extras, final = load("extras.json"), load("final.json")
    model_comparison(res)
    f1_by_device(res, final, extras["lab"])
    for ex in ("squat", "arm_raise"):
        confusion(ex, extras[ex][final[ex]]["confusion_at_0.5"], res[ex][final[ex]][ALL]["people"])
    if (OUT / "curve_squat.json").exists() and (OUT / "curve_arm_raise.json").exists():
        learning_curve()
    mistakes_detected(extras, final)
    augmentation(res)


if __name__ == "__main__":
    main()
