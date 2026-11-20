# How Motiva Health was built, in plain words

This is the whole story of this project, from the first message to now, written for someone who has never trained a model before. It says what was done, how, why, what went wrong and what the numbers mean. The more technical diary is `docs/WORKLOG.md`; the "how do I run it" guide is `README.md`.

---

## 1. What Motiva Health is

Motiva Health helps people do their physiotherapy exercises at home after a knee or hip operation, and tells their physiotherapist how it is going.

- **The patient** gets a WhatsApp message with a **Start session** button. The button opens a web page on their phone or laptop. The page turns on the camera, counts their repetitions, scores each one, and speaks short tips ("Knees out, over your toes").
- **The physiotherapist** has a dashboard that shows every patient: who is exercising, who stopped, whose progress has stalled, who reported pain.
- **A WhatsApp coach** answers the patient's messages. Pain and danger signs are handled by fixed rules; everything else by an AI that is checked by code.

The video never leaves the patient's device. Only numbers (rep counts, angles, scores) are sent.

---

## 2. The big picture

There are two halves.

**Training (done once, on a computer):**
videos of people exercising → a pose tracker finds 33 body points in every frame → we turn the points into angles (knee bend, trunk lean, ...) → a model learns, from repetitions a physiotherapist marked correct or wrong, to tell the two apart → the model is saved as a small file the website can run.

**The live product (every session):**
WhatsApp button → session page (camera, body points, rep counter, the model scores each rep, rules name the mistake) → the numbers go to our server → the physio dashboard and a WhatsApp summary.

Three different tools do three different jobs:
- the **model** gives each repetition a quality score;
- **rules** say *what* went wrong and handle safety (pain, chest pain, a fall);
- the **AI (language model)** only writes friendly text, and code checks it.

---

## 3. The words you need

- **Pose tracker (MediaPipe).** A free model from Google that looks at a video frame and finds 33 points on the body: shoulders, elbows, hips, knees, ankles and so on. It gives each point as a 3D position in metres. We use it in Python for training and in the browser for the live session, so both sides see the body the same way. It has three sizes: "lite", "full" and "heavy". Heavy is slower but more accurate.
- **Repetition (rep).** One squat, one stand-up, one arm raise. Everything is judged per rep.
- **Feature.** A number computed from a rep, for example "the smallest knee angle during this rep". The model only ever sees features, never pixels.
- **Model.** A formula with many adjustable numbers. Training means adjusting those numbers until the formula's answers match the physiotherapist's labels as well as possible.
- **Label.** The right answer for one example, given by a human: "this rep was correct", "this rep had a mistake".
- **Logistic regression.** The simplest model: it gives each feature a weight, adds everything up, and turns the sum into a probability between 0 and 1.
- **Random forest.** Hundreds of small decision trees ("is the knee angle below 95°? then is the trunk lean above 20°? ..."), each trained a bit differently; they vote.
- **Gradient boosting.** Also decision trees, but built one after another, each one fixing the mistakes of the ones before.
- **Ensemble.** Several models averaged. Usually steadier than any one of them.
- **Leave one person out (LOSO).** The honest test. Hide one person completely, train on everyone else, test on the hidden person. Repeat for every person. A real patient is always a new person, so this is the only test that predicts real life. If the same person is in training and test, the model can cheat by recognising the person instead of the mistake; that "lazy" test gave 0.83 to 0.90 on data where the honest test gives 0.59 to 0.75.
- **Macro F1.** The score we report everywhere. It averages how well the model does on the "mistake" reps and on the "correct" reps. 1.0 is perfect. Always answering "correct" scores about 0.35 to 0.4. Plain accuracy is easy to fool (if 70% of reps are correct, saying "correct" every time is "70% accurate"), so we do not lead with it.
- **AUC.** Another score from 0.5 (guessing) to 1.0 (perfect): how often a random wrong rep gets a worse score than a random correct rep.
- **Motion capture (mocap).** A lab system with many cameras and reflective markers on a body suit. Far more precise than one webcam. Some datasets were recorded with it.
- **Kinect.** A depth camera (it measures distance) that also estimates a skeleton. Some datasets use it.
- **Fine-tuning.** Taking something already trained and training it a bit more on your own data. Section 8 explains what that means in this project.

---

## 4. Day 1 (18 November): from a PDF to a working model

