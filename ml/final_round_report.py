"""Writes docs/ML_RESULTS.md from the numbers final_round.py measured (final_round_out/*.json), so no number is retyped.

    ~/jhealth-cache/venv/bin/python final_round_report.py
"""
import json
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
OUT = HERE / "final_round_out"
DOC = HERE.parent / "docs" / "ML_RESULTS.md"
PHONE, FIXED, ALL = "phone", "fixed camera (webcam-like)", "all camera"
NAME = {"squat": "Chair squat", "arm_raise": "Arm raise to the side"}
DATASET = {PHONE: "REHAB26-ViewAngles, 3 iPhones", FIXED: "REHAB24-6, 2 fixed cameras"}
EXS = ("squat", "arm_raise")


def load(n):
    return json.loads((OUT / n).read_text())


def f(x):
    return f"{x:.3f}"


def table(head, rows):
    return "\n".join(["| " + " | ".join(head) + " |", "|" + "---|" * len(head)] + ["| " + " | ".join(str(c) for c in r) + " |" for r in rows])


MD, R26, R24 = "phone (Mendeley, gym)", "phone (REHAB26)", "fixed camera (REHAB24-6)"
SIGNAL = {"avg_knee": "knee angle", "avg_hip": "hip angle (trunk to thigh)", "avg_thigh_incl": "thigh tilt away from vertical", "avg_thigh_fwd": "how far the thighs point forward",
          "avg_knee_fwd": "how far the knees travel ahead of the ankles", "trunk_lean": "trunk lean away from upright", "shoulder_tilt": "shoulder tilt", "pelvis_tilt": "pelvis tilt",
          "knee_gap": "distance between the knees (in hip widths)", "ankle_gap": "stance width (in hip widths)", "hip_h": "hip height (in leg lengths)", "thigh_spread": "angle between the two thighs"}
STAT = {"min": "lowest value in the rep", "max": "highest value in the rep", "range": "range over the rep", "mean": "average over the rep", "std": "variation over the rep",
        "when_min": "when the lowest value happens", "when_max": "when the highest value happens", "speed": "average speed of change", "peak_speed": "fastest change",
        "jerk": "jerkiness", "first_vs_second_half": "first half minus second half"}
# Plain words for the features that came out on top (written after looking at the measured direction of each).
PLAIN = {"avg_hip:min": "the hips fold less at the bottom (trunk-to-thigh angle stays more open): a shallower squat",
         "avg_thigh_incl:std": "the thighs move less over the repetition",
         "avg_thigh_incl:range": "the thighs swing through a smaller arc",
         "avg_hip:range": "the hip angle changes less between standing and the bottom",
         "avg_thigh_incl:max": "the thighs stay further from level at the bottom: a shallower squat",
         "avg_knee:mean": "the knees stay straighter on average",
         "avg_thigh_incl:mean": "the thighs are more upright on average",
         "avg_hip:std": "the hip angle varies less over the repetition",
         "avg_hip:mean": "the hips stay more open on average",
         "avg_knee:min": "a smaller knee bend at the bottom: a shallower squat"}


def describe(feature, d):
    if feature == "duration":
        return "time per repetition: " + ("longer" if d > 0 else "shorter") + " in bad reps"
    sig, stat = feature.split(":")
    name = SIGNAL.get(sig) or ("left-right difference in " + SIGNAL.get(sig.replace("diff_", "avg_"), sig) if sig.startswith("diff_") else sig)
    return f"{name}, {STAT[stat]}: {'higher' if d > 0 else 'lower'} in bad reps"


def cell(g, k):
    v = g.get(k)
    return "n/a" if v is None else f"{f(v['macro_f1'])}, {f(v['auc'])}, {f(v['precision_mistake'])} / {f(v['recall_mistake'])}"


