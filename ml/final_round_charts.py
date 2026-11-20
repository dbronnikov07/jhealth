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


MD, R26, R24 = "phone (Mendeley, gym)", "phone (REHAB26)", "fixed camera (REHAB24-6)"


def load_opt(name):
    return load(name) if (OUT / name).exists() else None


def squat_final(res, final):
    """The squat numbers of the model that is in the app: (REHAB26 phone, REHAB24-6 fixed camera, Mendeley or None, note)."""
    me = load_opt("mendeley_eval.json")
    own = res["squat"][final["squat"]]
    if me is None:
        return own[PHONE], own[FIXED], None, ""
    if final.get("squat_model") == "combined":
        g = me[f"3c_combined | {final['combined_config']}"]["groups"]
        return g[R26], g[R24], g[MD], "trained on all three datasets, each person hidden in turn"
    return own[PHONE], own[FIXED], me["3b_transfer"]["groups"][MD], "Mendeley: the model was never trained on it"


def f1_by_device(res, final, lab):
    fig, ax = plt.subplots(figsize=(8, 4.8), constrained_layout=True)
    x = np.arange(3)
    sq_phone, sq_fixed, sq_md, note = squat_final(res, final)
    arm = res["arm_raise"][final["arm_raise"]]
    series = [("Phone (REHAB26 iPhones, 5 people)", MAIN, [sq_phone["macro_f1"], arm[PHONE]["macro_f1"], 0]),
              ("Fixed camera, webcam-like (REHAB24-6, 9 people)", SECOND, [sq_fixed["macro_f1"], arm[FIXED]["macro_f1"], 0])]
    if sq_md is not None:
        series.append((f"Phone in a gym (Mendeley, {sq_md['people']} people; squat only)", HIGHLIGHT, [sq_md["macro_f1"], 0, 0]))
    wdt = 0.8 / len(series)
    for i, (name, col, vals) in enumerate(series):
        bars = ax.bar(x + (i - (len(series) - 1) / 2) * wdt, vals, wdt * 0.92, color=col, label=name)
        label_bars(ax, bars, size=10.5)
    s = lab["UI-PRMD sit-to-stand"]
    ax.text(2, 0.40, "Camera check: rules agree\nwith labels on 87% of\n127 home clips (see\nSIT_TO_STAND_CAMERA.md)\n\nNo camera-trained model:\n"
            f"{s['logistic C=0.1']['macro_f1']:.3f} is motion capture\nonly (UI-PRMD, {s['people']} people)", ha="center", va="center", fontsize=10, color=MUTED)
    ax.set_xticks(x, ["Chair squat" + (f"\n({note})" if note else ""), "Arm raise to the side", "Sit-to-stand"], fontsize=10.5)
    yaxis(ax)
    ax.set_ylim(0, 1.2)
    ax.legend(loc="upper left", ncol=1, fontsize=10)
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
    big = load_opt("curve_squat_mendeley.json")
    fig, axes = plt.subplots(1, 2, figsize=(8, 4.5), sharey=True, constrained_layout=True)
    for ax, ex in zip(axes, ("squat", "arm_raise")):
        c = big if (ex == "squat" and big) else load(f"curve_{ex}.json")
        ks = sorted(int(k) for k in c["points"])
        lines = (((R26, MAIN, "Phone (REHAB26)"), (R24, SECOND, "Fixed camera (REHAB24-6)"), (MD, HIGHLIGHT, "Phone in a gym (Mendeley)")) if c is big
                 else ((PHONE, MAIN, "Phone (REHAB26)"), (FIXED, SECOND, "Fixed camera (REHAB24-6)")))
        for grp, col, name in lines:
            mean = np.array([np.mean([r[grp] for r in c["points"][str(k)]]) for k in ks])
            sd = np.array([np.std([r[grp] for r in c["points"][str(k)]]) for k in ks])
            ax.fill_between(ks, mean - sd, mean + sd, color=col, alpha=0.18, linewidth=0)
            ax.plot(ks, mean, color=col, linewidth=2, marker="o", markersize=6, label=name)
        ax.set_xticks(ks)
        ax.set_xlabel("People in training (number)")
        people = ks[-1] + 1
        ax.set_title(f"{TITLE[ex]} ({people} people in all)", fontsize=11.5)
        yaxis(ax, "Macro F1 on held-out people" if ax is axes[0] else "")
        ax.set_ylim(0.3, 1.0)
        ax.set_yticks(np.arange(0.3, 1.01, 0.1))
    axes[0].legend(loc="lower right", fontsize=9.5)
    fig.suptitle("Score on unseen people vs people in training (band: random draws)", fontsize=12.5, fontweight="bold")
    save(fig, "learning_curve.png")