### 4.1 Reading the inputs and designing the system
I read the old pitch deck, the pasted plans and the hackathon page (YHacks 2026: build days 15 to 20 November, pitch on 21 November at York University). The target users are older adults recovering from knee and hip replacement; the buyer is the clinic. The system design in section 2 came first, then the data.

### 4.2 Choosing the data
We needed videos of people doing rehab exercises, where a physiotherapist marked each repetition correct or wrong. The best fit was **REHAB24-6** (Zenodo, 2024): 10 healthy adults, 6 exercises, two cameras, every rep labelled, plus motion-capture positions of the same reps. Licence: research only (fine for a hackathon; a product would use its own consented data).

The videos are one 2.6 GB file. Downloading it whole would have filled the laptop, so `ml/extract_poses.py` **streams one video at a time out of the archive** (10 to 40 MB), runs the pose tracker on it, keeps only the body points, deletes the video and moves on. Nothing big is ever stored.

### 4.3 First check before spending an hour
On one squat video I compared MediaPipe's knee angle with the physiotherapist's rep boundaries. In all 27 reps the deepest knee bend fell in the middle of the marked rep. That proved the timing of the labels and the tracker agree, so the plan could work.

### 4.4 Turning body points into features
- Every rep is stretched or squeezed to exactly 64 frames, so a slow rep and a fast rep have the same shape.
- For each frame we compute angle-type signals: 17 for leg exercises (knee angle, hip angle, how far the knees are apart compared with the hips, trunk lean, ...) and 12 for arm exercises (shoulder angle, elbow straightness, wrist height, ...). Angles do not change with a person's height or where they stand; raw positions do.
- Each signal is summarised with 11 numbers: lowest, highest, range, average, how much it wiggles, when the lowest and highest happen, average speed, fastest speed, jerkiness, and first half versus second half. Squat: 17 × 11 + the rep's duration = **188 features per rep**.
- For one-sided exercises (one arm, one leg) the skeleton is mirrored so the working side is always called "right"; otherwise the model would have to learn everything twice.

### 4.5 Training and the honest test
We compared "always say correct" (the floor), logistic regression, random forest and a small neural network, all with the leave-one-person-out test. Result: about **0.70 macro F1** for every model family. When a simple model and a neural network tie, the limit is the data, not the model.

### 4.6 Finding the real limit
REHAB24-6 also has motion-capture positions for the same reps. Training the same way on those (a near-perfect ruler) gave **0.89 for squats** instead of 0.71. So a large part of the weakness was the webcam tracker's depth error, not the model.

Fixes that worked:
- **MediaPipe's heavy model** instead of the default: squat 0.72 → 0.78.
- **Averaging three models** (logistic + forest + boosting): 0.78 → **0.80** (AUC 0.89). This is the squat model the app uses.
Things that did not work (tried and measured): smoothing the body points, comparing each person with their own first reps, other tree models, adding the motion-capture data to training.

### 4.7 Your own clips
The biggest lever is data recorded **in the demo setup** (your camera, your room, mistakes done on purpose). So the machinery was built before any recording exists:
- `ml/extract_clips.py` cuts a clip into single reps (a rep is a dip in the knee angle), using the file name as the label (`knees_in_1.mp4`) and the folder as the person, and draws a picture of every clip so mistakes are visible.
- `ml/train_own.py` hides each teammate in turn, compares training on your clips only, the public data only, and both, and exports the winner.
- `docs/RECORDING.md` tells teammates how to film.
The rep cutter was checked against the physiotherapist's marks: it found **195 of 195** squats.

### 4.8 The laptop problems
The project first lived on the iCloud-synced Desktop; iCloud tried to upload the Python environment file by file and deleted a data file in the middle of a run. Everything moved to `~/jhealth` (code) and `~/jhealth-cache` (big files). Later the heavy-tracker extraction ran the 8 GB laptop out of memory; all jobs were stopped and 1.7 GB of re-creatable files deleted. Since then heavy jobs go to **Google Colab** (`ml/colab_train.ipynb`): Google's computers download, process and delete the data, and only the small model files come back.

