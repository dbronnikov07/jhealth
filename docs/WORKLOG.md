# Worklog: what was built on 18 November 2026, and why

Written for someone new to machine learning. Every term is explained the first time it appears.

## 0. The short version

In about an hour and a half we went from "a PDF, a plan and a dataset link" to a working training pipeline for a model that looks at one exercise repetition and says whether it has a mistake. It runs end to end on real data (1,927 repetitions of five exercises, 110 videos).

What exists: the pipeline, five trained models exported to JSON, and an honest test score for each.
What does not exist yet: the WhatsApp bot, the browser session page, the physio dashboard, and any data recorded by your own team. Those are the next phases, and the last one matters most for the score (see section 7).

## 1. Where everything is

| What | Where |
|---|---|
| Project (code, README, notebook, exported models) | `~/jhealth` |
| The notebook that trains and tests the models | `ml/train_model.ipynb` |
| Step 1: videos to body points | `ml/extract_poses.py` |
| Step 2: body points to one row per repetition | `ml/build_dataset.py` |
| The cleaned dataset (22 MB, this is what training reads) | `ml/data/reps.npz` |
| Exported models for the browser | `ml/models/*.json` |
| Ceiling diagnostic (section 6) | `ml/ceiling_check.py` |
| Own clips: cut into squats, train, test (section 10) | `ml/extract_clips.py`, `ml/train_own.py`, `docs/RECORDING.md` |
| Python environment, raw body points, downloaded labels | `~/jhealth-cache` (not in the project on purpose) |

Why not `~/Desktop/coconect`? That folder is synced to iCloud and the disk is 98% full. iCloud tried to upload the Python environment file by file, the laptop slowed to a crawl (load average above 70), and iCloud deleted its local copy of a small data file in the middle of a run. Everything now lives in `~/jhealth`, which is not synced. Do not move it back to the Desktop or Documents.

## 2. The plan, in plain words

A rehab coach needs to answer one question per repetition: *was that rep done well?* A computer cannot look at a video and know. So the pipeline has four stages:

1. **Video to body points.** A pose tracker (MediaPipe, made by Google) finds 33 points on the body (shoulders, hips, knees, ankles, ...) in every video frame. After this stage we no longer look at pixels. A rep is a table of 64 time steps × 33 points × 3 coordinates.
2. **Body points to angles.** A raw position like "knee at x = 0.12 m" changes with height and where the person stands. An angle like "knee bent 90 degrees" does not. We compute 17 angle-like measurements per frame for leg exercises (knee angle, trunk lean, how far apart the knees are compared with the hips, ...) and 12 for arm exercises.
3. **Angles to a verdict.** A model learns from repetitions that a physiotherapist already labelled "correct" or "mistake". It outputs a probability of "mistake".
4. **Export.** The trained model is saved as a small JSON file so the website can run it in the browser.

## 3. The data