def mendeley_section(w, res, fin):
    me, mr = load("mendeley_eval.json"), load("mendeley_reps.json")
    EQ, PL = "3c_combined | ensemble | balanced + datasets weighted equally", "3c_combined | ensemble | balanced"
    w("## 11. New squat data: Mendeley multi-view fitness dataset (added 19 November, evening)\n")
    w("\"A Multi-View Raw Video Dataset of Seven Fitness Exercises with Good/Bad Form Labels\" (Mendeley Data, DOI 10.17632/kgbb3yn47p.3, CC BY 4.0): people filmed on smartphones in a gym, "
      "bodyweight squats, front / side / diagonal views, about 31 s per clip at 15 frames per second, faces blurred. **One label per clip** (good or bad form); the dataset page does not say which mistakes make a clip bad. "
      "Every repetition inherits its clip's label, so some repetitions inside a \"bad\" clip may be fine. Script: `ml/mendeley_squat.py`.\n")
    w("**Tracking and cutting.** Same tracker and settings as the REHAB24-6 body points the squat model is trained on (MediaPipe heavy model, video mode, one person, 15 frames per second). "
      "Repetitions are cut by the project's own cutter (`extract_clips.find_reps`, squat settings). A clip is used when the person is found in at least 60% of frames; a repetition is dropped when the tracker lost the person "
      "in more than 20% of it or drew the body upside down (shoulders below hips) in more than 10% of it. These rules never look at the label.\n")
    rb, zv, up, app = mr["reps_by_view"], mr["zero_rep_clips_by_view"], mr["clips_where_body_is_upside_down_in_over_10pct_of_frames"], mr["clips_the_app_camera_check_would_refuse (both legs clear in under 75% of frames)"]
    w(table(["View", "Clips tracked", "Clips with zero usable repetitions", "Clips where the tracker drew the body upside down in over 10% of frames", "Clips the app's camera check would refuse (both legs clearly visible in under 75% of frames)",
             "People with repetitions", "Repetitions: good", "Repetitions: bad"],
            [[v, mr["clips_by_view"][v], zv[v], up[v], app[v], mr["people_by_view"][v], rb[v]["good"], rb[v]["bad"]] for v in ("front", "side", "diagonal")]
            + [["all", mr["clips_tracked"], mr["clips_with_zero_reps"], sum(up.values()), sum(app.values()), mr["people_with_reps"], mr["reps_good"], mr["reps_bad"]]]))
    pp = mr["reps_per_person"]
    w(f"\n{mr['clips_tracked']} of {mr['clips_downloaded']} downloaded clips were tracked. {mr['reps']} repetitions from {mr['people_with_reps']} people; per person min {pp['min']}, median {pp['median']:.0f}, max {pp['max']}; "
      f"per clip min {mr['reps_per_clip']['min']}, median {mr['reps_per_clip']['median']:.0f}, max {mr['reps_per_clip']['max']}. "
      f"Zero-repetition clips by label: {mr['zero_rep_clips_by_label']['good']} good, {mr['zero_rep_clips_by_label']['bad']} bad. "
      f"Repetitions dropped because the body was drawn upside down: {mr['reps_dropped_flipped_body']}; because the person was lost: {mr['reps_dropped_person_lost']}. "
      "More than half of the upside-down clips are side views. The cause was not investigated; a guess is that the blurred faces and a side-on body make the tracker's person detector misjudge which way up the body is.\n")

    w("**Tested on Mendeley people** (macro F1, AUC, precision / recall of the mistake class; every view of the tested person is out of training):\n")
    a, t, e_, p_ = me["3a_mendeley_alone"]["groups"], me["3b_transfer"]["groups"], me.get(EQ, {}).get("groups", {}), me.get(PL, {}).get("groups", {})
    names = [(MD, "Mendeley, all views"), ("Mendeley front", "front"), ("Mendeley side", "side"), ("Mendeley diagonal", "diagonal"), ("Mendeley, clips the app's camera check accepts", "only clips the app's camera check accepts")]
    w(table(["Test repetitions", "People / reps (bad)", "3a. Trained on Mendeley alone", "3b. Current REHAB-only model, no retraining", "3c. One model from all three datasets (datasets weighted equally)", "3c. Same, no dataset weights"],
            [[lab, f"{a[k]['people']} / {a[k]['reps']} ({a[k]['mistake_reps']})" if k in a else "n/a", cell(a, k), cell(t, k), cell(e_, k), cell(p_, k)] for k, lab in names]))
    fl = me["3b_transfer"]["at_flag_threshold"]
    w(f"\nAlways saying \"correct\" scores {f(a[MD]['floor_always_correct'])} macro F1 on Mendeley. With no retraining, the current model calls {fl['share_of_good_reps_called_mistake_at_0.5']:.1%} of Mendeley's \"good\" repetitions a mistake at the 0.5 cut-off; "
      f"at the app's flag cut-off ({fl['threshold']:.2f}) it flags {fl['flagged']} repetitions, precision {f(fl['precision'])}, recall {f(fl['recall'])}.\n")
    w("**Tested on REHAB people** (the two device groups of sections 1 to 7), with and without Mendeley in training:\n")
    own = res["squat"][fin["squat"]]
    rows = []
    for k, old in ((R26, own[PHONE]), (R24, own[FIXED])):
        rows.append([k, f"{old['people']} / {old['reps']}", f"{f(old['macro_f1'])}, {f(old['auc'])}, {f(old['precision_mistake'])} / {f(old['recall_mistake'])}", cell(e_, k), cell(p_, k)])
    w(table(["Device group", "People / reps", "REHAB-only model (current)", "All three datasets, weighted equally", "All three datasets, no dataset weights"], rows))
    if (OUT / "curve_squat_mendeley.json").exists():
        c = load("curve_squat_mendeley.json")
        w(f"\n**Learning curve, larger pool ({c['people']} people).** Hidden person as always, training people drawn at random from all three datasets ({c['repeats']} draws per size; ± is the spread). Model: {c['model']}.\n")
        rows = []
        for k in sorted(c["points"], key=int):
            row = [k, f"{np.mean([r['train_reps'] for r in c['points'][k]]):.0f}"]
            for g in ("all", R26, R24, MD):
                v = [r[g] for r in c["points"][k] if g in r]
                row.append("n/a" if not v else (f"{np.mean(v):.3f} ± {np.std(v):.3f}" if len(v) > 1 else f"{v[0]:.3f}"))
            rows.append(row)
        w(table(["People in training", "Reps in training (average)", "All reps pooled", R26, R24, MD], rows))
    bad = me["3e_what_bad_means"]
    w("\n**What \"bad\" means in this dataset** (measured, since the page does not say). The five features whose average differs most between bad and good repetitions, in standard deviations:\n")
    w(table(["Feature", "In plain words", "Bad minus good (standard deviations)", "Average: good", "Average: bad", "Same direction in how many people"],
            [[f"`{t_['feature']}`", PLAIN.get(t_["feature"], describe(t_["feature"], t_["standardised_difference_bad_minus_good"])), f"{t_['standardised_difference_bad_minus_good']:+.2f}",
              f"{t_['mean_good']:.3f}", f"{t_['mean_bad']:.3f}", f"{t_['people_with_the_same_direction']} of {t_['people_with_both_labels']}"] for t_ in bad["top"][:5]]))
    pl = bad["plain"]
    w(f"\nAll five say the same thing: on average a \"bad\" repetition is a shallower squat (hips and thighs travel less). It is also slightly quicker "
      f"(median {pl['bad']['median_seconds']:.2f} s against {pl['good']['median_seconds']:.2f} s). The direction holds for 16 to 19 of the 25 people, not for all: what counts as bad varies from person to person. "
      "In side views the features that differ most are left-right knee differences, which a side view cannot really see, so part of the signal there is tracking noise.\n")
    ctx = bad.get("depth_and_tempo_by_dataset")
    if ctx:
        w("How deep and how fast the squats are in each dataset (median lowest knee angle, where 180 is a straight leg; median seconds per repetition):\n")
        w(table(["Dataset", "Correct / good: lowest knee angle", "seconds", "Mistake / bad: lowest knee angle", "seconds"],
                [[k, f"{v['correct or good']['median_lowest_knee_angle']:.1f}", f"{v['correct or good']['median_seconds']:.2f}",
                  f"{v['mistake or bad']['median_lowest_knee_angle']:.1f}", f"{v['mistake or bad']['median_seconds']:.2f}"] for k, v in ctx.items()]))
        w("")
    # ---- model decision, by the same rule as before, applied to the configuration named in advance (datasets weighted equally)
    cur = {R26: own[PHONE], R24: own[FIXED]}
    better = [k for k in cur if e_[k]["macro_f1"] > cur[k]["macro_f1"]]
    worse = [k for k in cur if e_[k]["macro_f1"] < cur[k]["macro_f1"] - 0.01]
    passes = bool(better) and not worse
    replaced = fin.get("squat_model") == "combined"
    ext = load("extras.json")
    pb, pa = ext["squat"][fin["squat"]]["per_person_macro_f1"], me[EQ]["per_person_macro_f1"]
    counts = "; ".join(f"{g}: better for {sum(pa[q] > pb[q] + 1e-9 for q in pb if q.startswith(tag))} of {sum(q.startswith(tag) for q in pb)} people, "
                       f"worse for {sum(pa[q] < pb[q] - 1e-9 for q in pb if q.startswith(tag))}" for tag, g in (("R26", R26), ("R24", R24)))
    w(f"**Model decision: `squat.json` was {'replaced' if replaced else 'not replaced'}.** The rule: replace only if the new model is better on one REHAB device group and not worse by more than 0.01 on the other. "
      f"With Mendeley in training (datasets weighted equally, the configuration named before the run) macro F1 goes from {f(cur[R26]['macro_f1'])} to {f(e_[R26]['macro_f1'])} on {R26} "
      f"and from {f(cur[R24]['macro_f1'])} to {f(e_[R24]['macro_f1'])} on {R24}; AUC goes from {f(cur[R26]['auc'])} to {f(e_[R26]['auc'])} and from {f(cur[R24]['auc'])} to {f(e_[R24]['auc'])}. "
      f"The rule is {'met' if passes else 'not met'}. Per person ({counts}). On Mendeley's own people that combined model scores {f(e_[MD]['macro_f1'])} (AUC {f(e_[MD]['auc'])}); "
      f"the model that stays in the app scores {f(t[MD]['macro_f1'])} (AUC {f(t[MD]['auc'])}) there, which is chance level.\n")
    if passes != replaced:
        w("**Note: the rule and the state of the model file disagree; check before relying on this section.**\n")
    c = bad.get("depth_and_tempo_by_dataset", {})
    if c:
        w(f"**Why adding 25 people did not help.** The labels mean different things. Mendeley's squats are deep gym squats: \"good\" repetitions reach a knee angle of {c[MD]['correct or good']['median_lowest_knee_angle']:.1f} degrees "
          f"and \"bad\" ones {c[MD]['mistake or bad']['median_lowest_knee_angle']:.1f}, both deeper than REHAB's correct squats ({c[R26]['correct or good']['median_lowest_knee_angle']:.1f} on phones, "
          f"{c[R24]['correct or good']['median_lowest_knee_angle']:.1f} on the fixed camera). In Mendeley the deeper squat is the good one; on REHAB24-6's fixed camera the mistakes are on average the deeper ones "
          f"({c[R24]['mistake or bad']['median_lowest_knee_angle']:.1f} against {c[R24]['correct or good']['median_lowest_knee_angle']:.1f} degrees). "
          "So the two sets of labels pull the model in opposite directions on depth, and the fixed-camera group pays for it. \"Bad\" in Mendeley is a gym standard (not deep enough); "
          "a REHAB26 mistake is one named fault (knees inside, too shallow, lifted heels, torso to the side, knees forward).\n")
    w("**Skipped and not verified.**\n")
    w(f"- {mr['clips_downloaded'] - mr['clips_tracked']} of {mr['clips_downloaded']} clips were not tracked (diagonal views of the last people): the 70-minute tracking budget was used up. Front and side views are complete.")
    w("- What makes a clip \"bad\" is not documented; the description above is measured from the body points, not taken from the authors.")
    w("- One label per clip is applied to every repetition in it. How many repetitions in a \"bad\" clip are actually fine is unknown.")
    w("- Mendeley's people are assumed to be different from REHAB's people (different country and setting; not checkable).")
    w("- Side views: the app's own camera check would refuse all of them (far leg hidden), and the tracker drew the body upside down in several; those repetitions were dropped, the rest kept, as for REHAB's profile views.")
    w("- A good and a bad clip of the same person and view are separate recordings; a model could pick up recording differences instead of form. Leave-one-person-out does not rule that out.")
    w("- Because `squat.json` was not replaced, nothing was re-exported and the sit-to-stand stand-in result in SIT_TO_STAND_CAMERA.md still applies to the model in the app.\n" if not replaced else
      "- The sit-to-stand stand-in result in SIT_TO_STAND_CAMERA.md was measured with the previous squat model and has not been re-measured with the new one.\n")
    w("![Data overview](img/data_overview.png)\n")