### 4.9 Sit-to-stand
REHAB24-6 has no sit-to-stand. The best public source is **UI-PRMD** (University of Idaho, public domain): 10 people, each did sit-to-stand 10 times correctly and 10 times badly, recorded with motion capture. Its university page is gone and its paper page has a CAPTCHA (which we never bypass), so we used the authors' Zenodo archive. `ml/uiprmd.py` converts the lab's 39 marker positions into MediaPipe's layout (the hip joints are estimated from the pelvis markers with a standard formula from 1990) and checks the result moves like a real body. Score: **0.90**. But a test using REHAB24-6 (which has both camera and motion capture for the same reps) showed that a motion-capture model used directly on a webcam drops to about 0.55; putting each source on its own scale brings it back to 0.69. So the app only uses the sit-to-stand model after calibrating it on a few camera clips (`ml/calibrate_camera.py`).

### 4.10 The physiotherapist's dashboard and database
- **Database:** Supabase (hosted Postgres), with every rule enforced by the database itself: one active plan per patient, phone numbers in international format, nobody but the server can read anything (row level security on every table), a new patient is automatically linked to the default doctor. On the laptop the same SQL runs in PGlite (Postgres inside the app), so no account is needed to develop. `npm run db:verify` runs 41 checks on a fresh database.
- **Prescribing** is one database transaction: the plan, its exercises, and the WhatsApp message are saved together or not at all.
- **The dashboard** (Next.js) shows every patient with a status (needs review, stalling, inactive, new, on track), adherence, quality and knee-bend trends, open alerts, what the coach remembers, and the WhatsApp chat. 20 simulated patients make it look like a real clinic; they are clearly labelled "simulated".

### 4.11 WhatsApp
Built against Meta's WhatsApp Cloud API: sending the plan with a Start button, receiving messages (each one checked for Meta's signature), delivery receipts, WhatsApp's 24-hour rule (you may only send free-form messages within 24 hours of the patient's last message), and a **pain rule** in plain code: "sharp pain 8/10", chest pain, a swollen calf or a fall raise an alert for the physio and send a safety reply (Health811 / 911). A fake WhatsApp server (`npm run mock:whatsapp`) lets everything be tested without a phone.

