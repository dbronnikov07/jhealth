// The public front page: what jHealth is, for judges, clinics and patients. Static, no patient data.
// Photos: free-licence stock (public/photos/CREDITS.md), to be replaced by the team's own.
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Goniometer } from "@/components/Goniometer";
import { Icon, type IconName } from "@/components/Icon";
import { HeroPhoto } from "./_landing/HeroPhoto";
import "./landing.css";

export const metadata: Metadata = {
  title: "jHealth · Home rehab that reports back",
  description:
    "jHealth sends the physiotherapist's exercise plan as a chat message. The patient's own phone camera counts and scores every repetition, the video never leaves the phone, and the physio sees how it is going.",
};

const EXERCISES = [
  { id: "squat", name: "Chair squat", measures: "Deepest knee bend", angle: 88, names: ["Knees caving in", "Not standing up fully", "Going too fast"], score: "0.79", basis: "phone and webcam video, 14 people it never saw" },
  { id: "sit_to_stand", name: "Sit-to-stand", measures: "Deepest knee bend", angle: 92, names: ["Knees caving in", "Not upright at the top", "Sitting down too fast"], score: "0.90", basis: "lab motion capture; on camera the squat model stands in until calibrated" },
  { id: "seated_knee_extension", name: "Seated knee extension", measures: "Straightest knee", angle: 6, names: ["Not straight", "No 2-second hold", "Leaning back", "Lowering too fast"], score: null, basis: "movement rules a physio can read; no public labelled data exists" },
  { id: "arm_raise", name: "Arm raise to the side", measures: "Highest arm angle", angle: 90, names: ["Not up to shoulder height", "Bent elbow", "Body swaying"], score: "0.97", basis: "lab motion capture; 0.66 on phone video so far" },
] as const;

const CHAT_POINTS: { icon: IconName; title: string; body: string }[] = [
  { icon: "play", title: "A daily message with a Start button", body: "No app to download, no password. The button opens the patient's own private page." },
  { icon: "chart", title: "Progress after every session", body: "Reps, quality and knee bend compared with last time, plus one thing to work on." },
  { icon: "chat", title: "Questions answered, checked by code", body: "An AI coach writes the replies. Code blocks medicine and dose advice, and the physio sees every reply." },
  { icon: "alert", title: "Pain goes to fixed rules, never the AI", body: "Pain of 7/10 or more, or a red flag, gets a safety reply, an alert for the physio and no Start button until they have looked." },
];

const PATIENTS = [
  { name: "Margaret T.", status: "Needs review", tone: "alert", days: 2, bend: "71°" },
  { name: "Daniel R.", status: "On track", tone: "ok", days: 5, bend: "88°" },
  { name: "Priya S.", status: "Stalling", tone: "warn", days: 1, bend: "64°" },
] as const;