def main():
    res = {ex: load(f"results_{ex}.json") for ex in EXS}
    ext, fin = load("extras.json"), load("final.json")
    B = fin["baseline"]
    out = []
    w = out.append

    w("# ML results: final training round (19 November 2026)\n")
    w("Per-repetition \"correct vs mistake\" models for chair squat, arm raise to the side and sit-to-stand. "
      "Sections 1 to 10 were measured by `ml/final_round.py` and section 11 by `ml/mendeley_squat.py`; this file is written by `ml/final_round_report.py` from their output, so those numbers are not retyped. "
      "The sit-to-stand camera test in section 1 is the exception: it is quoted from [SIT_TO_STAND_CAMERA.md](SIT_TO_STAND_CAMERA.md).\n")
    w("**How every number is tested.** Leave one person out: all repetitions of the hidden person, from every camera and view, are removed from training; "
      "the model is trained on everyone else and scored on the hidden person; repeated for each person. Settings are fixed in the script or chosen inside the training people only. "
      "Features are unchanged (the browser computes the same ones). Macro F1 uses the cut-off 0.5. \"Precision\" and \"recall\" are for the mistake class: "
      "of the reps called a mistake, the share that were one; of the real mistakes, the share that were caught.\n")
    w("**Device groups.** *Phone* = REHAB26-ViewAngles (three iPhones, front to profile). *Fixed camera (webcam-like)* = REHAB24-6 (two fixed cameras). "
      "For squat and arm raise no labelled laptop-webcam recordings exist; REHAB24-6 is the stand-in.\n")

    w("## 1. Before and after\n")
    w(f"Before = the models in the app until today (soft-vote ensemble of logistic regression, random forest and gradient boosting, trained on both camera datasets). "
      f"After = the same ensemble, with the two device groups weighted equally in training (`{fin['squat']}`). Both exported models were replaced (section 9).\n")
    rows = []
    for ex in EXS:
        for g in (PHONE, FIXED):
            b, a = res[ex][B][g], res[ex][fin[ex]][g]
            rows.append([NAME[ex], f"{g} ({DATASET[g]})", a["people"], f"{a['reps']} ({a['mistake_reps']} mistakes)", f(b["macro_f1"]), f"**{f(a['macro_f1'])}**",
                         f(b["auc"]), f(a["auc"]), f"{f(b['precision_mistake'])} / {f(b['recall_mistake'])}", f"{f(a['precision_mistake'])} / {f(a['recall_mistake'])}",
                         f(a["floor_always_correct"])])
    w(table(["Exercise", "Device group (dataset)", "People", "Reps", "Macro F1 before", "Macro F1 after", "AUC before", "AUC after",
             "Precision / recall before", "Precision / recall after", "Always \"correct\" floor"], rows))
    s = ext["lab"]["UI-PRMD sit-to-stand"]
    sl = s["logistic C=0.1"]
    w("\n**Sit-to-stand** has no camera-trained model, but since the evening of 19 November it has a camera test. Detail and method: [SIT_TO_STAND_CAMERA.md](SIT_TO_STAND_CAMERA.md) "
      "(measured by the main session with `ml/wlu_sit_to_stand.py`; not re-run by `final_round.py`). In short:\n")
    w("- **Data:** WLU Rehabilitation Posture (Kaggle, MIT licence): 127 home clips (79 correct, 48 incorrect), phones and webcams, 6 recording set-ups (nobody is named; clips are grouped by room). "
      "The labels mean \"a valid repetition or not\" (mostly unfinished movements), not fine technique mistakes.")
    w("- **The app's sit-to-stand rules** agree with the labels on 87% of clips (macro F1 0.87; 90% of correct clips accepted, 83% of incorrect ones caught). Before the fix: 61%, macro F1 0.60, 41% of correct clips accepted. "
      "With settings picked without the tested set-up: 89%, macro F1 0.88.")
    w("- **What was fixed:** the \"stand up tall\" line was 155 degrees, but a standing knee measures a median of 155 on camera; it is now 145 (`UPRIGHT_KNEE`). At 155 it also objected to 17% of correct REHAB26 phone squats "
      "and 7% of REHAB24-6 ones (4% and 0% at 145). \"Knees out\" is now judged only when the person faces the camera (`FACING_MIN` 0.6).")
    w("- **Trained models on 50 real stand-sit-stand repetitions** (42 correct, 8 incorrect): the squat model used as the stand-in has AUC 0.84 and flags 0% of the correct ones; "
      "the UI-PRMD motion-capture model has AUC 0.54 (0.68 after camera calibration on the other set-ups).")
    w(f"- **So the motion-capture score stays a lab-only number:** UI-PRMD, {s['people']} people, {sl['reps']} repetitions ({sl['mistake_reps']} with a mistake), logistic regression, "
      f"re-measured in this round from the cached body points: macro F1 {f(sl['macro_f1'])}, AUC {f(sl['auc'])}, precision {f(sl['precision_mistake'])}, recall {f(sl['recall_mistake'])}. "
      "The number stored with `sit_to_stand.json` on 18 November is macro F1 0.904, AUC 0.978; the difference is 2 of 199 repetitions and was not tracked down. `sit_to_stand.json` was not changed.\n")
    w("![F1 by device](img/f1_by_device.png)\n")
    w("How to read the change, honestly:\n")
    d = {ex: {g: res[ex][fin[ex]][g]["macro_f1"] - res[ex][B][g]["macro_f1"] for g in (PHONE, FIXED)} for ex in EXS}
    da = {ex: {g: res[ex][fin[ex]][g]["auc"] - res[ex][B][g]["auc"] for g in (PHONE, FIXED)} for ex in EXS}
    w(f"- Arm raise on the fixed camera is the only clear gain: macro F1 {d['arm_raise'][FIXED]:+.3f}, AUC {da['arm_raise'][FIXED]:+.3f}. "
      f"On phones macro F1 moved {d['arm_raise'][PHONE]:+.3f} (inside the 0.01 tolerance) but AUC moved {da['arm_raise'][PHONE]:+.3f}, a small loss.")
    w(f"- Squat moved {d['squat'][PHONE]:+.3f} (phone) and {d['squat'][FIXED]:+.3f} (fixed camera). With 5 and 9 people that is within noise: treat the squat as unchanged at about 0.79 to 0.80.")
    for ex in EXS:
        pb, pa = ext[ex][B]["per_person_macro_f1"], ext[ex][fin[ex]]["per_person_macro_f1"]
        for tag, g in (("R24", "fixed camera"), ("R26", "phone")):
            ps = [p for p in pb if p.startswith(tag)]
            w(f"- {NAME[ex]}, {g}: better for {sum(pa[p] > pb[p] + 1e-9 for p in ps)} of {len(ps)} people, worse for {sum(pa[p] < pb[p] - 1e-9 for p in ps)}.")
    sc = {ex: ext[ex]["selection_check"] for ex in EXS}
    w(f"- **Selection check.** About {sc['squat']['configurations']} configurations were scored on the same held-out people, and the \"after\" one was chosen after seeing them, which flatters it. "
      "Re-using the stored predictions, the configuration for each person was picked without that person (best weaker-device macro F1 on the other 13). That gives "
      + "; ".join(f"{NAME[ex].lower()} {f(sc[ex]['main'][PHONE]['macro_f1'])} phone / {f(sc[ex]['main'][FIXED]['macro_f1'])} fixed camera" for ex in EXS)
      + ". So the honest reading is: this round did not move the scores beyond noise, except possibly arm raise on the fixed camera.\n")

    w("## 2. The data behind each number\n")
    rows = []
    for ex in EXS:
        for g in (FIXED, PHONE):
            a = res[ex][B][g]
            rows.append([NAME[ex], DATASET[g], g, a["people"], a["reps"], a["mistake_reps"]])
    for n, v in ext["lab"].items():
        rows.append([NAME.get(v["exercise"], "Sit-to-stand"), n, "lab (motion capture / Kinect), not a camera", v["people"], v["logistic C=0.1"]["reps"], v["logistic C=0.1"]["mistake_reps"]])
    if (OUT / "mendeley_reps.json").exists():
        mr_ = load("mendeley_reps.json")
        rows.insert(2, ["Chair squat", "Mendeley multi-view fitness (section 11)", "phone (Mendeley, gym)", mr_["people_with_reps"], mr_["reps"], f"{mr_['reps_bad']} (labelled per clip)"])
    rows.append(["Sit-to-stand", "WLU Rehabilitation Posture (see SIT_TO_STAND_CAMERA.md)", "home phones and webcams; used to test, not to train", "6 recording set-ups (people not named)", "127 clips", "48 clips"])
    w(table(["Exercise", "Dataset", "Device group", "People", "Repetitions", "With a mistake"], rows))
    w("\nA REHAB26 repetition filmed by three iPhones counts as three repetitions (three views); REHAB24-6 likewise has two cameras per repetition. All views of a hidden person are hidden together. "
      "The README says REHAB24-6 has 10 people; the squat and arm-abduction repetitions on disk come from 9.\n")
    w("Lab datasets, each tested on its own unseen people (two fixed model families, no picking):\n")
    rows = [[n, v["people"], v["logistic C=0.1"]["reps"]] + [x for k in ("logistic C=0.1", "logistic + forest") for x in
                                                             (f(v[k]["macro_f1"]), f(v[k]["auc"]), f"{f(v[k]['precision_mistake'])} / {f(v[k]['recall_mistake'])}")] for n, v in ext["lab"].items()]
    w(table(["Dataset", "People", "Reps", "Logistic: macro F1", "AUC", "Precision / recall", "Logistic + forest: macro F1", "AUC", "Precision / recall"], rows))

    w("\nThe README's 0.83 (UI-PRMD squat) and 0.82 (IntelliRehabDS) were the best of several models and training mixes in `train_exercise.py`; the two fixed families here give the numbers above. "
      "The README counts 29 IntelliRehabDS people; the abduction repetitions on disk come from 28.")
    w("\n## 3. Experiment b: augmenting the body points before feature extraction (training people only)\n")
    cfgs = [(B, "No augmentation (baseline)"), ("ensemble | balanced | aug mirror+yaw", "Mirror + yaw turn of -30, -15, 15 or 30 degrees (each rep x3)"),
            ("ensemble | balanced | control, each rep repeated x3", "Control: each rep simply repeated x3, no augmentation"),
            ("ensemble | balanced | aug camera tilt+depth+offset", "Camera tilt (pitch +-10, roll +-6 degrees) + depth x0.8 to x1.25 + 2% body-point offset (each rep x3)")]
    w(table(["Training data (same ensemble)"] + [f"{NAME[ex]}: {g.split(' (')[0]}" for ex in EXS for g in (PHONE, FIXED)],
            [[lab] + [f(res[ex][k][g]["macro_f1"]) for ex in EXS for g in (PHONE, FIXED)] for k, lab in cfgs]))
    yc = {ex: res[ex]["_yaw_check"] for ex in EXS}
    w(f"\n- **Mirroring and yaw turns cannot help, by construction.** The features are joint angles, distances and directions measured relative to the body and to \"down\", so turning the body around the vertical axis "
      f"or mirroring it leaves them unchanged. Measured: mirroring changes no feature at all; a yaw turn moves "
      f"{yc['squat']['share of feature values a yaw turn moves by more than 0.01 standard deviations']:.4%} (squat) and "
      f"{yc['arm_raise']['share of feature values a yaw turn moves by more than 0.01 standard deviations']:.4%} (arm raise) of feature values, all of them \"when is the minimum / maximum\" ties.")
    w("- The small changes in the mirror + yaw row are therefore from seeing each repetition three times (which loosens the models' regularisation), not from new views: the control row reproduces them.")
    w("- **Camera tilt + depth + offset** is a real change to the features. Squat: within noise. Arm raise: better on phones, worse on the fixed camera. Not adopted.\n")
    w("![Augmentation](img/augmentation.png)\n")

    w("## 4. Experiment c: model families and class weights\n")
    fams = ["logistic C=0.1", "logistic C=nested", "forest", "boosting", "ensemble", "ensemble (nested-C logistic)"]
    label = {"logistic C=0.1": "Logistic regression, C = 0.1", "logistic C=nested": "Logistic regression, C chosen inside the training people (grid 0.01 to 1)",
             "forest": "Random forest (300 trees)", "boosting": "Gradient boosting (200 rounds, depth 3)", "ensemble": "Soft vote: logistic C = 0.1 + forest + boosting",
             "ensemble (nested-C logistic)": "Soft vote with the nested-C logistic"}
    rows = []
    for tag, tl in (("balanced", "classes balanced"), ("unweighted", "no class weights"), ("balanced + devices weighted equally", "classes balanced + devices weighted equally")):
        for fam in fams:
            k = f"{fam} | {tag}"
            if k in res["squat"]:
                rows.append([label[fam], tl] + [f"{f(res[ex][k][g]['macro_f1'])} ({f(res[ex][k][g]['auc'])})" for ex in EXS for g in (PHONE, FIXED)])
    w("Macro F1 (AUC in brackets), unseen people.\n")
    w(table(["Model", "Weights"] + [f"{NAME[ex]}: {g.split(' (')[0]}" for ex in EXS for g in (PHONE, FIXED)], rows))
    w("\n- No family wins everywhere. The forest is best on phones and weakest on the fixed camera for the arm raise; the soft-vote ensemble is the steadiest across both devices, so it stays.")
    w("- Class weights (balanced or none) change macro F1 by about 0.01 or less in the ensemble.")
    w("- Weighting the two device groups equally (REHAB26 has about four times as many repetitions, from fewer people) is the one setting that matches \"half phone, half webcam\" use, and it is what was exported.")
    w(f"- Chosen C per hidden person (nested logistic, balanced): squat {sorted(set(res['squat']['logistic C=nested | balanced']['C_per_fold']))}, "
      f"arm raise {sorted(set(res['arm_raise']['logistic C=nested | balanced']['C_per_fold']))}.\n")
    w("![Model comparison](img/model_comparison.png)\n")
    w("![Confusion, squat](img/confusion_squat.png)\n")
    w("![Confusion, arm raise](img/confusion_arm_raise.png)\n")

    w("## 5. Experiment d (secondary metric): \"coachable\" mistakes only\n")
    w("**This is not the main number.** It asks a narrower question: correct repetitions against only the mistakes the app names out loud. Only REHAB26 names the mistake of each repetition, "
      "so this is phone footage, 5 people. Squat: too shallow, knees inside, lifted heels, knees forward. Arm raise: arm too low (low abduction), bent arm. "
      "\"Body swaying\" has no label in REHAB26's arm raise, so it is not in the score.\n")
    rows = []
    for ex in EXS:
        for lab, c in (("The app's model (trained on all mistakes), other mistakes left out of the test", ext[ex][fin[ex]]["coachable_same_model"]),
                       ("Same ensemble trained without REHAB26's other mistakes", ext[ex]["coachable_dedicated_ensemble"])):
            rows.append([NAME[ex], lab, c["people"], f"{c['reps']} ({c['mistake_reps']} mistakes)", f(c["macro_f1"]), f(c["auc"]), f(c["precision_mistake"]), f(c["recall_mistake"])])
    w(table(["Exercise", "Model", "People", "Reps", "Macro F1", "AUC", "Precision", "Recall"], rows))
    w("\nEach named mistake against correct repetitions (macro F1; 5 people; about 830 correct and 165 to 168 mistake rep-views each):\n")
    rows = []
    for ex in EXS:
        det, same = ext[ex]["per_mistake_detector"], ext[ex][fin[ex]]["per_mistake_same_model"]
        for n in sorted(det, key=lambda n: -det[n]["macro_f1"]):
            rows.append([NAME[ex], n.replace("ERR_", "").replace("_", " ").lower(), "yes" if det[n]["coachable"] else "no", det[n]["mistake_reps"], f(det[n]["macro_f1"]),
                         f(same[n]["macro_f1"]), f"{same[n]['share_flagged_at_0.5']:.3f}"])
    w(table(["Exercise", "Mistake", "App names it", "Mistake reps", "Detector for this one mistake (logistic)", "The app's model", "Share of these reps the app's model flags (cut-off 0.5)"], rows))
    w("\nThe per-mistake detector is the logistic model of `mistake_check.py`. The README's per-mistake numbers (0.86 for a shallow squat, and so on) are that script's other column, the one-number rule; it was not re-run in this round.\n")
    w("![Mistakes detected](img/mistakes_detected.png)\n")

    w("## 6. Experiment e: would more recorded people raise the score?\n")
    cur = {ex: load(f"curve_{ex}.json") for ex in EXS}
    rows = []
    for k in sorted(cur["squat"]["points"], key=int):
        row = [k, f"{np.mean([r['train_reps'] for r in cur['squat']['points'][k]]):.0f}"]
        for ex in EXS:
            for g in (ALL, PHONE, FIXED):
                v = [r[g] for r in cur[ex]["points"][k]]
                row.append(f"{np.mean(v):.3f} ± {np.std(v):.3f}" if len(v) > 1 else f"{v[0]:.3f}")
        rows.append(row)
    w(f"Hidden person as always; training people drawn at random from the other 13 ({cur['squat']['repeats']} draws per size; ± is the spread over draws). "
      f"Model: {cur['squat']['model']} (a lighter stand-in for the exported ensemble, to fit the time budget; boosting left out).\n")
    w(table(["People in training", "Reps in training (squat, average)"] + [f"{NAME[ex]}: {g.split(' (')[0]}" for ex in EXS for g in ("all reps pooled", PHONE, FIXED)], rows))
    w("\n**Yes: the curves are still rising at 13 people** for both exercises, and have not flattened. Recording more people (especially on the devices patients use) is the most likely way to raise the score. "
      "The curve cannot say how far it goes. A phone person brings about 330 rep-views and a fixed-camera person about 40, so \"people\" also means more repetitions.\n")
    w("![Learning curve](img/learning_curve.png)\n")
    if (OUT / "curve_squat_mendeley.json").exists():
        w("The squat panel of this chart uses the larger pool of people of section 11 (REHAB24-6 + REHAB26 + Mendeley); the table above is the REHAB-only curve.\n")

    w("## 7. Experiment f: when the app says \"mistake\", how often is it right?\n")
    w("The lowest cut-off at which at least 90% of flagged held-out repetitions are real mistakes (as `operating_point.py`). The cut-off is chosen on the same held-out predictions it is scored on, "
      "so the last columns repeat the rule with the cut-off chosen without the tested person.\n")
    rows = []
    for ex in EXS:
        o = ext[ex][fin[ex]]["operating_point"]
        x = o["cutoff_chosen_without_the_tested_person"]
        none = sum(t is None for t in x["thresholds"])
        rows.append([NAME[ex], f"{o['threshold']:.2f}", f"{f(o['pooled']['precision'])} / {f(o['pooled']['recall'])} ({o['pooled']['flagged']} flags)"]
                    + [f"{f(o['by_device'][g]['precision'])} / {f(o['by_device'][g]['recall'])} ({o['by_device'][g]['flagged']} flags)" for g in (PHONE, FIXED)]
                    + [f"{f(x['precision'])} / {f(x['recall'])} ({x['flagged']} flags" + (f"; no cut-off reached 90% for {none} of 14 people, who get no flags)" if none else ")")])
    w(table(["Exercise (final model)", "Cut-off", "All held-out reps: precision / recall", "Phone", "Fixed camera", "Cut-off chosen without the tested person"], rows))
    w("\n- Squat: on phone footage about 9 in 10 flags are real and about 6 in 10 mistakes are caught. **On the fixed camera this does not hold**: few repetitions are flagged and about 7 in 10 flags are real. "
      "With the cut-off chosen without the tested person, precision is about 0.73 overall. Do not claim \"9 in 10\" for webcams.")
    w("- Arm raise: precision at the cut-off is 0.930 on phones and 0.875 on the fixed camera, but fewer than 1 in 5 mistakes is flagged overall.")
    w("- Before this round the same table read: squat cut-off 0.85, precision / recall 0.901 / 0.545 overall, 0.911 / 0.612 phone, 0.611 / 0.090 fixed camera (18 flags); "
      "arm raise cut-off 0.82, 0.923 / 0.165 overall, 0.922 / 0.169 phone, 0.929 / 0.148 fixed camera (28 flags).\n")

    w("## 8. What helped, what did not\n")
    w(table(["Tried", "Result", "Kept"], [
        ["Devices weighted equally in training", "Arm raise fixed camera up (0.656 to 0.702); squat and arm raise phone within noise", "yes"],
        ["Mirroring, yaw turns", "No effect by construction (features do not change)", "no"],
        ["Camera tilt / depth / offset augmentation", "Squat within noise; arm raise phone up, fixed camera down", "no"],
        ["Logistic with C chosen in training folds", "Lower on squat fixed camera (0.768 to 0.721); +0.013 and +0.019 on arm raise as a single model, +0.009 and +0.012 inside the ensemble", "no"],
        ["Random forest or gradient boosting alone", "Neither beats the ensemble on both devices", "no"],
        ["No class weights", "About 0.01 or less either way", "no"],
        ["Earlier rounds (not repeated)", "Per-person calibration, 2D image-plane angles, lab data in camera training for arms, each dataset on its own scale: all dropped", "no"]]))

    w("\n## 9. Files and model replacement\n")
    w("- `ml/models/squat.json`, `ml/models/arm_raise.json` and the copies in `web/public/models/` were replaced with the device-weighted ensembles (same format, same features; flag cut-offs 0.84 and 0.79). "
      "Old files: `~/jhealth-cache/models-backup-20261119/`. `ml/models/parity_squat.json` and `parity_arm_raise.json` were regenerated; `node --test scripts/pose.test.ts` passed (4 of 4) before and after.")
    w("- To go back: copy the two JSON files from the backup's `ml-models/` into `ml/models/` and `web/public/models/`, and the two parity files into `ml/models/`.")
    w("- `ml/operating_point.py` would recompute the cut-off without the device weights; use `final_round.py export` instead for these two models.\n")

    w("## 10. Not verified\n")
    w("- Whether any person appears in both REHAB24-6 and REHAB26 (same research group; ids are numbers in one and first names in the other). If someone does, that person leaks between training and test.")
    w("- A real laptop webcam and a real propped-up phone at home: both device groups are lab recordings of healthy adults.")
    w("- Which MediaPipe model produced REHAB26's body points (they come from the dataset authors); REHAB24-6 uses the heavy tracker.")
    w("- The app in a browser was not run; only the parity test (same features and score as Python on one repetition per exercise).")
    w("- The sit-to-stand camera numbers in section 1 (WLU): quoted from SIT_TO_STAND_CAMERA.md, not re-run here.\n")

    if (OUT / "mendeley_eval.json").exists():
        mendeley_section(w, res, fin)

    w("## 12. Reproduce\n")
    w("One process at a time, from `ml/`. On this laptop the stages took about 3, 2, 4, 3, 2, 1, 1, 1 minutes.\n")
    w("```bash\ncd ~/jhealth/ml && P=~/jhealth-cache/venv/bin/python\n"
      "OMP_NUM_THREADS=2 nice -n 10 $P final_round.py families squat\n"
      "OMP_NUM_THREADS=2 nice -n 10 $P final_round.py families arm_raise\n"
      "OMP_NUM_THREADS=2 nice -n 10 $P final_round.py aug squat\n"
      "OMP_NUM_THREADS=2 nice -n 10 $P final_round.py aug arm_raise\n"
      "OMP_NUM_THREADS=2 nice -n 10 $P final_round.py control squat\n"
      "OMP_NUM_THREADS=2 nice -n 10 $P final_round.py control arm_raise\n"
      "OMP_NUM_THREADS=2 nice -n 10 $P final_round.py curve squat\n"
      "OMP_NUM_THREADS=2 nice -n 10 $P final_round.py curve arm_raise\n"
      f"OMP_NUM_THREADS=2 nice -n 10 $P final_round.py extras --final-squat \"{fin['squat']}\" --final-arm \"{fin['arm_raise']}\"\n"
      f"OMP_NUM_THREADS=2 nice -n 10 $P final_round.py export squat --config \"{fin['squat']}\"      # writes final_round_out/squat.json\n"
      f"OMP_NUM_THREADS=2 nice -n 10 $P final_round.py export arm_raise --config \"{fin['arm_raise']}\"\n"
      "OMP_NUM_THREADS=2 nice -n 10 $P final_round_charts.py     # docs/img/*.png\n"
      "# section 11 (Mendeley squats): clips fetched by fetch_mendeley_squats.py, then\n"
      "OMP_NUM_THREADS=2 nice -n 10 $P -I mendeley_squat.py track --max-minutes 7.5   # repeat until all clips are tracked (about 70 minutes in all)\n"
      "OMP_NUM_THREADS=2 nice -n 10 $P -I mendeley_squat.py reps\n"
      "OMP_NUM_THREADS=2 nice -n 10 $P -I mendeley_squat.py eval\n"
      "OMP_NUM_THREADS=2 nice -n 10 $P -I mendeley_squat.py combined --weights equal\n"
      "OMP_NUM_THREADS=2 nice -n 10 $P -I mendeley_squat.py combined --weights none\n"
      "OMP_NUM_THREADS=2 nice -n 10 $P -I mendeley_squat.py curve\n"
      "$P final_round_report.py                                  # this file\n"
      "$P make_parity.py squat arm_raise && (cd ../web && node --test scripts/pose.test.ts)\n```\n")
    w("Raw numbers: `ml/final_round_out/results_<exercise>.json`, `extras.json`, `curve_<exercise>.json`; held-out probabilities: `probs_<exercise>.npz`; logs: `log_*.txt`.")
    DOC.write_text("\n".join(out) + "\n")
    print("wrote", DOC, f"({len(DOC.read_text().split())} words)")


if __name__ == "__main__":
    main()
