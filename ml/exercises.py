"""The four jHealth exercises, in one place: how a repetition is found, and which features the model reads.

Every exercise is counted the same way: a repetition is a DIP in one "rep signal" (see extract_clips.find_reps and
the browser's RepCounter). For each exercise the rep signal is chosen so that the movement shows up as a dip:

  squat                  knee angle (average of both)            standing ~170 deg -> dip to ~90
  sit_to_stand           knee angle (average of both)            standing -> sitting (~90) -> standing
  seated_knee_extension  360 - the straighter knee's angle       sitting ~270 -> straight leg ~190
  arm_raise              180 - the higher arm's shoulder angle   arm down ~165 -> arm up ~30

The browser (web/src/lib/pose/exercises.ts) uses the same definitions; keep them in step.

`features` is the notebook's feature set (REHAB24-6 exercise ids): 6 = both legs, 1 = one arm (mirrored so the
working arm is always "right"), 4 = one leg (mirrored, used for seated knee extension).
"""
import numpy as np


def _angle(w, a, b, c):
    u, v = w[:, a] - w[:, b], w[:, c] - w[:, b]
    cos = (u * v).sum(-1) / (np.linalg.norm(u, axis=-1) * np.linalg.norm(v, axis=-1) + 1e-9)
    return np.degrees(np.arccos(np.clip(cos, -1, 1)))


def knee_both(w):
    return (_angle(w, 23, 25, 27) + _angle(w, 24, 26, 28)) / 2


def knee_straighter(w):
    return 360.0 - np.maximum(_angle(w, 23, 25, 27), _angle(w, 24, 26, 28))


def arm_higher(w):
    return 180.0 - np.maximum(_angle(w, 23, 11, 13), _angle(w, 24, 12, 14))


EXERCISES = {
    "squat": dict(name="Squat", rep_signal=knee_both, min_depth=15.0, features=6, signal_label="knee angle (deg)"),
    "sit_to_stand": dict(name="Sit-to-stand", rep_signal=knee_both, min_depth=30.0, features=6,
                         signal_label="knee angle (deg)"),
    "seated_knee_extension": dict(name="Seated knee extension", rep_signal=knee_straighter, min_depth=25.0,
                                  features=4, signal_label="360 - straighter knee (deg)"),
    "arm_raise": dict(name="Arm raise to the side", rep_signal=arm_higher, min_depth=40.0, features=1,
                      signal_label="180 - higher arm (deg)"),
}
