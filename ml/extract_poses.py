"""STEP 1 - videos -> body landmarks.

REHAB24-6 gives us videos of people doing rehab exercises, and a table that says
"frames 180-377 of video PM_000 are one repetition, and it was done correctly".
A model cannot learn from raw pixels with only ~1,000 examples, so first we turn
every video frame into 33 body points (shoulders, hips, knees, ...) with MediaPipe.
That is the same pose tracker the patient's browser will run, so the training data
looks like what the live demo camera will produce.

The videos are 2.6 GB in one zip. We never download the whole zip: one video
(10-40 MB) is pulled out of it over the network, processed, and deleted.

Run:   ~/jhealth-cache/venv/bin/python extract_poses.py                  (all 5 exercises)
       ~/jhealth-cache/venv/bin/python extract_poses.py --exercises 6     (squats only)
Output: ~/jhealth-cache/landmarks/<video>_cam17.npz and _cam18.npz
"""
import argparse
import csv
import shutil
import time
from collections import defaultdict
from multiprocessing import Pool
from pathlib import Path

import numpy as np

# Big files (videos, body points, the Python environment) live in ~/jhealth-cache.
# Keep both this project and that folder OUT of Desktop and Documents: those are synced to iCloud,
# which chokes on thousands of small files and deletes local copies when the disk is nearly full.
CACHE = Path.home() / "jhealth-cache"
LABELS = CACHE / "Segmentation.csv"
TMP = CACHE / "video_tmp"


def model_paths(name):
    """'full' is MediaPipe's default model. 'heavy' is slower but more accurate."""
    return (CACHE / ("landmarks" if name == "full" else f"landmarks_{name}"),
            CACHE / f"pose_landmarker_{name}.task",
            "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
            f"pose_landmarker_{name}/float16/latest/pose_landmarker_{name}.task")

ZENODO = "https://zenodo.org/api/records/13305826/files"
VIDEOS_ZIP = f"{ZENODO}/videos.zip/content"
LABELS_URL = f"{ZENODO}/Segmentation.csv/content"
FPS = 30
PAD = 15         # frames kept before/after each block of repetitions
MERGE_GAP = 60   # reps closer than this are processed as one continuous block


def read_blocks(exercises):
    """From the label table: which frame ranges of which video we need."""
    spans = defaultdict(list)
    exercise_of = {}
    with open(LABELS) as f:
        for r in csv.DictReader(f, delimiter=";"):
            if int(r["exercise_id"]) in exercises:
                spans[r["video_id"]].append((int(r["first_frame"]), int(r["last_frame"])))
                exercise_of[r["video_id"]] = int(r["exercise_id"])
    blocks = {}
    for vid, s in spans.items():
        s.sort()
        merged = [[max(0, s[0][0] - PAD), s[0][1] + PAD]]
        for a, b in s[1:]:
            if a - PAD - merged[-1][1] <= MERGE_GAP:
                merged[-1][1] = b + PAD
            else:
                merged.append([max(0, a - PAD), b + PAD])
        blocks[vid] = merged
    return blocks, exercise_of


def zip_member(exercise, vid, cam):
    suffix = "Camera17-30fps.mp4" if cam == 17 else "Camera18-30fps-transposed.mp4"
    return f"Ex{exercise}/{vid}-{suffix}"


