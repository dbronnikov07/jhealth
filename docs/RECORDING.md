# Recording guide: clips for the jHealth demo models (all four exercises)

The public datasets have healthy adults in a lab, filmed by fixed cameras. Our demo has our own laptop camera, our own room and our own chair. A model trained on clips recorded **the way the demo is filmed** will be better at the demo than any amount of public data, and because every teammate does the *same named mistakes*, the labels are far cleaner too. This is also the honest test for the slide: the score is measured on a teammate the model never saw.

**What we need:** 3 teammates × 4 exercises × 4 clips × about 10 to 15 reps. About 10 minutes of filming per person.

**Where the files go:** `clips/<exercise>/<person>/<label>_<n>.mp4`, for example `clips/arm_raise/anna/bent_elbow_1.mp4`. The four exercise folders are `squat`, `sit_to_stand`, `seated_knee_extension`, `arm_raise`.

## The four exercises and their mistakes

Every clip: stand (or sit) still for 2 seconds, do the reps, stay still for 2 seconds. Do **the same thing in every rep of a clip**, clearly but realistically.

| Exercise (folder) | Camera | `good` | Mistake clips (file name = label) |
|---|---|---|---|
| `squat` | front or 45°, whole body | controlled squat to about thighs parallel, knees over toes, chest up | `shallow` (only a third of the way down), `knees_in` (knees fall toward each other), `lean_forward` (chest far forward) |
| `sit_to_stand` | 45° from the front, whole body and chair | from standing: sit down slowly, stand up fully, arms crossed | `uses_hands` (push off the thighs or chair), `not_upright` (don't straighten up at the top), `too_fast` (drop into the chair) |
| `seated_knee_extension` | **side-on**, chair and whole leg in view | straighten one knee until the leg is level, hold 2 s, lower slowly | `not_straight` (stop halfway), `no_hold` (straighten and drop at once), `lean_back` (lean the trunk back as the leg goes up) |
| `arm_raise` | front, whole upper body and hips | straight arm out to the side up to shoulder height, lower slowly, body still | `not_high` (only halfway), `bent_elbow` (elbow clearly bent), `body_sway` (lean to the other side to get the arm up) |

Start sit-to-stand clips **standing** (the counter counts a sit-down plus stand-up, like the lab data). Seated knee extension: one leg per clip is fine; the software finds the working leg.

## 1. Set up the camera (this matters more than anything else)

- **Use the camera the demo will use** (the demo laptop). Filming with a phone is fine if it is the only option, but the demo laptop is better.
- **The whole body must be in the picture, feet included, the whole time.** Stand about 2.5 metres from the camera. Put the laptop on a table or a chair so the camera is about hip to chest height and level (not tilted up or down). Do a test squat and look at the preview.
- **Face the camera.** The demo is a front view.
- **Light:** bright room, light on you, no window behind you. Wear shorts or leggings so the knees are visible, not baggy trousers.
- **Only one person in the picture.** Ask others to stay out of view.
- If the demo uses a chair (a squat to a chair), put the same chair behind you and use it the same way in every clip. The software finds every dip of the knee angle, so it works for both.

## 2. What to do in each clip

The table at the top lists every exercise's labels. A clip is 10 to 15 reps at a normal pace, still for 2 seconds at the start and end. Each teammate records the `good` clip and the three mistake clips for every exercise. If you want more data, record a second `good` clip.

## 3. Name the files exactly like this

Put each clip in a folder named after the exercise, then the person, and name the file after the label:

```
clips/
  squat/
    anna/
      good_1.mp4
      shallow_1.mp4
      knees_in_1.mp4
      lean_forward_1.mp4
    ben/
      ...
  arm_raise/
    anna/
      good_1.mp4
      not_high_1.mp4
      bent_elbow_1.mp4
      body_sway_1.mp4
  sit_to_stand/ ...
  seated_knee_extension/ ...
```

- The **folder** is the person (lower case, one word). The test hides one person at a time, so the folder name must be right.
- The **file name** is the label from the table at the top (for example `good`, `shallow`, `knees_in`), then `_1`, `_2` and so on. Anything after the label other than a number is not allowed.
- **Rename the camera's default names** (`IMG_1234.MOV`, `VID_2026...`). The software reads the name as the label and will warn you.
- `.mp4`, `.mov`, `.m4v`, `.webm` all work. A phone held upright (portrait) works too.

The folder is `~/jhealth/clips/`.

## 4. Turn the clips into a model (three steps)

All commands run from `~/jhealth/ml`.

**Step 1. Cut the clips into single reps** (about 1 minute of computer time per clip the first time). Once per exercise:

```bash
~/jhealth-cache/venv/bin/python extract_clips.py --exercise squat
```

(`--exercise sit_to_stand`, `--exercise seated_knee_extension`, `--exercise arm_raise` for the others. The heavy pose tracker is slow on this laptop; Colab is the alternative.)

**Step 2. Check what it found.** The table lists every clip and how many reps it found. Anything near what you did is fine. If a clip says 9 and you did 15, or there is a note in the last column, open the matching picture in `~/jhealth/clips_report/<exercise>/`. It shows the rep signal (the knee angle for squats) over time with every found rep in green and every skipped dip as a red cross. Usual causes: part of the body out of the picture, a squat too shallow to count, or not standing fully upright between squats. Re-record that clip.

**Step 3. Train and test** (again once per exercise):

```bash
~/jhealth-cache/venv/bin/python train_own.py --exercise squat
```

It hides each teammate in turn and tests on them, compares training on your clips only, on the public data only, and on both together, and picks the best. It prints the score for the slide, whether it can name each mistake, and suggested thresholds for the spoken cues ("knees in" when the knee gap is below X). The model is saved to `ml/models/<exercise>_demo.json` and copied into the web app, which then prefers it.

## 5. Rules that keep the test honest

- **Do not re-record only the clips that scored badly** and then quote the new score. That quietly fits the test. Fix recording problems (the pictures show them) before training, not after.
- **The score on the slide is the "best" line of Step 3**, and it is measured on a teammate the model never saw. Say how many people it is.
- With three people, one hard-to-track teammate moves the score a lot. That is normal; say so.

## 6. Privacy

The clips show faces. They stay on the laptop in `~/jhealth/clips/`; nothing in the pipeline uploads them. Do not post them. Everyone in a clip should agree to it, and for anyone under 18, a parent or guardian too, as the YHacks forms already require.

## Sit-to-stand clips (to calibrate the sit-to-stand model)

The sit-to-stand model was trained on laboratory motion capture. Before the app trusts it on the camera, it needs a few
camera clips to calibrate against. No labels are needed: any mix of good and imperfect repetitions works.

- Each teammate records **two clips of about 10 sit-to-stands** with the demo camera and chair, set up as above.
  Start and end each clip standing, and stand up fully every time.
- They are the same clips as above: `clips/sit_to_stand/<person>/...`. Then, from `~/jhealth/ml`:

```bash
~/jhealth-cache/venv/bin/python extract_clips.py --exercise sit_to_stand --expected 10
```

```bash
~/jhealth-cache/venv/bin/python calibrate_camera.py --own data/own_sit_to_stand.npz
```

With labelled clips (good and mistakes), `train_own.py --exercise sit_to_stand` trains a camera model directly, which is better still.

The app then scores sit-to-stand with the calibrated model instead of the squat stand-in.

## Try it before recording

`ml/make_standin_clips.py` cuts a few real public-dataset squat videos into clips named like these, so you can run Steps 1 to 3 immediately and see what the output looks like. The scores from those clips mean nothing (they come from the same data as the public set); the point is to see the pipeline work.
