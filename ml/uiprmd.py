"""UI-PRMD sit-to-stand -> repetitions the jHealth model can learn from.

UI-PRMD (University of Idaho Physical Rehabilitation Movements Data Set, Vakanski et al. 2018) is public domain
(ODC PDDL 1.0), archived by its authors on Zenodo (record 23104965). 10 healthy adults did each of 10 movements
10 times correctly and 10 times "in a suboptimal manner". Movement m05 is sit-to-stand.

Why the Vicon files and not the Kinect ones: in the Kinect files only the waist is a real position; every other
joint is stored relative to its parent's rotated frame, and the authors' own viewer warns that the lower body comes
out wrong for sit-to-stand. The Vicon files hold real lab positions (mm) of 39 skin markers, which convert directly:
shoulders, elbows, wrists, knees and ankles are markers, and the hip joints are estimated from the four pelvis
markers with Bell et al. (1990). `python uiprmd.py --check` shows the conversion behaves like a real body.

Each segmented file is one repetition, standing -> sitting -> standing, recorded at 100 Hz: the same shape the
live rep counter cuts.

Nothing is saved to disk: the files are read straight out of the Zenodo archives into memory.
"""
import sys

import numpy as np

UIPRMD = "https://zenodo.org/api/records/23104965/files"
VICON_HZ = 100
# Vicon marker numbers (1-based, the paper's Table 2) that we use
MARKER = dict(LFHD=1, RFHD=2, LSHO=10, LELB=12, LWRA=14, LWRB=15, RSHO=17, RELB=19, RWRA=21, RWRB=22,
              LASI=24, RASI=25, LPSI=26, RPSI=27, LKNE=29, LANK=31, LHEE=32, RKNE=35, RANK=37, RHEE=38)


def vicon_to_mediapipe(pos_mm):
    """(frames, 117) Vicon marker positions in mm -> (frames, 33, 3) in metres, MediaPipe's indices, y pointing down."""
    P = np.asarray(pos_mm, dtype=np.float64).reshape(len(pos_mm), 39, 3) / 1000.0
    g = lambda k: P[:, MARKER[k] - 1]  # noqa: E731
    # Hip joint centres (Bell et al., 1990): from the middle of the two front pelvis markers (ASIS), 30% of the
    # inter-ASIS width down, 14% back and 36% sideways.
    mid_asi = (g("LASI") + g("RASI")) / 2
    mid_psi = (g("LPSI") + g("RPSI")) / 2
    lateral = g("RASI") - g("LASI")
    width = np.linalg.norm(lateral, axis=1, keepdims=True)
    lateral = lateral / width
    anterior = mid_asi - mid_psi
    anterior -= (anterior * lateral).sum(1, keepdims=True) * lateral
    anterior /= np.linalg.norm(anterior, axis=1, keepdims=True)
    superior = np.cross(lateral, anterior)
    head = (g("LFHD") + g("RFHD")) / 2
    if ((head - mid_asi) * superior).sum(1).mean() < 0:
        superior = -superior          # "up" must point at the head, whatever the lab's axes
    hip = lambda side: mid_asi + width * (-0.30 * superior - 0.14 * anterior + side * 0.36 * lateral)  # noqa: E731
    out = np.full((len(P), 33, 3), np.nan)
    for i, v in {0: head, 11: g("LSHO"), 12: g("RSHO"), 13: g("LELB"), 14: g("RELB"),
                 15: (g("LWRA") + g("LWRB")) / 2, 16: (g("RWRA") + g("RWRB")) / 2,
                 23: hip(-1), 24: hip(+1), 25: g("LKNE"), 26: g("RKNE"), 27: g("LANK"), 28: g("RANK"),
                 29: g("LHEE"), 30: g("RHEE")}.items():
        out[:, i] = v
    # Turn the lab frame so that "up" (ankles -> head) is -y, as in MediaPipe's world landmarks (a proper rotation).
    up = (head - (g("LANK") + g("RANK")) / 2).mean(0)
    up /= np.linalg.norm(up)
    target = np.array([0.0, -1.0, 0.0])
    v = np.cross(up, target)
    s, c = np.linalg.norm(v), up @ target
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    R = np.eye(3) + K + K @ K * ((1 - c) / s ** 2) if s > 1e-8 else (np.eye(3) if c > 0 else np.diag([1.0, -1.0, -1.0]))
    return out @ R.T


