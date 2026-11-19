"""How much does a model lose when it is trained on motion capture and used on camera body points?

The sit-to-stand model is trained on UI-PRMD motion capture but runs on MediaPipe body points in the browser.
UI-PRMD has no video, so the loss cannot be measured there. REHAB24-6 has both for the same squats (motion-capture
joints, and MediaPipe body points from its videos), so this script measures it there, with the honest test:

    train on motion capture of 8 people  ->  test on camera body points of the 9th  (and rotate)

    ~/jhealth-cache/venv/bin/python transfer_check.py     (about a minute; reads files already on disk)
"""
import sys
import warnings
from pathlib import Path

import numpy as np

warnings.filterwarnings("ignore")
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import notebook_code  # noqa: E402
import train_squat as ts  # noqa: E402

ns = notebook_code.load()
Xc, yc, wc, *_ = ts.load(HERE / "data" / "reps_heavy.npz", ns)                         # camera (MediaPipe heavy)
Xm, ym, wm, *_ = ts.load(Path.home() / "jhealth-cache" / "reps_mocap.npz", ns)          # motion capture

print(f"squats: camera {len(yc)} samples, motion capture {len(ym)} samples, {len(set(wc))} people\n")
print(f"  {'trained on -> tested on':42s} {'macro F1':>8s} {'AUC':>6s}")
for label, make in (("logistic regression", lambda: ts.logistic(0.1)),):
    for name, (Xtr, ytr, wtr), (Xte, yte, wte) in (
        ("camera -> camera", (Xc, yc, wc), (Xc, yc, wc)),
        ("motion capture -> motion capture", (Xm, ym, wm), (Xm, ym, wm)),
        ("motion capture -> camera", (Xm, ym, wm), (Xc, yc, wc)),
    ):
        prob = np.zeros(len(yte))
        for p in np.unique(wte):
            model = make().fit(Xtr[wtr != p], ytr[wtr != p])
            prob[wte == p] = model.predict_proba(Xte[wte == p])[:, 1]
        s = ns["scores"](yte, prob)
        print(f"  {name:42s} {s['macro F1']:8.2f} {s['AUC']:6.2f}   ({label})")

# The cheap fix: put each source on its own scale before training/scoring (z-score per source, using the source's own
# mean and spread, no labels needed). For the camera, the scale comes from the OTHER people's camera reps only.
def zs(X, ref):
    return (X - ref.mean(0)) / (ref.std(0) + 1e-9)

prob = np.zeros(len(yc))
for p in np.unique(wc):
    model = ts.logistic(0.1).fit(zs(Xm[wm != p], Xm[wm != p]), ym[wm != p])
    prob[wc == p] = model.predict_proba(zs(Xc[wc == p], Xc[wc != p]))[:, 1]
s = ns["scores"](yc, prob)
print(f"  {'motion capture -> camera, each on its own scale':42s} {s['macro F1']:8.2f} {s['AUC']:6.2f}   (logistic regression)")
