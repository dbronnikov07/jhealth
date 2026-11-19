"""Try the own-clip pipeline before your real clips exist.

Cuts four people's real squat videos out of the public dataset into clips named the way docs/RECORDING.md asks
(good_1.mp4, bad_form_1.mp4, in one folder per person) and puts them in ~/jhealth-cache/standin_clips. Then:

    ~/jhealth-cache/venv/bin/python extract_clips.py --clips ~/jhealth-cache/standin_clips --out ~/jhealth-cache/standin_reps.npz --report ~/jhealth-cache/standin_report --expected 5
    ~/jhealth-cache/venv/bin/python train_own.py --own ~/jhealth-cache/standin_reps.npz --out ~/jhealth-cache/standin_model.json --no-public

The scores mean NOTHING: the clips come from the public data, and their mistakes are the dataset's mixed ones.
This only shows that the pipeline runs and what its output looks like.
"""
import csv, subprocess, sys
from collections import defaultdict
from pathlib import Path
from remotezip import RemoteZip

CACHE = Path.home() / "jhealth-cache"
SRC, OUT = CACHE / "standin_src", CACHE / "standin_clips"
SRC.mkdir(exist_ok=True); OUT.mkdir(exist_ok=True)
rows = [r for r in csv.DictReader(open(CACHE / "Segmentation.csv"), delimiter=";") if r["exercise_id"] == "6"]
by_video = defaultdict(list)
for r in rows:
    by_video[r["video_id"]].append((int(r["first_frame"]), int(r["last_frame"]), int(r["correctness"]), int(r["person_id"])))
plan = {}
for vid, reps in by_video.items():
    reps.sort(); runs = []
    for rep in reps:
        if runs and runs[-1][-1][2] == rep[2] and rep[0] - runs[-1][-1][1] < 60:
            runs[-1].append(rep)
        else:
            runs.append([rep])
    runs = [r for r in runs if len(r) >= 4]
    if any(r[0][2] == 1 for r in runs) and any(r[0][2] == 0 for r in runs):
        plan[vid] = runs
print("videos with both a good and a bad run:", {v: [(len(r), 'good' if r[0][2] else 'bad') for r in rs] for v, rs in plan.items()})
want = sorted(plan)[:4]
with RemoteZip("https://zenodo.org/api/records/13305826/files/videos.zip/content") as z:
    for vid in want:
        src = SRC / f"{vid}.mp4"
        if not src.exists():
            src.write_bytes(z.read(f"Ex6/{vid}-Camera17-30fps.mp4"))
        person = f"person{by_video[vid][0][3]}"
        (OUT / person).mkdir(exist_ok=True)
        counts = defaultdict(int)
        for run in plan[vid]:
            label = "good" if run[0][2] else "bad_form"
            counts[label] += 1
            a, b = max(0, run[0][0] - 20), run[-1][1] + 20
            dst = OUT / person / f"{label}_{counts[label]}.mp4"
            subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", f"{a/30:.3f}", "-i", str(src), "-t", f"{(b-a)/30:.3f}",
                            "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "28", str(dst)], check=True)
            print(dst.relative_to(OUT), f"{len(run)} reps expected")