Dataset: REHAB24-6 ([Zenodo](https://zenodo.org/records/13305826)). 10 healthy adults aged 25 to 50 did six exercises in a lab while two cameras filmed them. A physiotherapist told each person to do some repetitions correctly and some wrongly, and wrote down which was which. We checked the label file directly: 1,072 labelled repetitions, 65 videos.

We use five of the six exercises:

| Exercise | Body area | Samples | People | Correct | Mistake |
|---|---|---|---|---|---|
| Squat | knee | 390 | 9 | 268 | 122 |
| Lunge | knee, hip | 345 | 8 | 155 | 190 |
| Leg abduction (leg out to the side) | hip | 420 | 9 | 240 | 180 |
| Arm abduction (arm out to the side) | shoulder | 356 | 9 | 180 | 176 |
| Arm VW | shoulder | 416 | 9 | 188 | 228 |

A "sample" is one repetition seen by one camera. Each repetition was filmed by two cameras, so it appears twice. Push-ups were left out because they are not part of a joint-replacement plan.

Two things about this data matter for everything below:

- **The mistakes are not the same for every person.** The physiotherapist suggested different mistakes to each person. So "mistake" is a mixed bag: too shallow for one person, knees falling inward for another.
- **Only 8 to 9 people.** A model that has to recognise a mistake in a *new* person has seen very few different bodies.

## 4. What was done, step by step

### 4.1 Reading the inputs (17:45 to 17:55)
- Read the old pitch deck (`jHealth.pdf`, in Russian). It is the earlier Russian-market pitch for lower-limb rehabilitation. The Canadian plan you pasted replaces it, so I did not build for it.
- Checked the hackathon page: YHacks 2026 is for ages 13 to 17, build days run Nov 15 to 20, and the pitch is on campus on Nov 21. It does not list rules, judging criteria or a pitch length, and it does not mention Adaption Labs or Higgsfield. The pasted notes say "24 hours", but the real window is days.
- Checked the dataset on Zenodo and read its label file: 1,072 labelled repetitions, license CC BY-NC (non-commercial research only).

### 4.2 Proving the idea on one video (17:55 to 18:05)
Before spending an hour on all videos, I ran MediaPipe on one squat video (3,495 frames) and compared the knee angle with the physiotherapist's labelled rep boundaries. In all 27 repetitions the deepest point of the knee bend fell in the middle of the labelled rep (between 38% and 62% of the way through). That told us the label timing and the tracker agree, so the pipeline is sound.

### 4.3 Extracting body points from all 110 videos (18:05 to 19:15)
`extract_poses.py` does this. Details that matter:
- The videos are in one 2.6 GB zip. The script never downloads the whole zip. It pulls one video (10 to 40 MB) out of the zip over the network, tracks the body, saves the points, deletes the video, and moves on.
- It only processes frames inside labelled repetitions, and looks at every second frame (15 per second is plenty for slow rehab movements).
- It can be stopped and restarted at any time; finished videos are skipped.

This stage was supposed to take about an hour and mostly did, but three things went wrong:
1. **Four parallel workers overloaded the laptop** (load average 73 to 90, everything crawling). I restarted with fewer workers.
2. **The iCloud problem** from section 1. Moving the project out of the Desktop fixed it. Moving the folder with `mv` itself took minutes because iCloud was involved; making a fresh Python environment outside the Desktop took seconds.
3. **A silent empty file.** After iCloud removed the local copy of the label file, the next step read it as empty and produced a dataset with zero samples, with no error. The scripts now keep their inputs in `~/jhealth-cache`, and the dataset builder refuses to use an exercise until all of its videos are extracted.

### 4.4 Cutting repetitions and building features (`build_dataset.py`, notebook section 2 to 3)
- Every repetition is cut out and stretched or squeezed to exactly 64 frames, so a slow rep and a fast rep have the same shape.
- For each repetition we compute the angle signals, then summarise every signal with 11 numbers: five about size (lowest, highest, range, average, how much it wiggles), two about timing (when the lowest and highest values happen), and four about tempo and control (average speed, fastest speed, jerkiness, first half versus second half). For a squat that is 17 signals × 11 + the rep's duration = 188 numbers per repetition. (The first version used only the five size numbers, 86 per repetition; section 4.6 explains why the other six were added.)
- **One-sided exercises need a trick.** In a lunge, leg abduction or arm abduction, one side works and one rests. If the person uses their left side, we mirror the skeleton so the working side is always called "right". Otherwise the model would have to learn everything twice with half the data.
- **How we know which side works.** We never told the model the dataset's left/right labels; it works it out from the movement. Then we compared with the dataset's labels as a check: lunge 98% agreement, leg abduction 93%. The rule is trustworthy.
- **Bugs found and fixed while building this:** the "knee in front of the ankle" signal first used the foot direction, which MediaPipe estimates poorly, and gave a flat, useless curve. It now uses the direction the chest faces. The "which leg is the front leg" rule started at 92% agreement and a comparison of eight candidate rules got it to 98%.

### 4.5 Training and the honest test (notebook sections 4 to 7)
Test method: **leave one person out.** Hide one person completely, train on everyone else, predict the hidden person, and repeat until each person has been the hidden one. Why: if the same person is in training and in the test, the model can cheat by recognising *the person* (their height, their habits) instead of *the mistake*. A real patient is always a new person, so this is the only test that predicts real life.

We compared four models:
1. **Always say "correct".** Not a model; the floor.
2. **Logistic regression.** Gives each of the 188 numbers a weight and adds them up. Simple and fast.
3. **Random forest.** 300 decision trees that each ask yes/no questions and vote. This is the one you asked for.
4. **1D-CNN.** A small neural network (about 26,000 parameters) that reads the whole 64-frame curves.

Metric used everywhere: **macro F1.** It averages how well the model does on "mistake" reps and on "correct" reps. 1.0 is perfect, and always saying "correct" scores around 0.3 to 0.4 (it gets the correct reps right and every mistake wrong). Plain accuracy is easy to fool, so we do not lead with it.

### 4.6 Experiments: what helped and what did not
Every variant was run through the same honest test, so the numbers are comparable. The score used is the average over the five exercises of the better of logistic regression and forest ("mean best"); the starting point was 0.692. Anything within about 0.02 is inside the noise of a test with nine people, so only the bigger or consistent effects are worth acting on.

| Idea | Mean best | Verdict |
|---|---|---|
| Starting point | 0.692 | |
| Compare each person with their own first correct reps ("your approved form") | 0.49 to 0.60 on a smaller test set | Worse. The first reps are too few and too noisy to be a baseline. |
| Smooth the body-point tracks (window 5, 9, 15) | 0.688, 0.691, 0.700 | Tiny gain. The tracker's error is a consistent wrong-depth error, not jitter, so smoothing cannot remove it. |
| Force the right arm in arm abduction (the dataset's arm abduction is always the right arm) | 0.688 | No gain. |
| Use the dataset's own left/right labels for lunge and leg abduction instead of our rule | 0.693 | No gain. Our rule is already good enough. |
| Other tree models (extra trees, gradient boosting) | within 0.01 | No gain. |
| Only use body-area features for each exercise (legs for leg exercises, arms for arm exercises) | forest +0.06 on squats, logistic +0.01 | Kept. |
| **Add timing and tempo features** (when things happen, speed, jerkiness, first versus second half) | **0.708** | **Kept.** Small, but it is consistent across exercises (lunge +0.04, arm abduction +0.02), and it matches what physiotherapists actually correct. |

The honest summary: after all of this, the score moved from 0.69 to 0.70. The model is not the bottleneck.

### 4.7 Export (notebook section 9)
The notebook exports whichever simple model wins overall, as JSON, one file per exercise. It re-reads the JSON with a few lines of plain Python and checks the answers match scikit-learn to within 1e-7, so a JavaScript version will be able to match exactly. `ml/models/parity_test.json` is one worked example for testing that JavaScript port later.

## 5. Results

Everything below is macro F1 on people the model never saw (the leave-one-person-out test from section 4.5).

| Exercise | Samples | People | Always "correct" | Logistic regression | Random forest | 1D-CNN |
|---|---|---|---|---|---|---|
| Squat | 390 | 9 | 0.41 | **0.72** | 0.66 | 0.71 |
| Lunge | 345 | 8 | 0.31 | 0.65 | 0.59 | **0.68** |
| Leg abduction | 420 | 9 | 0.36 | **0.76** | 0.75 | 0.72 |
| Arm abduction | 356 | 9 | 0.34 | 0.63 | **0.70** | 0.63 |
| Arm VW | 416 | 9 | 0.31 | **0.69** | **0.69** | 0.66 |
| All five | 1,927 | | 0.35 | **0.70** | **0.70** | 0.69 |

The exported models are logistic regressions (tied with the forest overall, and each is only 17 kB).

**How to read this.** Always saying "correct" scores about 0.35. Our models score about 0.70. So the model has learned something real, and it is roughly twice as good as ignoring the data. But 0.70 also means that on a new person roughly one rep in three is judged wrongly. For the squat, the forest catches 68 of 122 mistakes and raises 61 false alarms among 268 correct reps.

**Four findings:**

1. **The three model families are tied.** Logistic regression, forest and neural network all land at 0.69 to 0.70 overall. When a simple model and a neural network tie, the limit is the data, not the model. This is why trying fancier models will not help.
2. **The lazy test inflates scores a lot.** The same forest scores 0.83 to 0.90 when repetitions are shuffled and split at random, because the same people are in training and in the test. The honest numbers are 0.59 to 0.75. If a competitor quotes 90 or 95 percent, ask which test it was.
3. **Some people are much harder than others.** For squats, the accuracy on the hidden person ranges from 0.36 (person 8) to 0.89 (person 1). With 9 people, one unusual person moves a score a lot, which is why differences smaller than about 0.03 should not be believed.
4. **The viewing angle matters.** Seen from the side ("profile"), the lunge drops to 0.46 and arm abduction to 0.57, because a single camera cannot see depth well.

The same repetition, filmed by the two cameras, gives different angles: the deepest knee bend differs by 12.5 degrees on average in squats, a leg lift by 21 degrees, an arm lift by 38 degrees in arm abduction. That is the size of the measuring error from one camera.

## 6. Is the limit the camera, or the labels? (`ceiling_check.py`)

REHAB24-6 was recorded in a motion-capture lab. Besides the videos, it contains joint positions measured by markers on a body suit, far more precise than anything a webcam model can guess from a flat picture. `ml/ceiling_check.py` runs the same features and the same honest test twice: once on MediaPipe's body points (what the browser will see) and once on the motion-capture joints.

| Exercise | MediaPipe (full model) | Motion capture | Gap |
|---|---|---|---|
| Squat | 0.71 | 0.89 | 0.18 |
| Lunge | 0.61 | 0.75 | 0.14 |
| Leg abduction | 0.75 | 0.76 | 0.01 |
| Arm abduction | 0.69 | 0.83 | 0.14 |
| Arm VW | 0.70 | 0.68 | -0.02 |

(Best of logistic regression and forest. Measured before the timing features were added. The motion-capture side has one sample per repetition instead of two and leaves out 15 repetitions the dataset flags as faulty, so the comparison is close but not exact.)

**What this tells us.** For the squat, lunge and arm abduction, a better ruler would add 0.14 to 0.18. So MediaPipe's depth error is a large part of the weakness. For leg abduction and arm VW the ruler is not the problem: there the limit is the labels and the small number of people.

**The first cheap fix we tried: MediaPipe's heavy model.** MediaPipe ships a slower, more accurate pose model ("heavy") next to the default one ("full"). We re-extracted the squats with it and ran the identical test (timing features included):

| Squat | Logistic regression | Random forest | AUC (logistic) |
|---|---|---|---|
| full model (default) | 0.72 | 0.66 | 0.82 |
| heavy model | **0.78** | **0.76** | **0.89** |

Both models and the AUC move the same way, and by more than the noise level, so this one is believed. The browser's PoseLandmarker can load the heavy model too; the training data and the demo have to use the same one. The other four exercises are being re-extracted with the heavy model (about an hour in the background). When that finishes, one command rebuilds the dataset and the notebook retrains everything (see section 9).

## 7. What would actually move the number, and what is still missing

In order of how much each is likely to help the demo:

1. **Record your own data in the demo setup.** This is the biggest lever and no public dataset can replace it. The public data has healthy 25 to 50 year olds in a lab with mistakes chosen per person. Your demo has your laptop camera, your room, your chair, and mistakes you choose on purpose. Plan from the product notes: three teammates, four clips each, about 15 reps per clip (good, too shallow, knees falling inward, leaning forward), the file name is the label, whole body in frame at about 2.5 metres. Because every teammate does the *same* named mistakes, the labels are much cleaner than in the public data, which is exactly what the model is missing. One teammate is held out as the "unseen person" test, and that number goes on the slide whatever it is. Built afterwards, see section 10.
2. **Use the heavy tracker everywhere.** Done for the squat (+0.06 to +0.10); running for the other four exercises. The session page must load the heavy PoseLandmarker model so it matches the training data.
3. **Rules for naming the mistake.** The model only gives a score. Spoken cues need rules that can say *what* went wrong: depth (deepest knee angle), knees falling inward (knee gap compared with hip width), leaning forward (trunk lean). We already compute all three; the thresholds should be set from the data you record in step 1.
4. **Do not expect a miracle from the public data.** Even with perfect motion capture, the best scores are 0.68 to 0.89 depending on the exercise. Leg abduction and arm VW would not improve with a better camera at all.

**Not built yet at all:** the WhatsApp bot, the browser session page (camera, rep counter, spoken cues, running the exported model), the physio dashboard, the LLM replies and the pain rule. The notes you pasted list these in a build order; the model work here covers only the first model-related items.

**A note on competitors.** The two repos you linked (Johnny's `Front-end-human-body-pose-3D-detection` and `SquatsCorrector`) contain no trained model and no measured accuracy. One is a four-file page that draws the skeleton on a camera feed; the other is a script with fixed thresholds (knee angle under 70 degrees, a head-height rule for counting). So there is no score there to compare against. I did not look up the commercial products (Sword, Hinge, Kemtai), and no accuracy figure for them appears in the notes you pasted. They presumably train on far more data than a hackathon team can collect, and a number only means something if it says whom it was tested on. The only fair comparison we can make is a number measured on a person the model has never seen, with the test described, which is what this project reports. The pasted notes also say copying code is banned at YHacks, so the squat script's ideas (two-threshold rep counting, waiting for 30 bad frames before speaking) must be rewritten from scratch, not copied.

## 8. Honest limits, for the slide

- **Licence:** REHAB24-6 is for non-commercial research. Fine for a hackathon. Say that a product would train on consented patient data from pilot sites.
- **Who was filmed:** healthy adults aged 25 to 50 in a lab, not older patients at home. The scores above are for people like them.
- **One camera is a rough ruler.** The same repetition filmed by two cameras gives knee angles that differ by about 12 degrees, and a hip-lift angle by about 20. Show trends over weeks, never a clinical measurement.
- **We compared several models on the same test and kept the best,** so the best number is slightly flattering. A fresh person never used for comparison, such as your own recordings, is the fair check.
- **jHealth does not diagnose.** The physiotherapist prescribes; jHealth measures, coaches and reports.

## 9. How to rerun, and where

Everything is in `~/jhealth`. The model is small (logistic regression on about 188 numbers, plus a 26,000-parameter network), so **retraining runs on this laptop in about three minutes. You do not need Colab or a GPU.** What takes time is step 1 (the pose tracker over videos), not training.

From `~/jhealth/ml`:

```bash
~/jhealth-cache/venv/bin/python extract_poses.py --model heavy
```

```bash
~/jhealth-cache/venv/bin/python build_dataset.py --landmarks landmarks_heavy
```

Then open `ml/train_model.ipynb` in VS Code, choose `~/jhealth-cache/venv/bin/python` as the kernel and press Run All. The first command skips videos that are already done, so it is safe to stop and restart. The second writes `ml/data/reps.npz`, which the notebook reads.

Colab is optional: it is useful only to give the notebook to a teammate or if you later train a much bigger network. To use it, upload `ml/train_model.ipynb` and `ml/data/reps.npz`, then press Run all.

## 10. Training on your own clips (added later the same day)

**Why.** Section 7 says your own recordings are the biggest lever. This section is the machinery for it, built and tested before any recording exists, so that when the clips arrive it is three commands.

**What was built.**
- `ml/extract_clips.py` runs the pose tracker on each clip, measures the knee angle over time, and cuts the clip into single squats. The rule is simple: every dip of the knee angle that is at least 15 degrees deep and at least 0.8 seconds from the next is one squat; it starts and ends when the knee is back near standing, plus 0.4 s of standing before and 0.5 s after. The person comes from the folder name, the label from the file name. It writes a picture per clip and a table, so a bad clip is obvious before anything is trained.
- `ml/train_own.py` hides each teammate in turn and tests on them. It compares three ways of training: on your clips only, on the public data only, and on both together with your clips counted three times as much. That is the "fine-tuning" question answered with numbers. It also trains a second model that names the fault, suggests thresholds for the spoken-cue rules from your own good and bad squats, and exports `ml/models/squat_demo.json`.
- `docs/RECORDING.md` tells the team how to record, what each mistake looks like, and how to name the files.
- `ml/notebook_code.py` lets these scripts reuse the notebook's feature code instead of keeping a second copy.

**Validating the rep cutter.** The cutter was written from scratch (copying code is banned at YHacks). To check it, I ran it blind over the public squat videos and compared with the physiotherapist's hand-marked start and end of each squat (`ml/check_segmenter.py`):

| Setting | Recall | Precision | Overlap with the physio's marks | Start / end offset |
|---|---|---|---|---|
| No padding | 0.97 | 0.99 | 0.72 | +0.37 s / -0.50 s |
| Padding 0.4 s before, 0.5 s after (chosen) | 0.98 | 1.00 | **0.90** | -0.03 s / -0.03 s |
| Same, minimum depth 15 degrees | 1.00 (195 of 195) | 1.00 | 0.90 | -0.03 s / -0.03 s |

The first row had a clear bias: the physiotherapist's window includes standing time before and after the bend, so our squats came out about 0.9 s shorter. That would have made our clips look different from the public data and spoiled any mixing of the two. The padding fixes it. (These numbers use the heavy tracker; with the default tracker recall is 0.98 and overlap 0.88.)

**Running it on real video.** I cut 17 clips out of four people's public squat videos (`ml/make_standin_clips.py`), named like real recordings, and ran the whole pipeline. Every clip returned exactly the number of squats cut into it (86 of 86), the pictures looked right, and training, the three-way comparison, fault naming, threshold suggestions and the JSON export all ran. The first attempt also exposed a usability problem: MediaPipe prints dozens of harmless warnings that buried the table, so the script now hides them.

**What this does not prove.** The stand-in clips come from the public data, so their scores mean nothing, and the "public only" and "pooled" lines in that test are inflated because the hidden person is also in the public data. The first real score will come from your teammates' clips. A rep cutter that works on lab squats may need its settings adjusted for phone video; the pictures will show it quickly.

## 11. The squat model reaches 0.80, and heavy work moves to Colab (later that evening)

**The laptop.** The heavy-tracker extraction ran for about 90 minutes and stalled at 86 of 92 videos once the laptop ran out of memory (79 MB free, 11 GB of swap in use). It was stopped, and so was everything else started for this project. About 1.7 GB of re-creatable files were deleted: the Python package download cache, the app's build cache, half-downloaded videos, raw test videos and raw motion-capture files whose results were already saved. No dataset was ever downloaded whole: each video was streamed out of the archive, processed and deleted. What stays is small: body points (about 200 MB), the Python environment (1.1 GB) and the web app's packages (0.4 GB).

**The squat model.** `ml/train_squat.py` compares models on the heavy-tracker squats with the same honest test (macro F1 on unseen people):

| Model | Macro F1 | AUC |
|---|---|---|
| Logistic regression, default tracker (before) | 0.72 | 0.82 |
| Logistic regression, heavy tracker | 0.78 | 0.89 |
| Random forest, heavy | 0.76 | 0.85 |
| Gradient boosting, heavy | 0.76 | 0.87 |
| Average of logistic + forest, heavy | 0.79 | 0.88 |
| **Average of logistic + forest + boosting, heavy (exported)** | **0.80** | **0.89** |
| Logistic + motion-capture joints added to training | 0.77 | 0.89 |

The exported model reproduces scikit-learn exactly, and the browser reproduces it too (`scripts/pose.test.ts`). The app now loads it, with the heavy tracker. For comparison, the motion-capture ceiling from section 6 is 0.89: the remaining gap is mostly the camera.

**Colab.** `ml/colab_train.ipynb` (generated by `ml/tools/make_colab.py`) does the whole pipeline on Google's computers. See the README.

**Datasets for the exercise list (sit-to-stand, seated knee extension, arm raise):**
- **UI-PRMD** (University of Idaho): sit-to-stand, deep squat and standing shoulder abduction, among 10 exercises; 10 healthy people, 10 correct and 10 incorrect repetitions each. It is skeleton data from Vicon and Kinect, not video, and public domain, so it can be used commercially. It would need the same joint mapping used for the motion-capture check. This is the best public source for sit-to-stand.
- **KneE-PAD** (Scientific Data, 2025): real knee patients doing squat, seated knee extension and gait, labelled correct or incorrect. But it records wearable muscle and motion sensors, not video, so a camera model cannot learn from it.
- **Seated knee extension on camera:** no public labelled camera dataset was found. Your own recordings are the way.

## 12. Sit-to-stand from UI-PRMD, and what the numbers really mean

**Finding the data.** UI-PRMD's university page is gone and its PubMed page sits behind a CAPTCHA. The authors archived it on Zenodo (record 23104965), with a README and their MATLAB viewer. Sit-to-stand is movement m05.

**Kinect or Vicon.** The Kinect files store only the waist as a real position; every other joint is a bone offset in its parent's rotated frame, and the authors' viewer says its leg rebuild is wrong for sit-to-stand. The Vicon files store real lab positions of 39 markers (checked from the numbers: a stored offset keeps a constant length, a real position wanders). `ml/uiprmd.py` converts them into MediaPipe's 33-point layout and checks the result is believable.

**Results** (leave one person out, 10 people, 199 repetitions; one skipped for missing markers):

| Model | Macro F1 | AUC |
|---|---|---|
| Logistic regression (exported) | 0.90 | 0.98 |
| Random forest | 0.83 | 0.93 |
| Gradient boosting | 0.80 | 0.91 |
| Average of the three | 0.81 | 0.96 |

**The catch.** These scores are on motion capture. `ml/transfer_check.py` measures what happens on camera, using REHAB24-6 squats, which have both:

| Trained on → tested on | Macro F1 | AUC |
|---|---|---|
| camera → camera | 0.78 | 0.89 |
| motion capture → motion capture | 0.83 | 0.93 |
| motion capture → camera | **0.55** | 0.69 |
| motion capture → camera, each on its own scale | **0.69** | 0.74 |

So a motion-capture model used raw on a webcam is close to guessing. Calibrating it (the camera's own averages, no labels) recovers a good part. `ml/calibrate_camera.py` does that from a few recorded sit-to-stand clips. Until it has been run, the app scores sit-to-stand with the camera-trained squat model and says so on screen. The model-choice order is unit-tested (`web/scripts/loader.test.ts`).

## 13. The AI coach answers WhatsApp messages (Adaption)

**Why.** Until now only pain messages got an answer. "Ok I'm ready", "can I do 3 sets?" or "how do I do the knee extension?" were stored and ignored. The user wanted no OpenAI bill and had Adaption credits.

**What Adaption is.** adaptionlabs.ai sells four things: hosted language models (an OpenAI-compatible Chat Completions API), "Adaptive Data" (generate or clean text datasets), "AutoScientist" (fine-tune language models) and "inference stacks" (a saved model + files + memory). Only the hosted models are useful now. Prices are credits per million tokens; one coach reply is about 2,000 tokens in and a few hundred out, so 2,500 credits is millions of replies. The stacks' built-in memory was not used on purpose: the physio must see and correct what the coach remembers, so memory stays in our own `memories` table.

**How it works** (`web/src/lib/coach/`):
- `adaption.ts`: one HTTP call, a 25-second timeout, the key from `ADAPTION_API_KEY`.
- `prompt.ts`: the rules for the model, the patient's context as one quoted block, the JSON shape it must answer in, and the checks on its answer (medicine guard, Start button rules, pain hold, memory filtering, length). Pure code with unit tests in `web/scripts/coach.test.ts`.
- `reply.ts`: loads the context from the database, calls the model, saves the reply, facts and alerts. Any failure sends a short fallback reply instead of silence.
- The webhook answers Meta first and runs the coach afterwards (`after()`), so a slow model never makes Meta retry.
- New migration `20261119120000_coach_alerts.sql`: alerts can come from the coach (kind `coach`).

**What was learned trying the models.** The Gemma models broke on the strict JSON format (they wrote one field, then whitespace until the token limit). GLM, DeepSeek and Qwen handled it. Reasoning models spend most of their output on hidden thinking, so the token limit is set generously (2,000).

**Checked end to end** on a separate test database with the fake WhatsApp API:
- "ready to exercise" got a reply with the Start button.
- "only after 8 pm now, new job" was saved as a fact.
- "knee a bit swollen" got stop / 811 and an alert.
- The Advil question got the medicine reply and an alert.
- "sharp pain 8/10" was answered by the pain rule, not the AI.
- Afterwards "it feels better, send me the link" was refused politely until the physio reviews the alert.

**Choosing the model** (`npm run coach:eval`, 18 made-up messages, automatic checks, answers read by eye): GLM 5.3 Flash passed 18 of 18 at about 5 seconds and 0.47 credits per 1,000 replies, and it became the default. DeepSeek V4 Flash, Qwen 3.8 27B and GLM 5.2 each failed one check. Qwen 3.5 397B mostly returned nothing in time. Reading the answers showed one more problem: the model promised to "let you know what they say", which the system cannot do. One line in the rules fixed it, and the re-run still passed 18 of 18. The full table is in the README ("The AI coach").

**A bug found by looking at the dashboard.** After "it feels better now", the model replaced the pain rule's "Reported pain 8/10" fact with "feels better", so the pain history vanished from the physio's list (the alert itself stayed). Pain facts can now only be added to, never replaced. The check is in code and unit-tested, not just written in the rules.

## 14. Four exercises, three more datasets, the redesign (night of 19 November)

The full plain-words account is in `docs/HOW_WE_BUILT_IT.md`, section 5. The short technical version:
- New datasets, each converted to MediaPipe's 33-point layout and cut into reps by its own script: REHAB26-ViewAngles (`ml/rehab26.py`, streamed, 554 squats and 556 arm abductions × 3 iPhones), IntelliRehabDS (`ml/irds.py`, Kinect, 1,457 arm raises from 29 people incl. patients), more UI-PRMD movements (`uiprmd.fetch_movement`).
- `ml/train_exercise.py`: any exercise from every source, leave-one-person-out per test source, strategies (own source, camera sources, all, all per-source scaled), `--export` with an exact-reproduction check; `ml/make_parity.py` writes a browser parity example per model; `ml/mistake_check.py` scores each named REHAB26 mistake.
- Results (macro F1, unseen people): squat camera 0.79 / 0.79 (REHAB24 / REHAB26, exported), lab 0.83; sit-to-stand lab 0.90; arm raise lab 0.97 (UI-PRMD), 0.82 (IRDS patients), camera 0.66 (exported). Dropped after measuring: per-person calibration, 2D image features, lab data in camera arm training, per-source scaling.
- App: `web/src/lib/pose/exercises.ts` profiles (rep signal, counter settings, live value, stored measure, fault rules), `CameraSession.tsx` uses them, sessions store `rom_deg` (migration `20261119130000_four_camera_exercises.sql`), `model.ts` supports `input_scale`, 26 unit tests, 41 database checks.
- Own clips: `extract_clips.py` / `train_own.py --exercise`, `docs/RECORDING.md` rewritten for four exercises.
- Redesign of every page (visual only), done by a helper and checked from its screenshots.