def data_overview(res, extras, final):
    """How many people and labelled repetitions each dataset gives, per exercise. Camera and lab in different colours."""
    B = final["baseline"]
    lab = extras["lab"]
    mr = load_opt("mendeley_reps.json")
    rows = [("Chair squat", "REHAB24-6 (2 fixed cameras)", res["squat"][B][FIXED]["people"], res["squat"][B][FIXED]["reps"], "camera"),
            ("Chair squat", "REHAB26 (3 iPhones)", res["squat"][B][PHONE]["people"], res["squat"][B][PHONE]["reps"], "camera")]
    if mr:
        rows.append(("Chair squat", "Mendeley (phones in a gym)", mr["people_with_reps"], mr["reps"], "camera"))
    rows += [("Chair squat", "UI-PRMD (motion capture)", lab["UI-PRMD deep squat"]["people"], lab["UI-PRMD deep squat"]["logistic C=0.1"]["reps"], "lab"),
             ("Arm raise", "REHAB24-6 (2 fixed cameras)", res["arm_raise"][B][FIXED]["people"], res["arm_raise"][B][FIXED]["reps"], "camera"),
             ("Arm raise", "REHAB26 (3 iPhones)", res["arm_raise"][B][PHONE]["people"], res["arm_raise"][B][PHONE]["reps"], "camera"),
             ("Arm raise", "UI-PRMD (motion capture)", lab["UI-PRMD shoulder abduction"]["people"], lab["UI-PRMD shoulder abduction"]["logistic C=0.1"]["reps"], "lab"),
             ("Arm raise", "IntelliRehabDS (Kinect, patients)", lab["IRDS abduction (patients)"]["people"], lab["IRDS abduction (patients)"]["logistic C=0.1"]["reps"], "lab"),
             ("Sit-to-stand", "WLU home video (test only)", 6, 127, "camera"),
             ("Sit-to-stand", "UI-PRMD (motion capture)", lab["UI-PRMD sit-to-stand"]["people"], lab["UI-PRMD sit-to-stand"]["logistic C=0.1"]["reps"], "lab")]
    y, pos, last = [], 0.0, None
    for r in rows:
        pos += 1.0 if r[0] == last or last is None else 1.9
        y.append(pos)
        last = r[0]
    y = np.array(y)
    col = [MAIN if r[4] == "camera" else HIGHLIGHT for r in rows]
    fig, axes = plt.subplots(1, 2, figsize=(8, 5.7), sharey=True, constrained_layout=True)
    for ax, j, title, unit in ((axes[0], 2, "People", "People (count)"), (axes[1], 3, "Labelled repetitions", "Repetitions (count, every view)")):
        vals = [r[j] for r in rows]
        bars = ax.barh(y, vals, 0.72, color=col)
        for b, v, r in zip(bars, vals, rows):
            unit_ = (" set-ups (people not named)" if j == 2 else " clips (one label per clip)") if r[1].startswith("WLU") else ""
            ax.text(b.get_width() + max(vals) * 0.015, b.get_y() + b.get_height() / 2, f"{v:,}{unit_}", va="center", fontsize=10 if not unit_ else 8.5)
        ax.set_xlim(0, max(vals) * 1.17)
        ax.set_xlabel(unit, fontsize=10.5)
        ax.set_title(title, fontsize=12)
        ax.grid(axis="x", color=GRID, linewidth=0.8)
        ax.set_axisbelow(True)
        ax.tick_params(axis="y", length=0)
    axes[0].set_yticks(y, [r[1] for r in rows], fontsize=9.5)
    axes[0].invert_yaxis()
    for name in dict.fromkeys(r[0] for r in rows):
        first = min(yy for yy, r in zip(y, rows) if r[0] == name)
        axes[0].text(0, first - 0.72, name, fontsize=11, fontweight="bold", va="bottom", ha="left")
    axes[0].set_ylim(y[-1] + 1.4, y[0] - 1.5)
    from matplotlib.patches import Patch
    fig.legend(handles=[Patch(color=MAIN, label="Camera (what the app sees)"), Patch(color=HIGHLIGHT, label="Lab (motion capture / Kinect)")], loc="outside lower center", ncol=2, fontsize=10.5)
    fig.suptitle("Labelled data behind each exercise", fontsize=13, fontweight="bold")
    save(fig, "data_overview.png")


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
    data_overview(res, extras, final)


if __name__ == "__main__":
    main()