def process(job):
    """Download one video, run the pose tracker on the frames we need, save, delete."""
    import cv2
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision
    from remotezip import RemoteZip

    exercise, vid, cam, blocks, stride, model_name = job
    OUT, MODEL, _ = model_paths(model_name)
    out = OUT / f"{vid}_cam{cam}.npz"
    if out.exists():
        return f"skip  {out.name} (already done)"

    t0 = time.time()
    workdir = TMP / f"{vid}_cam{cam}"
    workdir.mkdir(parents=True, exist_ok=True)
    video_path = workdir / "video.mp4"
    for attempt in range(1, 6):          # the connection to Zenodo drops now and then: try again
        try:
            with RemoteZip(VIDEOS_ZIP) as z, z.open(zip_member(exercise, vid, cam)) as src, open(video_path, "wb") as dst:
                shutil.copyfileobj(src, dst)
            break
        except Exception as e:
            if attempt == 5:
                raise
            time.sleep(5 * attempt)
    t_download = time.time() - t0

    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(MODEL)),
        running_mode=vision.RunningMode.VIDEO,   # VIDEO = track the person from frame to frame
        num_poses=1,
    )
    cap = cv2.VideoCapture(str(video_path))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    frames, world, image, vis = [], [], [], []
    idx = 0
    for start, end in blocks:
        landmarker = vision.PoseLandmarker.create_from_options(options)  # fresh tracker per block
        while idx < start:            # skip frames we do not need (decode only)
            if not cap.grab():
                break
            idx += 1
        while idx <= end:
            if (idx - start) % stride:       # only look at every 2nd frame: 15 per second is plenty
                if not cap.grab():           # for slow rehab movements, and it halves the work
                    break
                idx += 1
                continue
            ok, bgr = cap.read()
            if not ok:
                break
            rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)
            result = landmarker.detect_for_video(
                mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(idx * 1000 / FPS))
            frames.append(idx)
            if result.pose_world_landmarks:
                w, im = result.pose_world_landmarks[0], result.pose_landmarks[0]
                world.append([(p.x, p.y, p.z) for p in w])     # metres, origin between the hips
                image.append([(p.x, p.y, p.z) for p in im])    # 0..1 position in the picture
                vis.append([p.visibility for p in im])         # 0..1 "how sure am I this point is visible"
            else:                                              # nobody found in this frame
                world.append(np.full((33, 3), np.nan))
                image.append(np.full((33, 3), np.nan))
                vis.append(np.zeros(33))
            idx += 1
        landmarker.close()
    cap.release()

    OUT.mkdir(parents=True, exist_ok=True)
    tmp_out = out.parent / (out.stem + ".part.npz")
    np.savez_compressed(
        tmp_out, frames=np.array(frames, np.int32), world=np.array(world, np.float32),
        image=np.array(image, np.float32), vis=np.array(vis, np.float32),
        width=width, height=height, exercise=exercise)
    tmp_out.rename(out)
    shutil.rmtree(workdir, ignore_errors=True)

    n = len(frames)
    t_total = time.time() - t0
    missed = int(np.isnan(np.array(world, np.float32)[:, 0, 0]).sum()) if n else 0
    return (f"done  {out.name}  {n} frames  {width}x{height}  no-person frames: {missed}  "
            f"download {t_download:.0f}s  pose {n / max(t_total - t_download, 1e-6):.0f} fps")


def process_safe(job):
    """One failed video must not stop the whole run. Failures are reported; just run the script again."""
    try:
        return process(job)
    except Exception as e:
        return f"FAILED {job[1]}_cam{job[2]}: {type(e).__name__}. Run the script again to retry it."


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--exercises", type=int, nargs="+", default=[6, 5, 4, 1, 2],
                    help="6 squat, 5 lunge, 4 leg abduction, 1 arm abduction, 2 arm VW (3 = push-ups, skipped)")
    ap.add_argument("--videos", nargs="*", help="only these video ids, e.g. PM_008")
    ap.add_argument("--cams", type=int, nargs="+", default=[17, 18])
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--stride", type=int, default=2, help="run the pose tracker on every Nth frame")
    ap.add_argument("--model", choices=["full", "lite", "heavy"], default="full", help="which MediaPipe pose model")
    args = ap.parse_args()

    import requests   # (not urllib: python.org Python on macOS ships without SSL certificates)
    CACHE.mkdir(exist_ok=True)
    _, MODEL, MODEL_URL = model_paths(args.model)
    for path, url, what in ((LABELS, LABELS_URL, "the label table"), (MODEL, MODEL_URL, f"the {args.model} MediaPipe pose model")):
        if not path.exists():
            print(f"downloading {what} ...")
            path.write_bytes(requests.get(url, timeout=120).content)

    blocks, exercise_of = read_blocks(set(args.exercises))
    order = {e: i for i, e in enumerate(args.exercises)}
    vids = sorted(blocks, key=lambda v: (order[exercise_of[v]], v))
    if args.videos:
        vids = [v for v in vids if v in args.videos]
    jobs = [(exercise_of[v], v, cam, blocks[v], args.stride, args.model) for v in vids for cam in args.cams]
    total = sum(b - a + 1 for j in jobs for a, b in j[3]) // args.stride
    print(f"{len(jobs)} videos, {total:,} frames to process with {args.workers} workers")

    t0 = time.time()
    with Pool(args.workers) as pool:
        for i, msg in enumerate(pool.imap_unordered(process_safe, jobs), 1):
            print(f"[{i}/{len(jobs)}  {time.time() - t0:.0f}s] {msg}", flush=True)
    shutil.rmtree(TMP, ignore_errors=True)


if __name__ == "__main__":
    main()
