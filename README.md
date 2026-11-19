# jHealth

A rehab coach that lives in WhatsApp. The physiotherapist prescribes exercises; the patient gets a daily message with a Start button; a browser page watches each repetition through the camera and scores it; the physiotherapist sees who is doing the work and who is stalling.

Built for YHacks 2026, Pillar 2 (Healthcare: find, access and navigate the right support at the right time, while easing pressure on the system).

## Who it is for

**Adults recovering at home after a knee or hip replacement**, and people managing knee or hip osteoarthritis with a physiotherapist's exercise plan. Mostly aged 55 and up.

- Canada did more than 117,000 hip and knee replacements in 2021-2022 ([CIHI](https://www.cihi.ca/en/cjrr-annual-report-hip-and-knee-replacements-in-canada-2021-2022)).
- The knee is the most common joint with symptomatic osteoarthritis; the hip is fourth ([Arthritis Society](https://arthritis.ca/getmedia/36cbffb1-f1d3-4689-8cad-39ef47954840/OAReportSummary_EN)).
- Shoulder is the next body area to add. We found no Canadian figure that ranks it, so the pitch leads with knee and hip.

The buyer is not the patient. It is the hospital or clinic that is already paid for the rehab and cannot see what happens at home.

## How the system fits together

Two halves.

**Training (once, on a laptop).** Dataset videos → 33 body points per frame (MediaPipe) → angle signals per repetition (17 for a leg exercise, 12 for an arm exercise) → a model that says "mistake or not" → a small JSON model file per exercise.

**Live product (every session).**

| Part | What it does | Built with |
|---|---|---|
| WhatsApp chat | Daily nudge with a Start button, progress card, answers questions, pain rule | WhatsApp Cloud API |
| Session page | Opens from the button. Camera, skeleton, rep counter, the model scores each rep, spoken cue | Browser, MediaPipe, the JSON model |
| Server | Receives the numbers from a session, stores them, writes the chat replies | Next.js on Vercel, Supabase, one LLM call per message (Adaption's hosted models) |
| Physio dashboard | Adherence, quality trend, who is stalling, drafted visit note | Next.js page |

Video never leaves the patient's device. Only numbers (angles, rep counts, scores) are sent. That is the privacy answer.

Three jobs, three tools. The **model** scores how good a rep was. **Rules** name what went wrong and handle safety ("pain 8 out of 10" is plain code, never an LLM). The **LLM** only writes text.

## Doctor dashboard and database

The physiotherapist's side: a dashboard of patients, a page per patient where the doctor prescribes exercises, and what the coach remembers. Code in [`web/`](web/) (Next.js 16), database in [`supabase/`](supabase/).

**Run it on this laptop** (no Supabase account needed). The first command is needed once:

```bash
cd ~/jhealth/web && npm install
```

```bash
cd ~/jhealth/web && npm run dev
```

Then open http://localhost:3100. Without a `DATABASE_URL` the app runs a real Postgres inside itself (PGlite), stored in `~/jhealth-cache/pglite-dev` and built from the same SQL files Supabase uses. The badge in the top bar says which database is in use.

**The demo story:** Add patient → your name and your WhatsApp number → tick Sit-to-stand, Seated knee extension, Seated knee flexion → Prescribe. The plan is saved, the WhatsApp message is written in the same database transaction (it says "queued" until WhatsApp sending is built), and your row appears at the top of the dashboard marked Real. The 20 other patients are simulated and labelled.

**What the database itself guarantees** (checked by `npm run db:verify`, 27 checks on a fresh database):

- every new patient is linked to the one default doctor, automatically;
- a phone number must be in international format and can belong to only one patient;
- a patient has at most one active plan; a new plan replaces the old one, the message is queued, and either all of it happens or none of it does;
- an AI-generated or uploaded exercise video cannot be marked approved without recording which doctor approved it and when;
- every fact the coach remembers can point to the message it came from;
- row level security is on for every table with no public access, so the browser key can read nothing. Only the server reads the data.

## The live site (nothing runs on the laptop)

**https://jhealth-beta.vercel.app** (deployed 19 November 2026). The website runs on Vercel in Montreal; the database is Supabase's free plan in Canada (Central), created from inside Vercel, so there is one account (Vercel, signed in with GitHub). Patient data stays in Canada.

- **Dashboard:** https://jhealth-beta.vercel.app/doctor opens our sign-in page. The password is `DASHBOARD_PASSWORD` in `~/jhealth-cache/production-secrets.txt` (also stored, encrypted, on Vercel); you stay signed in on that device for 12 hours, and **Sign out** is in the top bar.
- **Secrets** live only on Vercel, marked sensitive (Vercel never shows them again), and in two private files outside the project: `~/jhealth-cache/production-secrets.txt` (dashboard password, reminder secret) and `~/jhealth-cache/production.env` (database address, from `vercel env pull`). Neither can be committed or uploaded.
- **Deploy a change** (from `web/`, with the dev server running so the attack test can run first): `npm run cloud:deploy`. Only the files listed in `web/.vercelignore` are uploaded: never keys, never the research test video.
- **Database changes:** add a new file to `supabase/migrations/`, then `npm run cloud:migrate` (applies only new files, then the seed). `npm run cloud:check` proves the database is still locked: row level security on every table, no rights at all for Supabase's public web API, every view obeying RLS, an encrypted connection.
- **Demo morning:** `npm run cloud:demo-reset` replaces the 20 simulated patients with fresh ones dated from today. Real patients are kept.

The local setup above still works the same and never touches the live database.

**Not built yet:** the coach's AI replies (free-text questions in WhatsApp get no answer yet), and AI video drafts.

## The camera session

The "Start session" button in WhatsApp opens the patient's page (`/s/<token>`). There is no login: the 64-character random token in the link is the key. A doctor can open the same page from the patient's record ("Patient's page ↗").

- **Camera-scored exercises** (chair squat, sit-to-stand, seated knee extension, arm raise to the side) open a full-width camera view. Each exercise has a profile in `web/src/lib/pose/exercises.ts` (same definitions as `ml/exercises.py`): what counts as a rep, what number is shown, and which mistakes the rules name. The page:
  - draws the skeleton;
  - counts repetitions out loud;
  - shows the live knee bend, knee straightness or arm height;
  - for squat and sit-to-stand, turns the knees red and says "Knees out" when they cave in;
  - scores every repetition with the exercise's exported model (or, for seated knee extension, the movement rules), shown as chips with a score out of 100, and names the mistake (for example "Hold it straight for two seconds", "Keep your arm straight").
- **Self-reported exercises** get a "Mark done" button.
- **"It hurts"** stops the session and runs the same safety path as a pain message in WhatsApp: an alert for the physio and a safety reply.
- **At the end, only numbers go to the server**, never video: rep count, quality, knee bend (or range of motion for knee extension and arm raise), mistakes. The doctor's dashboard updates within seconds, and WhatsApp sends a progress message comparing with last time, plus one tip.
- **It all runs on the device.** MediaPipe's engine and the pose model are served by the app itself, so a weak venue connection does not matter once the page has loaded.

**How it was checked:**

- **The browser computes the same 188 numbers as the Python notebook.** On the notebook's exported example the difference is at most 8 in a million, which is the gap between 32- and 64-bit floats, and the scores agree. Test: `scripts/pose.test.ts`.
- **The live rep counter, fed one frame at a time** through the public squat videos, found 193 of the physiotherapist's 195 hand-marked repetitions with no false ones. Test: `scripts/reps.test.ts`.
- **End to end in the browser**, on a recorded clip with 7 correct squats: 7 of 7 counted, average quality 97/100, then saved, shown on the dashboard, and the WhatsApp message queued.

**Rehearse or test without a camera:** add `?source=/test/your_clip.mp4&step=1` to a patient's page link, with the video in `web/public/test/`. `step=1` walks through the clip at exactly 15 frames per second of video, so the result is the same on any computer. Leave out `step=1` to play it in real time. This only works in development, or with `ALLOW_TEST_VIDEO=1`, which is also the stage fallback if the venue camera fails: record your own demo clip and play it. `web/public/test/` is git-ignored. The clip used for testing comes from the research-only public dataset and must not be deployed.

**Limits, said plainly:**

- **The model was trained on free squats, not sit-to-stand.** The scores are a placeholder until `train_own.py` produces `squat_demo.json` from your recorded clips. The page uses that file automatically once it is copied to `web/public/models/`.
- **The "knees in" and "stand up tall" thresholds are fixed numbers in `src/lib/pose/coach.ts`.** Set them from your clips: `train_own.py` suggests values.
- **A phone camera needs https.** Use your deployed address or a tunnel; `localhost` works only on the laptop itself.

## WhatsApp

What works (tested against a fake WhatsApp API that behaves like Meta's, see below):

- **Prescribing sends the plan** as a WhatsApp message with a **Start session** button. The button opens the patient's own page through a private 64-character link.
- **Anyone who messages the number becomes a patient**, linked to the default doctor, and gets a short welcome message.
- **The pain rule.** "Sharp pain, 8 out of 10", or red flags such as chest pain, a swollen calf or a fall, open an alert for the physio and save a pain fact with the patient's own words. The patient gets a safety reply pointing to Health811 or 911. It is plain code, not an AI, and it is unit-tested. The reply wording is a draft for a clinician to review.
- **WhatsApp's 24-hour rule.** Outside the window WhatsApp refuses the plan message. The dashboard says so in plain words, and it is sent automatically the moment the patient writes.
- **Delivery receipts** (sent, delivered, read) show on the dashboard, and a late or repeated receipt never moves a message backwards.
- **Webhook security.** Every webhook must carry Meta's signature, or it is refused. A message delivered twice is stored once.
- **Stale plans are never sent.** Saving a new plan cancels an older plan message that was never delivered.
- **Every other message gets an answer from the AI coach**, which can attach the Start button and save facts for the physio. See "The AI coach" below.

**Connect a real WhatsApp number** (Meta's free test number is enough for the demo):

1. At developers.facebook.com create an app (type Business) and add the WhatsApp product. Meta gives you a test number.
2. On **WhatsApp → API Setup**: copy the **Phone number ID** into `WHATSAPP_PHONE_NUMBER_ID`, generate an access token into `WHATSAPP_TOKEN`, and add your own phone as a recipient. The test number can only message up to 5 numbers you verify. A temporary token dies in about a day; before demo day, create a permanent one with a System User in Business Settings.
3. On **App settings → Basic**, copy the **App secret** into `WHATSAPP_APP_SECRET`. Pick any random text for `WHATSAPP_VERIFY_TOKEN`.
4. Meta must be able to reach the app over https. Either deploy it (Vercel plus Supabase), or tunnel this laptop: `brew install cloudflared`, then `cloudflared tunnel --url http://localhost:3100` prints an https address. Put that address in `PUBLIC_APP_URL`. The free tunnel gets a new address every time it starts, so update `PUBLIC_APP_URL` and Meta's Callback URL after each restart. Without `DASHBOARD_PASSWORD` the dashboard only opens on this laptop; through the tunnel it refuses, so patient pages are never public. The patient's session page and the webhook still work through the tunnel.
5. On **WhatsApp → Configuration**: set the Callback URL to `<that address>/api/whatsapp` and the Verify token to your `WHATSAPP_VERIFY_TOKEN`, then subscribe to **messages**.
6. Restart `npm run dev`. The top bar says WhatsApp connected. Send "hi" from your phone to the test number: you appear on the dashboard and get the welcome message. Prescribe, and the plan arrives with the Start button.

On demo morning, send "hi" from the demo phone first, so the 24-hour window is open.

**Rehearse without a phone or Meta account:** run `npm run mock:whatsapp`, which starts a fake WhatsApp API on port 3199 and records everything the app sends to `web/scripts/mock-whatsapp.jsonl`. Then point `WHATSAPP_API_BASE=http://localhost:3199` in `.env.local` at it, with made-up values for the other WhatsApp settings. To play the patient:

```bash
cd ~/jhealth/web && node scripts/fake-whatsapp.mjs text +14165550142 "sharp pain, 8 out of 10" "Test Patient"
```

Tests: `npm run test:unit` (pain rule, message formats, signatures) and `npm run db:verify` (39 database checks).

## iMessage (the main channel)

Patients text jHealth in iMessage, like Boardy and folk: on the website, **Text jHealth on iMessage** opens Messages with
the first message already typed (on a laptop, scan the QR code with the iPhone camera). Whoever texts becomes a patient,
gets the welcome, picks a reminder time by replying 1, 2 or 3, and gets the plan with a link to the camera page, which
iMessage shows as a preview card. Everything behind it is the same code as WhatsApp: pain rule, quick replies, AI coach,
dashboard.

**How it is wired (free, no number to buy):** jHealth has its own Apple ID, signed into Messages on a Mac. A small bridge
on that Mac (`web/scripts/imessage-bridge.mjs`, using the open-source [imsg](https://github.com/steipete/imsg) CLI)
posts each new text to the server and sends the replies the server queues. The Mac only connects out to the server, so
nothing on it is reachable from the internet. The Mac has to stay on and online while patients are texting.

**Run it (on the Mac, in Terminal, which needs Full Disk Access):**

```bash
cd ~/jhealth/web && npm run imessage:bridge
```

The dashboard's top bar says **iMessage connected** while the bridge is running.

**Rules that keep the Apple ID safe:** jHealth never texts someone who has not written to it in the last 24 hours (a
held message goes out as soon as they write); at most one send every 1.5 seconds and 300 a day; group chats are ignored.
Settings: `IMESSAGE_ADDRESS` (the bot's address, shown on the site) and `IMESSAGE_BRIDGE_SECRET` (shared by bridge and
server), both on Vercel and in `web/.env.local`.

## The demo phone (backup for WhatsApp)

If WhatsApp is unavailable (Meta account trouble, no signal on stage), the patient can chat with the coach on a page of our own site instead. Everything behind it is the same code: the pain rule, the reminder and "what got in the way?" buttons, the AI coach, the outbox and the dashboard. Only the last step differs: a message for a demo-phone patient is handed to the page instead of to Meta.

**On stage:**

1. Dashboard → **Add patient** → tick **Use the demo phone instead of WhatsApp**. Leave the phone number empty; a fictional +1 416 555 01xx number is used.
2. Prescribe the plan. It appears on the demo phone at once, with the **Start session** button.
3. Open it on a real phone: the patient's record has **Show the QR code**. Scan it, and the phone shows the chat full-screen; Start session opens the camera page, which has **← Back to the chat**. On a laptop, the **Demo phone** button opens it in a phone-shaped frame.
4. Type, or tap one of the example messages: a question gets the AI coach (labelled "AI coach"), "Sharp pain in my knee, 8 out of 10" gets the safety reply and an alert on the dashboard.

**Limits and safety:** the page and its API take the patient's 64-character key, the same as the exercise page, and refuse (404) any patient who is not on the demo phone, so they can never be used to write as a WhatsApp patient. Messages are limited to 1,000 characters; only the coach's own buttons can be tapped; each patient may send 20 messages per 10 minutes and 200 a day, which also caps what the AI can spend. Anyone who has the QR code can write as that patient, so show it only to your own phone. Code: `src/lib/demo-phone.ts`, `src/app/api/demo-phone/route.ts`, `src/app/s/[token]/phone/`; tests: `scripts/demo-phone.test.ts`, `npm run db:verify`, `scripts/attack.sh`.

## The AI coach (WhatsApp replies)

Before this, a patient's ordinary message ("ok I'm ready", "can I do 3 sets?") got no answer. Now an AI writes the reply, using Adaption's hosted models (paid from the team's Adaption credits; no OpenAI bill).

What happens to each patient message, in order:

1. **The pain rule decides first** (plain code, `src/lib/safety.ts`). Pain 7/10 or more, or a red flag, gets the fixed safety reply and an alert. Those messages never reach the AI.
2. **The coach reads the patient's context.** That means the plan and how to do each exercise, the last 6 sessions, the physio's notes ("avoid kneeling until week 6"), the facts saved earlier, open alerts and the last 12 messages (`src/lib/coach/reply.ts`).
3. **The model answers in a fixed JSON shape**: the reply, whether to attach the **Start session** button, a note for the physio (or none), and up to 3 new facts to remember.
4. **Code checks the answer before anything is sent** (`src/lib/coach/prompt.ts`, unit-tested):
   - A reply that names a medicine or a dose is replaced with "ask your physiotherapist or pharmacist", and the physio is told.
   - The Start button only appears if the plan has a camera exercise and no pain alert is open. After the pain rule says stop, only the physio can lift that (Mark reviewed).
   - Facts with an unknown kind, duplicates, and facts the coach is not allowed to write (doctor's notes) are dropped. A changed fact ("after 8 pm now" instead of "mornings") replaces the old one, except pain facts, which are only ever added to.
   - Too long is cut. An unreadable answer, a timeout or an Adaption outage sends a short "your physiotherapist can see this" instead, so the patient is never ignored.
5. **The physio sees everything.** Replies are labelled "AI coach" in the chat, facts appear under "What the coach remembers" with the message they came from, and the coach's notes appear as alerts.

The AI can add alerts for the physio but can never remove one or skip the pain rule. The rules and wording in `prompt.ts` are a draft for the demo; a physiotherapist must review them before real use.

**Set up:** in adaptionlabs.ai go to Settings → API keys, then put the key in `web/.env.local` as `ADAPTION_API_KEY`. Without a key the coach stays silent and everything else works as before.

**Cost:** about 0.5 credits per 1,000 replies with the default model (GLM 5.3 Flash), so the team's credits are not a limit. A reply takes about 5 seconds (up to about 13).

**Privacy:** patient messages go to Adaption to be answered. Adaption's documentation does not say how long it keeps them or whether health data is allowed, so the demo uses simulated patients and the team only.

**Compare models:** `npm run coach:eval` (from `web/`) sends 18 made-up patient messages (medicine, swelling, plan changes, Spanish, a voice note, an attempt to override the rules) to several models and checks each answer automatically. Full answers are saved to `~/jhealth-cache/coach-eval.json` so you can read the tone. Results on 2026-11-19:

| Model | Checks passed | Typical reply time | Credits per 1,000 replies |
|---|---|---|---|
| **GLM 5.3 Flash (default)** | **18 / 18** | 5 s | 0.47 |
| DeepSeek V4 Flash | 17 / 18 (attached the Start button to a Spanish question) | 7.5 s | 0.12 |
| Qwen 3.8 27B | 17 / 18 (did not replace an outdated fact) | 9 s | 0.85 |
| GLM 5.2 | 17 / 18 (in Spanish, did not give the number of reps) | 4.5 s | 2.8 |
| Qwen 3.5 397B | 4 / 18 (most answers empty or too slow) | 37 s | 6.6 |

The Gemma models are not usable here: with the strict answer format they wrote one field and then only spaces.

## Keeping patients going (engagement)

Competitor research (Sword, Hinge, Kaia, Kemtai, Exer, Physitrack, Medbridge, Limber, Phio) found no WhatsApp-first rehab coach, and that nearly all published adherence evidence is self-reported. jHealth counts reps by camera, and adds the engagement ideas that have evidence behind them (`web/src/lib/engagement.ts`, `web/src/lib/quick-replies.ts`, `web/src/lib/reminders.ts`, all unit-tested):

- **After every session**, the WhatsApp summary celebrates real progress: the first session, streaks of 3/5/7/14/21/30 days, 5/10/25/50/100 sessions, a new personal best range of motion, the smoothest session yet. It also shows a **weekly goal** ("This week: 2 of 5 planned days"), which is kinder than a fragile daily streak.
- **The patient picks the reminder time** at welcome (Morning / Afternoon / Evening buttons).
- **A daily reminder** at that hour, with the Start button, the current streak, and the patient's own goal ("Every session brings you closer to walking the dog around the block").
- **After 3 days away, a gentle comeback** asks "What got in the way?" with buttons: *I forgot* (offers another reminder time), *It hurt* (alerts the physio and sends the safety reply), *No time* ("even five minutes counts", with the Start button).
- **A Sunday card** with the week's days done.
- **Rules:** never more than one engagement message a day, never after the patient already exercised, never while a pain alert is open, only inside WhatsApp's 24-hour window (outside it Meta requires paid, pre-approved templates). Every message is checked by a test for scolding words.
- **The AI coach's voice** is explicitly upbeat: praise effort, never guilt, frame tips as "next time, try", connect to the patient's goal and streak. `npm run coach:eval` now has 19 messages including "sorry I skipped 3 days, was feeling down" (19 of 19 pass).

Run the reminders now (laptop): `npm run reminders` (from `web/`). On Vercel, `vercel.json` runs them once a day.

**Demo morning:** the 20 simulated patients are created with dates relative to the day they were made, so their "this week" numbers drift. On the live site: `npm run cloud:demo-reset` (from `web/`). On the laptop: stop the dev server, run `npm run demo:reset`, then `npm run dev`. Either way they come back with today's dates and real patients are kept.

## The model: how to run it

Everything is in [`ml/`](ml/). The Python environment and the big files (videos, body points) live in `~/jhealth-cache`.

**Keep this project out of Desktop and Documents.** On this laptop those folders are synced to iCloud and the disk is almost full. iCloud tried to upload the Python environment file by file, slowed everything to a crawl, and then deleted the local copy of a data file in the middle of a run. `~/jhealth` is not synced.

One-time setup:

```bash
uv venv ~/jhealth-cache/venv --python 3.12
```

```bash
uv pip install --python ~/jhealth-cache/venv/bin/python -r ml/requirements.txt
```

Then three steps, run from the `ml` folder (`ceiling_check.py` is an optional fourth, a diagnostic):

| Step | Command | What happens | Time |
|---|---|---|---|
| 1 | `~/jhealth-cache/venv/bin/python extract_poses.py` | Pulls each video out of the dataset, runs the pose tracker, saves body points | about 45 min, safe to stop and restart |
| 2 | `~/jhealth-cache/venv/bin/python build_dataset.py` | Cuts the streams into repetitions, writes `data/reps.npz` | seconds |
| 3 | open [`ml/train_model.ipynb`](ml/train_model.ipynb) | Angles, honest test, three models compared, export | 3 min |

Step 3 also runs on Google Colab: upload `train_model.ipynb`, then upload `data/reps.npz` when the notebook asks.

## Where to run it, and what to do next

**Retraining runs on this laptop in about three minutes. No Colab or GPU is needed**; the model is tiny. The slow part is the pose tracker over videos, which is already done for the default model. Switch to the heavy tracker (from `ml/`):

```bash
~/jhealth-cache/venv/bin/python extract_poses.py --model heavy
```

```bash
~/jhealth-cache/venv/bin/python build_dataset.py --landmarks landmarks_heavy
```

Then open `ml/train_model.ipynb` in VS Code, pick `~/jhealth-cache/venv/bin/python` as the kernel, and Run All. To use Google Colab instead, upload `ml/train_model.ipynb` and `ml/data/reps.npz`.

What moves the score most, in order:

1. **Record your own clips in the demo setup** (see the next section). The pipeline for this is built and tested; what is missing is the recordings.
2. **Use the heavy tracker** for training and in the browser.
3. **Rules name the mistake** (depth, knee gap versus hip width, trunk lean); the model only gives the score.

## Your own clips: the next thing to do

Three teammates, all four exercises, a `good` clip and three named-mistake clips each, 10 to 15 reps per clip, filmed on the demo laptop. This is the only honest test of the demo setup and the realistic way to a camera score of 0.9 (see Results). Full instructions, including the mistakes per exercise and how to name the files, are in [`docs/RECORDING.md`](docs/RECORDING.md). Then, from `ml/`, once per exercise:

```bash
~/jhealth-cache/venv/bin/python extract_clips.py --exercise squat
```

```bash
~/jhealth-cache/venv/bin/python train_own.py --exercise squat
```

(`sit_to_stand`, `seated_knee_extension`, `arm_raise` for the others.) `extract_clips.py` tracks each clip, cuts it into single reps and draws a picture per clip (`clips_report/<exercise>/`) so you can see what was found. `train_own.py` hides each teammate in turn, compares training on your clips, on the public data, and on both, names the best, prints the score for the slide, and exports `ml/models/<exercise>_demo.json` (a quality score, a model that names the fault, and suggested thresholds for spoken cues), which the app then prefers.

The automatic rep cutter was checked against the physiotherapist's hand-marked squats in the public data: it finds all 195 of them with no false extras (heavy tracker) and agrees on start and end (overlap 0.90). `ml/make_standin_clips.py` lets you run everything before your recordings exist.

## Sit-to-stand (UI-PRMD)

Sit-to-stand is the first exercise in the plan, and REHAB24-6 does not have it. [UI-PRMD](https://doi.org/10.5281/zenodo.23104965) does: 10 healthy adults, 10 correct and 10 deliberately suboptimal sit-to-stands each, recorded with Vicon motion capture. It is public domain (ODC PDDL 1.0), so unlike REHAB24-6 it may be used commercially.

- **Conversion** (`ml/uiprmd.py`): the Vicon files hold real marker positions. Shoulders, elbows, wrists, knees and ankles are markers, and the hip joints are estimated from the pelvis markers (Bell et al. 1990). The Kinect files were not used: their joints are stored relative to rotated parents, and the authors warn that their own rebuild of the legs is wrong for sit-to-stand. `python uiprmd.py --check` shows the converted body is believable: knee about 165° standing and 86° seated, hips 0.80 m and 0.35 m high, feet moving under 2 cm.
- **Result:** logistic regression scores **0.90 macro F1, AUC 0.98 on people it never saw**, but on motion capture. One of 200 repetitions was skipped because markers were missing.
- **The catch, measured** (`ml/transfer_check.py`): REHAB24-6 has both motion capture and camera body points for the same squats. Trained on motion capture, the squat model drops from 0.83 to **0.55** on camera points. Putting the camera data on its own scale wins back part of that (**0.69**), with no labels needed.
- **So the app does not use the motion-capture model as it is.** Record a few sit-to-stand clips on the demo camera (any mix of good and bad, no labels needed), run `extract_clips.py`, then:

```bash
cd ~/jhealth/ml && ~/jhealth-cache/venv/bin/python calibrate_camera.py --own data/own_reps.npz
```

  That writes `sit_to_stand_camera.json` and the app switches to it. Until then, sit-to-stand is scored by the camera-trained squat model, and the session screen says it is a stand-in.

## Training online (Google Colab), not on the laptop

Turning videos into body points is the heavy part: about 90 minutes of full CPU on this laptop for all exercises. Do it on Colab instead. `ml/colab_train.ipynb` fetches the dataset videos straight from Zenodo into Google's computer one at a time, extracts body points, trains and compares the models with the honest test, and downloads only the finished model file (under 1 MB).

1. Open colab.research.google.com, then **File → Upload notebook**, and choose `ml/colab_train.ipynb`.
2. Choose the exercises and tracker in the settings cell (squats with the heavy tracker by default), then **Runtime → Run all**.
3. Put the downloaded `squat.json` (or another exercise's file) in `web/public/models/` and `ml/models/`.

The notebook is generated from the project's own feature and model code (`ml/tools/make_colab.py`), so it cannot drift from what the app runs. It was tested end to end in quick-test mode (3 videos).

## Checking the code

Every check below runs in seconds on the laptop unless noted.

| What it proves | Command (from the folder shown) |
|---|---|
| The pain rule, WhatsApp message formats, webhook signatures; the browser computes the same 188 numbers and the same score as Python; the live rep counter finds 193 of 195 physio-marked squats | `web`: `npm run test:unit` |
| The checks on the AI coach's answers: medicine guard, Start button rules, pain hold, memory filtering, fallback | `web`: `npm run test:unit` |
| How each Adaption model handles 18 tricky patient messages (needs the key; costs a tiny fraction of a credit) | `web`: `npm run coach:eval` |
| The four exercise profiles count one rep and name the right mistake on synthetic skeletons; the browser gives the same score as Python for the squat and arm-raise models (a left-arm example tests the mirroring) | `web`: `npm run test:unit` |
| 41 rules the database enforces (one plan per patient, approval before video, row level security, four camera exercises, ...) | `web`: `npm run db:verify` |
| Any exercise trained from every dataset, tested on unseen people of each (squat and arm raise about 10 minutes each) | `ml`: `~/jhealth-cache/venv/bin/python train_exercise.py squat` |
| How well each NAMED mistake is caught from any camera angle (REHAB26) | `ml`: `~/jhealth-cache/venv/bin/python mistake_check.py` |
| The offline rep cutter against the physio's marks | `ml`: `~/jhealth-cache/venv/bin/python check_segmenter.py` |
| Squat model comparison table (about 2 to 5 minutes) | `ml`: `~/jhealth-cache/venv/bin/python train_squat.py` |
| The UI-PRMD conversion behaves like a real body (streams about 8 MB, nothing saved) | `ml`: `~/jhealth-cache/venv/bin/python uiprmd.py --check` |
| How much a motion-capture model loses on camera body points | `ml`: `~/jhealth-cache/venv/bin/python transfer_check.py` |
| All exercises, all charts, the honest test explained step by step | open `ml/train_model.ipynb` (the outputs are saved in it) |

## The data

[REHAB24-6](https://zenodo.org/records/13305826): 10 healthy adults aged 25 to 50, filmed by two cameras, 1,072 repetitions of 6 exercises, each marked correct or incorrect under a physiotherapist's instruction. We use five of the six exercises:

| Body area | Exercise in the dataset | Closest exercise in a knee or hip plan |
|---|---|---|
| Knee | Squat | Sit-to-stand, chair squat |
| Knee, hip | Lunge | Step and balance work |
| Hip | Leg abduction (leg out to the side) | Standing hip abduction |
| Shoulder | Arm abduction (arm out to the side) | Shoulder abduction |
| Shoulder | Arm VW | Shoulder mobility |

Push-ups are left out: they are not in a joint-replacement plan.

We chose it because it has raw video plus a correct/incorrect label for every repetition. Raw video matters: we can run the same pose tracker on it that the patient's browser runs, so training data looks like live data.

Added on 19 November, after a search of about 25 candidate datasets (each converted into MediaPipe's layout by its own script, never stored whole):

| Dataset | Data | People | Exercises used | Licence | Script |
|---|---|---|---|---|---|
| [REHAB26-ViewAngles](https://zenodo.org/records/23018128) | 3 iPhones per rep (front to profile), MediaPipe points included, mistake named per rep | 5 | squat, arm abduction | CC BY-NC 4.0 | `ml/rehab26.py` |
| [IntelliRehabDS](https://zenodo.org/records/4610859) | Kinect skeletons, 15 patients (mostly stroke) + 14 healthy, standing / chair / wheelchair | 29 | shoulder abduction (arm raise) | CC BY 4.0 | `ml/irds.py` |
| [UI-PRMD](https://doi.org/10.5281/zenodo.23104965) | Vicon motion capture | 10 | deep squat, sit-to-stand, shoulder abduction, scaption | public domain | `ml/uiprmd.py` |

Checked and not used: KIMORE (one score per session, not per rep), Fitness-AQA (barbell gym squats, request form), QEVD and EgoExo-Fitness (accounts, research-only), the FMS Kinect set (0 to 3 scores in a 1 GB archive), KINECAL (sit-to-stand without quality labels). No public dataset labels seated knee extension reps.

## Results

**The four app exercises (19 November).** Macro F1 on people the model never saw, by where the body points came from:

| Exercise | Lab body points (motion capture / Kinect) | Camera body points (MediaPipe, what the app sees) | In the app |
|---|---|---|---|
| Chair squat | 0.83 (UI-PRMD) | **0.79** (REHAB24) and **0.79** (REHAB26 phones), one model from both camera datasets, 14 people | `squat.json` |
| Sit-to-stand | **0.90** (UI-PRMD) | no labelled camera data exists publicly | squat model as a labelled stand-in until calibrated or trained on own clips |
| Arm raise to the side | **0.97** (UI-PRMD), 0.82 (IntelliRehabDS patients) | 0.66 (REHAB24, REHAB26) | `arm_raise.json` |
| Seated knee extension | no labelled data exists publicly | no labelled data exists publicly | movement rules (tested on synthetic skeletons) |

- **0.9 is reached on lab-quality body points** (sit-to-stand, arm raise), not on a webcam with public data. The same squats score 0.89 with motion capture and 0.80 with a camera, and every camera dataset has 5 to 10 healthy people with mistakes chosen per person. The honest route to 0.9 on the demo camera is your own clips.
- **When the app flags a rep, it is usually right.** Each model has a cut-off chosen on unseen people (`ml/operating_point.py`) so that about 9 in 10 flags are real mistakes: squat precision 0.90 (catches 54% of mistakes), arm raise 0.92 (catches 17%). Below the cut-off the app says nothing rather than risk discouraging a patient with a false alarm; the rules still name visible mistakes.
- **Named mistakes from any camera angle** (REHAB26, unseen people, `ml/mistake_check.py`): too-shallow squat 0.86, lifted heels 0.86, knees forward 0.74, arm too low 0.75, bent arm 0.72. Subtle ones (torso tilt, hitched shoulder, head tilt) are near guessing.
- **Tried and dropped** (measured): calibrating to each person (worse), 2D image-plane angles on top of 3D (no gain), lab data in camera training for arms (worse), each dataset on its own scale (no gain on camera).

**The first five-exercise study (18 November).** Every score is **macro F1 on people the model never saw** (train on everyone but one person, test on that person, repeat for each person). 1.0 is perfect; "always say correct" is the floor. Exported model: logistic regression (tied with the forest overall, and 17 kB per exercise).

| Exercise | Samples | People | Always "correct" | Logistic regression | Random forest | 1D-CNN |
|---|---|---|---|---|---|---|
| Squat | 390 | 9 | 0.41 | **0.72** | 0.66 | 0.71 |
| Lunge | 345 | 8 | 0.31 | 0.65 | 0.59 | **0.68** |
| Leg abduction | 420 | 9 | 0.36 | **0.76** | 0.75 | 0.72 |
| Arm abduction | 356 | 9 | 0.34 | 0.63 | **0.70** | 0.63 |
| Arm VW | 416 | 9 | 0.31 | **0.69** | **0.69** | 0.66 |
| All five | 1,927 | | 0.35 | **0.70** | **0.70** | 0.69 |

What the numbers say:

1. **Useful, not sharp.** The model is clearly better than guessing, but on a new person it still gets roughly one rep in three wrong. Use it for a quality score and a trend, never as the only judge of a single rep. Rules name the mistake; the model gives the score.
2. **Testing the lazy way would have lied.** The same forest scores 0.83 to 0.90 when repetitions are split at random (the same people in training and test), against 0.59 to 0.75 honestly.
3. **The camera is a large part of the weakness.** Run on the dataset's motion-capture joints (a near-perfect ruler) instead of MediaPipe, the same model scores 0.89 on squats and 0.83 on arm abduction (see `ml/ceiling_check.py` and `docs/WORKLOG.md`, section 6).
4. **The squat model scored 0.80** (AUC 0.89) on people it never saw, up from 0.72 (since replaced by the two-camera-dataset model above, 0.79 on both datasets). Two changes did it: MediaPipe's slower, more accurate "heavy" tracker (0.72 → 0.78), then averaging three models (logistic regression, random forest, gradient boosting; 0.78 → 0.80). Adding the dataset's motion-capture joints to training did not help (0.77). Script: `ml/train_squat.py`. The other exercises in the table above still use the default tracker.

Models and a worked example for testing a JavaScript port are in [`ml/models/`](ml/models/). The full story of what was built and why is in [`docs/WORKLOG.md`](docs/WORKLOG.md).

## Limits to say out loud

- **Licence.** REHAB24-6 is CC BY-NC: non-commercial research only. Fine for a prototype. A product would train on consented patient data from pilot sites.
- **Licence (new datasets).** REHAB26 is CC BY-NC like REHAB24-6; IntelliRehabDS (CC BY 4.0) and UI-PRMD (public domain) allow commercial use.
- **Who was filmed.** Mostly healthy adults aged 20 to 60 in labs (IntelliRehabDS adds stroke patients), not older patients at home. The test scores are for people like them.
- **Camera angles are not clinical measurements.** A single camera is off by several degrees on a knee angle. Show trends over weeks.
- **jHealth does not diagnose or change the plan.** The physiotherapist prescribes. jHealth coaches, measures and reports.
- **The AI coach can still say something odd.** Code checks catch medicine, the Start button and the pain hold, not tone or every wrong statement. The physio sees every reply, and the wording rules are a draft for clinical review.