### 4.12 The camera session page
In the browser: MediaPipe's heavy model, a live rep counter (checked against the physiotherapist's marks: 193 of 195 squats), the exported model scoring each rep (the browser's feature code is tested to give exactly the same 188 numbers as Python), spoken tips, an "It hurts" button, and pause/resume when the phone goes to the background.

### 4.13 The AI coach (Adaption)
Before, a normal message ("ok I'm ready") got no answer. Now Adaption's hosted language models answer, paid with the team's Adaption credits (about 0.5 credits per 1,000 replies). Order of trust: the pain rule first (an AI never sees those messages), then the AI writes a reply and suggests facts to remember, then code checks the answer (medicine mentioned → replaced; Start button only if the plan has a camera exercise and no pain alert is open; pain facts can never be overwritten). Five models were compared on 18 tricky made-up messages; GLM 5.3 Flash passed 18 of 18.

### 4.14 Connecting the real WhatsApp
Started in the evening: Meta developer account, the "Motiva Health Coach" app and a business portfolio. Meta refused the portfolio because the Facebook account was created minutes earlier ("try again in an hour"). An hour later it went through: the **JHealth** business portfolio exists, and creating the app only waits for Meta to ask for the Facebook password again (which only the account owner types). The app runs, and a free Cloudflare tunnel gives Meta a public address; the dashboard is locked to the laptop unless a password is set, so patient pages are never public.

---

## 5. Night 2 (19 November): four exercises, more data, a better-looking app

You asked for: four exercises, F1 of at least 0.9 for each, the biggest datasets on the internet, a better-looking app, and this document. Here is what happened, in order.

### 5.1 Searching for every usable dataset
A research helper searched for public datasets where every repetition is labelled correct or wrong, for our four exercises. It checked about 25 candidates and verified each against its own page or paper. The useful new ones:

| Dataset | What it is | People | Used for |
|---|---|---|---|
| **REHAB26-ViewAngles** (Zenodo, 2026) | Three iPhones filming each rep from different angles (front to side), MediaPipe body points already extracted, every wrong rep labelled with its exact mistake | 5 | squat, arm raise |
| **IntelliRehabDS** (Zenodo, 2021) | Kinect skeletons; **real patients** (mostly after a stroke) and healthy people, standing, on a chair or in a wheelchair; every rep labelled by a physiotherapist | 29 | arm raise |
| **UI-PRMD** (already used for sit-to-stand) | Motion capture; also has deep squat, shoulder abduction and scaption | 10 | squat, sit-to-stand, arm raise |
| REHAB24-6 (already used) | Two cameras + motion capture | 10 | squat, arm raise |

Others were checked and rejected, with reasons: KIMORE gives one score per whole session, not per rep; Fitness-AQA is barbell gym squats and needs a request form; QEVD and EgoExo-Fitness need accounts and are research-only; the FMS Kinect set is a 1 GB archive of 0 to 3 scores; KINECAL has sit-to-stand but no quality labels; **no public dataset labels seated knee extension reps at all** (the closest are wearable-sensor data or videos without labels).

As before, nothing big is stored: REHAB26's 686 MB archive was read file by file over the network (only the squat and arm files, about 245 MB, were read and immediately cut into reps), and IntelliRehabDS's 199 MB skeleton file was downloaded, converted and deleted (its 40 GB of depth images were never touched). Converting the Kinect skeleton needed care: the Kinect's x axis points to the sensor's left and y points up, so it is turned 180 degrees about the depth axis to match MediaPipe without swapping left and right (`ml/irds.py`).

### 5.2 One honest test for everything (`ml/train_exercise.py`)
One script now trains any of the four exercises from every dataset that has it, and always tests on people the model never saw. It hides each person of the test dataset in turn and trains on everyone else, from every dataset. It compares: the test dataset alone, all datasets together, camera datasets only, and all datasets "each on its own scale" (each dataset's numbers shifted and stretched to the same average and spread, which removes much of the difference between a camera and a lab).

### 5.3 The results, honestly
Macro F1 on people the model never saw (1.0 = perfect, always saying "correct" ≈ 0.35):

| Exercise | Measured with lab equipment (motion capture / Kinect) | Measured with a camera and MediaPipe (what the app uses) |
|---|---|---|
| Squat | 0.83 (UI-PRMD) | **0.79** (REHAB24) and **0.79** (REHAB26 phones), one model trained on both camera datasets, 14 people |
| Sit-to-stand | **0.90** (UI-PRMD) | no labelled camera data exists anywhere public |
| Arm raise to the side | **0.97** (UI-PRMD), **0.82** (IntelliRehabDS stroke patients) | 0.66 (REHAB24 and REHAB26), one model trained on both camera datasets |
| Seated knee extension | no labelled data exists anywhere public | rules only (section 5.5) |

**So did we reach 0.9?** With lab-quality body points: yes for sit-to-stand (0.90) and arm raise (0.97). With a webcam, no public dataset gets there, and the reason is clear from the numbers: the same people and the same reps score 0.89 with motion capture and 0.80 with a camera, and every camera dataset has only 5 to 10 healthy people whose "mistakes" were chosen differently for each person. Anyone who reports 0.9+ on a webcam either tested on people the model had already seen, or recorded their own consistent data. The honest route to 0.9 on the demo camera is the second one: your own clips (section 5.6).

**Catching specific mistakes.** REHAB26 names every mistake, so we also tested how well each one is caught on unseen people, from any camera angle (`ml/mistake_check.py`): too-shallow squat 0.86, lifted heels 0.86, knees forward 0.74, arm too low 0.75, bent arm 0.72. Subtle ones (torso tilted, shoulder hitched, head tilted) are near guessing from one camera at a random angle. That is why the app names only the mistakes a camera can actually see.

**Things tried tonight that did not help** (all measured, all dropped):
- Calibrating to each person (comparing them with their own average): 0.80 → 0.72 to 0.75.
- Adding 2D image-plane angles to the 3D ones: squat 0.80 → 0.78, arm 0.65 → 0.68 (noise).
- Mixing the lab datasets into the camera training for arm raises: worse on camera (0.61 to 0.66).
- Putting each dataset on its own scale: no gain on camera.
- Camera angle: on REHAB24 the side view scored best (0.82 vs 0.68 from the front), but on REHAB26 the angle made little difference (0.65 to 0.75), so we do not claim a best angle.

**Which models the app now uses, and why.** For the squat, a model trained on both camera datasets (14 people) scores 0.79 on REHAB24 and 0.79 on REHAB26. The old REHAB24-only model scored 0.80 on REHAB24 but only 0.72 on REHAB26's phones. A patient's phone is a camera the model has never seen, so the one that holds up on both was chosen. The arm-raise model was picked the same way. Both are averages of three models (logistic regression, random forest, gradient boosting), saved as JSON (about 3 to 4 MB each).

### 5.4 Four exercises in the app
The app used to know only squats. Now each exercise has a profile (`web/src/lib/pose/exercises.ts`, mirrored in `ml/exercises.py`):

| Exercise | How a rep is counted | What is shown and stored | Mistakes the rules name |
|---|---|---|---|
| Chair squat | a dip of the knee angle | deepest knee bend | knees in, not standing up fully, too fast |
| Sit-to-stand | a dip of the knee angle (start standing) | deepest knee bend | knees in, not upright, sitting down too fast |
| Seated knee extension | the straighter knee straightening | straightest knee angle | not straight, no 2-second hold, leaning back, lowering too fast |
| Arm raise to the side | the higher arm going up | highest arm angle | not up to shoulder height, bent elbow, body swaying, too fast |

The database got the two new exercises, seated knee extension became camera-scored, and sessions now store a "range of motion" for exercises where progress is not a knee bend. A new test builds synthetic skeletons frame by frame (a seated person straightening a knee, a standing person raising an arm) and checks that each exercise counts exactly one rep and names exactly the right mistake.

### 5.5 Seated knee extension without data
Since no labelled data exists, this exercise is scored by rules a physiotherapist can read: the knee must reach 150° or straighter, stay within 8° of its straightest point for at least a second, the trunk must not lean back more than 15°, and lowering must take at least 0.8 s. The screen says "checked by movement rules". The first teammate clips will show whether the thresholds are right, and a model can be trained from them with the same command as every other exercise.

### 5.6 Your own clips, for all four exercises
`extract_clips.py` and `train_own.py` now take `--exercise`. `docs/RECORDING.md` lists, per exercise, the camera position, what a good rep looks like and three named mistakes to act out. About ten minutes of filming per teammate gives the only honest camera test of the demo setup, and the model it produces is automatically used by the app.

### 5.7 Checking that the browser really runs the same model
The models are trained in Python but run in the patient's browser, in a different language. A new script (`ml/make_parity.py`) saves one real repetition per model with Python's features and score; a test runs the browser's code on it. Both match to six decimal places (squat 0.060569, arm raise 0.490509). The arm-raise example is a left-arm repetition, which checks that the browser mirrors the body the same way Python does. Then the whole session page was run in a browser on a test video: 6 reps counted, each scored, nothing saved (so the demo data stays clean).

### 5.8 The redesign
A design helper rebuilt the look of the whole app (`web/src/app/globals.css` and the page layouts), without touching any logic:
- one typeface designed for people with low vision (Atkinson Hyperlegible), with measurements in its monospaced version so numbers read like an instrument;
- a deep blue accent, colour used only for patient status (needs review, stalling, inactive, on track) on the dashboard;
- a small goniometer drawing (the physio's angle tool) that shows each patient's knee bend, with last week's as a dashed line;
- adherence as one small bar per planned day; patients become cards on a phone screen;
- the patient pages in very large type with 64-pixel buttons, one obvious next step, and the safety notes in their own panel;
- light and dark mode, checked at phone width.

---

**Second design pass (afternoon).** A public landing page at `/` (the hero is a giant goniometer whose arm sweeps to the 88° knee bend shown in the phone mock-up; a mock WhatsApp chat; the four exercises drawn like a physio's exercise sheet; honest numbers with their test conditions; privacy showing exactly what is sent for one rep), an ink-blue top bar on the dashboard, clickable patient rows, a WhatsApp-style chat on the patient record, and a calmer camera screen where red only ever means pain. The dashboard stays password-protected; the landing page and privacy page are public.

### 5.9 Competitors, keeping people going, and fewer false alarms (19 November, afternoon)

**What the competitors do** (public pages and papers only; full table in `docs/SYSTEM_DESIGN.md`):
- Sword and Hinge are paid by employers and insurers and use their own physiotherapists, apps and sometimes hardware. Kaia was bought by Sword. Kemtai and Exer score movement by camera for clinics. Physitrack, Medbridge and Limber mostly rely on patients reporting what they did.
- **Nobody found does rehab on WhatsApp**, with the patient's own physiotherapist and camera-scored reps together.
- Almost all published adherence evidence is self-reported. Text reminders raise adherence a little in trials (for example 1.8 vs 1.3 exercise days a week in a knee arthritis trial), but no trial counted the reps. Motiva Health does.

**What we built from it:**
- **Celebrations after every session**: first session, streaks, session counts, a new personal best angle, the smoothest session yet. At most two lines, biggest news first.
- **A weekly goal** ("2 of 5 planned days this week"), copied as an idea from Hinge's weekly goal: one missed day does not wipe out progress the way a daily streak does.
- **The patient picks the reminder time** with WhatsApp buttons at welcome.
- **Daily reminders** with the Start button, the streak, and the patient's own goal in their words.
- **A comeback message after 3 days away** that asks "What got in the way?" with buttons (an idea from the ADHERE text-message trial): "I forgot" offers a new time, "It hurt" alerts the physiotherapist, "No time" says even five minutes counts.
- **A more upbeat AI coach**: its rules now say to praise effort, never guilt or scold, frame tips as "next time, try", and connect to the patient's goal and streak. A test checks every engagement message for scolding words; the coach evaluation now includes "sorry I skipped 3 days, was feeling down" and passes 19 of 19.

**Fewer false alarms.** You asked for precision. For a coach, precision means: when it tells a patient "that rep had a mistake", it should almost always be right, because a false alarm after a good rep is what makes people stop trusting it. `ml/operating_point.py` runs the honest test again, collects the probabilities for people the model never saw, and picks the cut-off where 9 in 10 flags are real mistakes:

| Model | At the usual cut-off (0.5) | At the chosen cut-off |
|---|---|---|
| Squat | right 74% of the time, catches 86% of mistakes | **right 90%**, catches 54% |
| Arm raise | right 64%, catches 71% | **right 92%**, catches 17% |

The quality score shown to the patient is unchanged; below the cut-off the app simply does not say "mistake". The movement rules still name visible mistakes (knees caving in, bent elbow).

## 6. "Fine-tuning", and how this compares with other approaches

**What people usually mean.** "Fine-tune MediaPipe on our own data" sounds like retraining Google's pose tracker. That would only make the body points slightly more accurate; it would not teach it what a *good* squat is, because the pose tracker has no idea what an exercise is. It also needs thousands of hand-labelled body points per image.

**What actually decides if a rep was good** is the second stage: a model that reads the body points over the whole repetition. That is the part we trained, and it is the part that has to learn from physiotherapist-labelled reps. Our "fine-tuning" is:
1. train on the public datasets (thousands of labelled reps from many people);
2. then train again with your own recorded clips mixed in and counted more (`ml/train_own.py`), so the model adapts to your camera, your room and your chair.

**Why our numbers are believable.** Every number in this project is measured on people the model never saw, with the test described. A project that quotes "95% accuracy" without saying it tested on new people is usually measuring the lazy test (section 3), which on our data inflates 0.70 to 0.90.

**About IMUs, LiDAR and ARKit.** Smartwatches and LiDAR can measure movement more precisely, but patients would need the device. A plain laptop or phone camera works for everyone who has WhatsApp, which is the point of Motiva Health.

---

## 7. How to check every claim yourself

All commands run on the laptop in seconds unless noted. From `~/jhealth/web`:

| Command | What it proves |
|---|---|
| `npm run test:unit` | pain rule, WhatsApp formats, signatures; the browser computes the same features and score as Python; the rep counter finds 193 of 195 physio-marked squats; the four exercise profiles count and name mistakes; the AI coach's safety checks |
| `npm run db:verify` | 41 rules the database enforces |
| `npm run coach:eval` | how each AI model handles 18 tricky messages (uses a tiny fraction of a credit) |

From `~/jhealth/ml` (Python: `~/jhealth-cache/venv/bin/python`):

| Command | What it proves |
|---|---|
| `train_exercise.py squat` (or `arm_raise`, `sit_to_stand`) | the model comparison tables in section 5, on unseen people |
| `train_squat.py` | the 0.80 squat model |
| `check_segmenter.py` | the rep cutter finds the physiotherapist's reps |
| `uiprmd.py --check` | the motion-capture conversion moves like a real body |
| `transfer_check.py` | how much a lab model loses on a webcam |

---

## 8. What is still missing

- **Your own recordings.** The single biggest improvement, and the only honest test of the demo setup. See `docs/RECORDING.md` (all four exercises).
- **WhatsApp on a real phone.** Needs the Meta business portfolio (retry after Meta's one-hour wait).
- **Clinical review.** Every message the patient sees (safety replies, AI rules, tips) is a draft until a physiotherapist approves it.
- **Older patients in the data.** Every public dataset here is mostly healthy adults aged 20 to 60; IntelliRehabDS adds some stroke patients.