export default function Landing() {
  return (
    <div className="lp">
      <a className="lp-skip" href="#main">Skip to content</a>

      <header className="lp-nav-bar">
        <nav className="lp-nav lp-wrap" aria-label="Main">
          <Link href="/" className="lp-brand" aria-label="jHealth home">
            <Goniometer value={62} size={30} />
            <span>j<span>Health</span></span>
          </Link>
          <div className="lp-nav-links">
            <a href="#how">How it works</a>
            <a href="#exercises">Exercises</a>
            <a href="#evidence">Evidence</a>
            <a href="#safety">Safety</a>
          </div>
          <Link href="/doctor" className="lp-btn lp-btn-primary lp-btn-sm">
            <span className="long">Physio dashboard</span><span className="short">Dashboard</span>
            <Icon name="arrow" size={16} />
          </Link>
        </nav>
      </header>

      <main id="main">
        {/* ---------- hero: a real person, and what the app really measures on him ---------- */}
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-wrap lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="lp-eyebrow">Home rehab after knee and hip replacement</p>
              <h1 id="hero-title">The home exercise plan that <span>reports back.</span></h1>
              <p className="lp-lede">
                The physio&apos;s plan arrives as a chat message. One tap turns the patient&apos;s own phone into a coach that
                counts every rep, scores it and says what to fix, and the physio sees the numbers.
              </p>
              <div className="lp-actions">
                <Link href="/doctor" className="lp-btn lp-btn-primary">Open the physio dashboard <Icon name="arrow" size={18} /></Link>
                <a href="#how" className="lp-btn lp-btn-quiet">How it works</a>
              </div>
              <ul className="lp-assure">
                <li><Icon name="check" size={18} /> Nothing to install</li>
                <li><Icon name="lock" size={18} /> Video stays on the phone</li>
                <li><Icon name="user" size={18} /> Physio in the loop</li>
              </ul>
            </div>
            <div className="lp-hero-visual">
              <HeroPhoto />
              <div className="lp-float-msg" aria-hidden>
                <div className="lp-float-head">
                  <span className="lp-float-avatar"><Goniometer value={62} size={20} /></span>
                  <span><b>jHealth coach</b><small>Today, 9:00</small></span>
                </div>
                <p>Morning Daniel! Today: chair squats, 2 sets of 10. You were at 81° last time.</p>
                <span className="lp-float-cta"><Icon name="play" size={13} /> Start session</span>
              </div>
            </div>
          </div>
        </section>

        {/* ---------- proof ---------- */}
        <section className="lp-proof" aria-label="In numbers">
          <dl className="lp-wrap lp-proof-grid">
            <div>
              <dt><b className="num">117,000+</b></dt>
              <dd>
                hip and knee replacements in Canada in 2021–22, each followed by weeks of exercise at home.{" "}
                <a href="https://www.cihi.ca/en/cjrr-annual-report-hip-and-knee-replacements-in-canada-2021-2022" target="_blank" rel="noreferrer">CIHI</a>
              </dd>
            </div>
            <div>
              <dt><b className="num">193 / 195</b></dt>
              <dd>squat reps marked by a physiotherapist were found by the live rep counter, with no false ones.</dd>
            </div>
            <div>
              <dt><b className="num">0 frames</b></dt>
              <dd>of video leave the patient&apos;s phone. Only counts, scores and angles are sent.</dd>
            </div>
          </dl>
        </section>

        {/* ---------- the problem ---------- */}
        <section className="lp-section" aria-labelledby="problem-title">
          <div className="lp-wrap lp-split">
            <div className="lp-photo lp-photo-tall">
              <Image src="/photos/knee-surgery.webp" alt="A surgeon's hand marking a patient's knee before surgery." fill sizes="(min-width: 900px) 40vw, 100vw" />
            </div>
            <div className="lp-split-copy">
              <p className="lp-eyebrow">The gap</p>
              <h2 id="problem-title">Surgery takes a day. Recovery happens at home, unseen.</h2>
              <p className="lp-body">
                After a knee or hip replacement, most of the work is the exercise programme done alone at home. The clinic
                prescribes it on paper and hears how it went weeks later, if at all.
              </p>
              <dl className="lp-facts">
                <div><dt>Who it is for</dt><dd>Adults after a knee or hip replacement, or with knee or hip osteoarthritis, following a physio&apos;s plan. Mostly 55 and up.</dd></div>
                <div><dt>Who pays</dt><dd>The hospital or clinic. It is already paid for the rehab, and today it cannot see what happens at home.</dd></div>
              </dl>
            </div>
          </div>
        </section>

        {/* ---------- how it works ---------- */}
        <section className="lp-section lp-tint" id="how" aria-labelledby="how-title">
          <div className="lp-wrap">
            <div className="lp-head">
              <p className="lp-eyebrow">How it works</p>
              <h2 id="how-title">Prescribed in the clinic. Done at home. Seen by the physio.</h2>
            </div>
            <ol className="lp-steps">
              <li className="lp-step">
                <div className="lp-step-media">
                  <Image src="/photos/physio-session.webp" alt="An older man exercising with his physiotherapist beside him." fill sizes="(min-width: 900px) 30vw, 100vw" />
                  <span className="lp-chip"><Icon name="check" size={14} /> Plan sent · Sit-to-stand 2 × 10</span>
                </div>
                <div className="lp-step-text">
                  <span className="lp-step-n">1 · Physio</span>
                  <h3>Prescribe in a minute</h3>
                  <p>Tick the exercises, sets and reps. The plan goes out as a message with a Start button.</p>
                </div>
              </li>
              <li className="lp-step">
                <div className="lp-step-media">
                  <Image src="/photos/home-stretch.webp" alt="An older man stretching on a mat in his living room." fill sizes="(min-width: 900px) 30vw, 100vw" />
                  <span className="lp-chip"><span className="lp-chip-dot" aria-hidden /> Rep 7 · <b className="num">92</b>/100</span>
                </div>
                <div className="lp-step-text">
                  <span className="lp-step-n">2 · Patient</span>
                  <h3>The phone coaches every rep</h3>
                  <p>The camera counts each repetition out loud, scores it and says what to fix. Nothing to install.</p>
                </div>
              </li>
              <li className="lp-step">
                <div className="lp-step-media lp-step-ui" aria-hidden>
                  <div className="lp-board">
                    <div className="lp-board-head"><span>Patient</span><span>Days</span><span>Knee</span></div>
                    {PATIENTS.map((p) => (
                      <div key={p.name} className="lp-board-row">
                        <span className="lp-board-name">{p.name}<i className={p.tone}>{p.status}</i></span>
                        <span className="lp-days">{[0, 1, 2, 3, 4].map((d) => <i key={d} className={d < p.days ? "on" : ""} />)}</span>
                        <span className="num">{p.bend}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="lp-step-text">
                  <span className="lp-step-n">3 · Physio</span>
                  <h3>See who is on track</h3>
                  <p>Adherence, quality and knee bend within seconds of a session. Pain and stalled progress rise to the top.</p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        {/* ---------- the conversation ---------- */}
        <section className="lp-section" aria-labelledby="chat-title">
          <div className="lp-wrap lp-split lp-split-rev">
            <div className="lp-photo lp-chat-photo">
              <Image src="/photos/phone-at-home.webp" alt="A smiling older man on his sofa, holding a mug and reading his phone." fill sizes="(min-width: 900px) 46vw, 100vw" />
              <div className="lp-bubbles" aria-hidden>
                <p className="in">Can I do it after dinner instead?</p>
                <p className="out"><small>AI coach</small>After dinner works well. The best time is the one you will keep, and you are on a 4-day streak.</p>
              </div>
            </div>
            <div className="lp-split-copy">
              <p className="lp-eyebrow">The coach</p>
              <h2 id="chat-title">Coaching in the chat they already use</h2>
              <p className="lp-body">Patients do not learn a new app. The coach writes like a person; the hard rules live in code.</p>
              <ul className="lp-points">
                {CHAT_POINTS.map((c) => (
                  <li key={c.title}>
                    <span className="lp-point-icon"><Icon name={c.icon} size={20} /></span>
                    <div><h3>{c.title}</h3><p>{c.body}</p></div>
                  </li>
                ))}
              </ul>
              <p className="lp-fine">Built for WhatsApp. For the demo, a chat page of our own stands in for it, with the same coach and rules.</p>
            </div>
          </div>
        </section>

        {/* ---------- exercises ---------- */}
        <section className="lp-section lp-tint" id="exercises" aria-labelledby="ex-title">
          <div className="lp-wrap">
            <div className="lp-head">
              <p className="lp-eyebrow">Exercises</p>
              <h2 id="ex-title">Four exercises the camera can score</h2>
              <p className="lp-body">Each has its own profile: what counts as one rep, which angle is measured, and which mistakes are named out loud.</p>
            </div>
            <ul className="lp-ex-grid">
              {EXERCISES.map((e) => (
                <li key={e.id} className="lp-ex">
                  <div className="lp-ex-gauge" aria-hidden>
                    <Goniometer value={e.angle} size={88} ticks />
                    <b className="num">{e.angle}°</b>
                  </div>
                  <h3>{e.name}</h3>
                  <p className="lp-ex-measure">{e.measures}</p>
                  <p className="lp-ex-names">{e.names.join(" · ")}</p>
                  <p className="lp-ex-score">
                    {e.score ? <b className="num">{e.score}</b> : <b className="rules">Rules</b>}
                    <span>{e.basis}</span>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- evidence ---------- */}
        <section className="lp-section" id="evidence" aria-labelledby="ev-title">
          <div className="lp-wrap lp-ev-grid">
            <div>
              <p className="lp-eyebrow">Evidence</p>
              <h2 id="ev-title">Tested on people the model never saw</h2>
              <p className="lp-body">
                Each model is trained on everyone but one person, then tested on that person, once for every person. A real
                patient is always someone new, so this is the test that predicts real life.
              </p>
              <p className="lp-fine">
                Score: macro F1 for telling a correct rep from a wrong one. 1.0 is perfect; always answering “correct” scores
                about 0.35 to 0.4.
              </p>
            </div>
            <div className="lp-ev-card">
              <dl className="lp-scores">
                {[
                  { name: "Arm raise to the side", v: 0.97, basis: "lab motion capture" },
                  { name: "Sit-to-stand", v: 0.9, basis: "lab motion capture" },
                  { name: "Chair squat", v: 0.79, basis: "phone and webcam video, 14 people" },
                ].map((s) => (
                  <div key={s.name}>
                    <dt>{s.name}<span>{s.basis}</span></dt>
                    <dd><b className="num">{s.v.toFixed(2)}</b></dd>
                    <span className="lp-bar" style={{ ["--v" as string]: s.v }} aria-hidden />
                  </div>
                ))}
              </dl>
              <p className="lp-fine">
                Said plainly: the datasets are healthy adults in labs, not older patients at home, and phone video is harder
                than lab data. Recording our own clips in the demo setup is the next step.
              </p>
            </div>
          </div>
        </section>

        {/* ---------- privacy ---------- */}
        <section className="lp-section lp-ink" aria-labelledby="privacy-title">
          <div className="lp-wrap lp-privacy-grid">
            <div>
              <p className="lp-eyebrow">Privacy</p>
              <h2 id="privacy-title">The video never leaves the phone</h2>
              <p className="lp-body">
                Pose tracking and scoring run inside the patient&apos;s browser, served by jHealth itself. Only numbers travel,
                to a database in Canada.
              </p>
              <Link href="/privacy" className="lp-btn lp-btn-light">Read the privacy policy <Icon name="arrow" size={18} /></Link>
            </div>
            <ol className="lp-flow" aria-label="What happens to the data">
              <li><span className="lp-flow-icon"><Icon name="camera" size={22} /></span><div><h3>On the phone</h3><p>Camera, 33 body points per frame, joint angles, a score for each rep.</p></div></li>
              <li>
                <span className="lp-flow-icon"><Icon name="lock" size={22} /></span>
                <div>
                  <h3>Only numbers are sent</h3>
                  <pre className="lp-payload" aria-label="Example of what is sent for one repetition">{`{ "quality": 0.91, "fault": null,
  "knee_bend_deg": 88, "duration_s": 2.4 }`}</pre>
                </div>
              </li>
              <li><span className="lp-flow-icon"><Icon name="chart" size={22} /></span><div><h3>To the physio</h3><p>The dashboard, and a progress message back in the chat.</p></div></li>
            </ol>
          </div>
        </section>

        {/* ---------- safety ---------- */}
        <section className="lp-section" id="safety" aria-labelledby="safety-title">
          <div className="lp-wrap">
            <div className="lp-head">
              <p className="lp-eyebrow">Safety</p>
              <h2 id="safety-title">Safe by design, with the physio in charge</h2>
              <p className="lp-body">A model scores the rep, rules handle mistakes and safety, and the AI only writes text.</p>
            </div>
            <ul className="lp-safety">
              <li className="pain">
                <span className="lp-safety-icon"><Icon name="hand" size={24} /></span>
                <h3>Pain stops everything</h3>
                <p>“Sharp pain, 8 out of 10”, chest pain, a swollen calf or a fall: plain code asks the patient to stop, alerts the physio and points to Health811 or 911.</p>
              </li>
              <li>
                <span className="lp-safety-icon"><Icon name="user" size={24} /></span>
                <h3>The physio stays in charge</h3>
                <p>Only the physio prescribes or changes the plan, and only the physio can lift a pain hold. Every AI reply is labelled.</p>
              </li>
              <li>
                <span className="lp-safety-icon"><Icon name="shield" size={24} /></span>
                <h3>Not a diagnosis</h3>
                <p>jHealth coaches, counts and reports. Angles from one camera are a trend over weeks, not a clinical measurement.</p>
              </li>
            </ul>
          </div>
        </section>

        {/* ---------- call to action ---------- */}
        <section className="lp-section lp-cta-section" aria-labelledby="cta-title">
          <div className="lp-wrap">
            <div className="lp-cta">
              <div className="lp-cta-copy">
                <h2 id="cta-title">See the physio&apos;s side</h2>
                <p>Patients, plans, live sessions and the chat thread. Simulated patients are labelled; a finished session shows up within seconds.</p>
                <Link href="/doctor" className="lp-btn lp-btn-light">Open the physio dashboard <Icon name="arrow" size={18} /></Link>
              </div>
              <div className="lp-cta-photo">
                <Image src="/photos/arm-raise.webp" alt="An older couple raising their arms to the side in their living room." fill sizes="(min-width: 900px) 34vw, 100vw" />
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-grid">
          <div>
            <span className="lp-brand"><Goniometer value={62} size={24} /><span>j<span>Health</span></span></span>
            <p>Home rehab, coached in the chat. Built at YHacks 2026.</p>
            <p className="lp-fine">A prototype: not a medical device and not a diagnosis. In an emergency, call 911.</p>
          </div>
          <nav aria-labelledby="ft-page">
            <h2 id="ft-page">On this page</h2>
            <ul>
              <li><a href="#how">How it works</a></li>
              <li><a href="#exercises">Exercises</a></li>
              <li><a href="#evidence">Evidence</a></li>
              <li><a href="#safety">Safety</a></li>
            </ul>
          </nav>
          <nav aria-labelledby="ft-more">
            <h2 id="ft-more">jHealth</h2>
            <ul>
              <li><Link href="/doctor">Physio dashboard</Link></li>
              <li><Link href="/privacy">Privacy policy</Link></li>
            </ul>
          </nav>
        </div>
      </footer>
    </div>
  );
}