def fill_marker_gaps(pos_mm, max_missing=0.2):
    """Markers the cameras lost for a few frames (missing or exactly 0,0,0) are filled in by interpolating over time.
    Returns None if a marker we need is missing in more than `max_missing` of the frames."""
    pos_mm = np.atleast_2d(np.asarray(pos_mm, dtype=np.float64))
    if len(pos_mm) < 10:
        return None                    # a damaged file with only a frame or two
    P = pos_mm.reshape(len(pos_mm), 39, 3).copy()
    missing = ~np.isfinite(P).all(-1) | (np.abs(np.nan_to_num(P)).sum(-1) == 0)
    used = [m - 1 for m in MARKER.values()]
    if missing[:, used].mean(0).max() > max_missing:
        return None
    t = np.arange(len(P))
    for j in used:
        bad = missing[:, j]
        if bad.any():
            for c in range(3):
                P[bad, j, c] = np.interp(t[bad], t[~bad], P[~bad, j, c])
    return P.reshape(len(pos_mm), -1)


MOVEMENTS = {  # UI-PRMD's ten movements; the ones jHealth uses are marked
    "m01": "deep squat (jHealth: squat)", "m02": "hurdle step", "m03": "inline lunge", "m04": "side lunge",
    "m05": "sit to stand (jHealth: sit-to-stand)", "m06": "standing active straight leg raise",
    "m07": "standing shoulder abduction (jHealth: arm raise)", "m08": "standing shoulder extension",
    "m09": "standing shoulder internal-external rotation", "m10": "standing shoulder scaption (jHealth: arm raise)",
}


def fetch_sit_to_stand(subjects=None):
    """Read UI-PRMD's sit-to-stand Vicon repetitions straight from Zenodo (movement m05)."""
    return fetch_movement("m05", subjects)


def fetch_movement(code, subjects=None):
    """Read one UI-PRMD movement's Vicon repetitions straight from Zenodo.
    Returns a list of (landmarks (frames, 33, 3), mistake 0/1, subject, seconds)."""
    import re
    from remotezip import RemoteZip
    reps, skipped = [], []
    for archive, mistake in (("Segmented Movements.zip", 0), ("Incorrect Segmented Movements.zip", 1)):
        with RemoteZip(f"{UIPRMD}/{archive.replace(' ', '%20')}/content") as z:
            for name in z.namelist():
                m = re.search(rf"/Vicon/Positions/{code}_s(\d+)_e(\d+)_positions", name)
                if not m or (subjects and int(m.group(1)) not in subjects):
                    continue
                raw = np.loadtxt(z.read(name).decode().splitlines(), delimiter=",")
                pos = fill_marker_gaps(raw)
                if pos is None:
                    skipped.append(name.rsplit("/", 1)[-1])
                    continue
                reps.append((vicon_to_mediapipe(pos), mistake, int(m.group(1)), len(pos) / VICON_HZ))
    if skipped:
        print(f"skipped {len(skipped)} repetitions with markers missing in over 20% of frames: {skipped}")
    return reps


def _angle(a, b, c):
    u, w = a - b, c - b
    return np.degrees(np.arccos(np.clip((u * w).sum(-1) / (np.linalg.norm(u, axis=-1) * np.linalg.norm(w, axis=-1)), -1, 1)))


if __name__ == "__main__" and "--check" in sys.argv:
    # Does the converted skeleton behave like a real person doing sit-to-stand? (3 people, about 8 MB streamed)
    for lm, mistake, subject, seconds in fetch_sit_to_stand(subjects={1, 2, 3})[::10]:
        knee = (_angle(lm[:, 23], lm[:, 25], lm[:, 27]) + _angle(lm[:, 24], lm[:, 26], lm[:, 28])) / 2
        hip_height = ((lm[:, 27] + lm[:, 28]) / 2 - (lm[:, 23] + lm[:, 24]) / 2)[:, 1]
        thigh = np.linalg.norm(lm[:, 25] - lm[:, 23], axis=1)
        q = np.linspace(0, len(knee) - 1, 5).astype(int)
        print(f"subject {subject} {'incorrect' if mistake else 'correct  '} {seconds:.1f}s | knee {knee[q].round(0)} deg | "
              f"hip height {hip_height[q].round(2)} m | thigh {thigh.mean():.2f}±{thigh.std():.2f} m | "
              f"feet move {np.ptp(lm[:, 27], axis=0).max() * 100:.1f} cm")
