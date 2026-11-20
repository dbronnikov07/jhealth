// The public front page: what Motiva Health is, for judges, clinics and patients. Static, no patient data.
// Photos: free-licence stock (public/photos/CREDITS.md), to be replaced by the team's own.
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Logo } from "@/components/Logo";
import { Icon } from "@/components/Icon";
import { QrCode } from "@/components/QrCode";
import { textUsLink } from "@/lib/imessage/format";
import { HeroPhoto } from "./_landing/HeroPhoto";
import "./landing.css";

export const metadata: Metadata = {
  title: "Motiva Health · Home rehab, coached by the phone camera",
  description:
    "The physio sends an exercise plan to the patient's chat. The phone camera counts every rep and corrects form out loud, the video never leaves the phone, and the physio sees the results.",
};

const EXERCISES = [
  { name: "Chair squat", measures: "Deepest knee bend", names: "Knees caving in, not standing up fully, going too fast", score: "0.79", basis: "phone and webcam video" },
  { name: "Sit-to-stand", measures: "Deepest knee bend", names: "Knees caving in, not upright at the top, sitting down too fast", score: "0.90*", basis: "lab motion capture; camera F1 is not measured yet" },
  { name: "Arm raise to the side", measures: "Highest arm angle", names: "Not up to shoulder height, bent elbow, body swaying", score: "0.66", basis: "phone and webcam video" },
];

const CHAT = [
  { title: "A message with a Start button", body: "Every day at the time the patient picked. The button opens their own page. Nothing to install, no password." },
  { title: "Progress after every session", body: "Reps, quality and knee bend compared with last time, plus one thing to work on." },
  { title: "Answers in seconds", body: "An AI coach replies to questions. Code blocks any medicine or dose advice, and the physio sees every reply." },
  { title: "Pain goes straight to the physio", body: "Pain of 7 out of 10 or more stops the plan, sends a safety reply and alerts the physio. The AI is never involved." },
];

const PATIENTS = [
  { name: "Margaret T.", status: "Needs review", tone: "alert", days: 2, bend: "71°" },
  { name: "Daniel R.", status: "On track", tone: "ok", days: 5, bend: "88°" },
  { name: "Priya S.", status: "Stalling", tone: "warn", days: 1, bend: "64°" },
] as const;

// Motiva Health's iMessage address (the bot's own Apple ID). Without it, the page simply has no "Text Motiva" parts.
const IMESSAGE = process.env.IMESSAGE_ADDRESS?.trim() || null;

export default function Landing() {
  const textUs = IMESSAGE ? textUsLink(IMESSAGE) : null;
  return (
    <div className="lp">
      <a className="lp-skip" href="#main">Skip to content</a>

      <header className="lp-nav-wrap">
        <nav className="lp-nav" aria-label="Main">
          <Link href="/" className="lp-brand" aria-label="Motiva Health home"><Logo size={28} /></Link>
          <div className="lp-nav-links">
            <a href="#how">How it works</a>
            <a href="#exercises">Exercises</a>
            <a href="#evidence">Evidence</a>
            <a href="#safety">Safety</a>
          </div>
          <Link href="/doctor" className="lp-btn lp-btn-dark lp-btn-sm">
            <span className="long">Physio dashboard</span><span className="short">Dashboard</span>
          </Link>
        </nav>
      </header>

      <main id="main">
        <section className="lp-hero" aria-labelledby="hero-title">
          <div className="lp-hero-text">
            <p className="lp-badge">For patients after knee and hip replacement</p>
            <h1 id="hero-title">Home rehab, coached by the phone camera</h1>
            <p className="lp-hero-sub">
              The physio sends a plan to the patient&apos;s chat. The phone camera counts every rep and corrects form out
              loud. The physio sees the results the same day.
            </p>
            <div className="lp-actions">
              {textUs ? (
                <>
                  <a href={textUs} className="lp-btn lp-btn-white">Text Motiva on iMessage <Icon name="arrow" size={18} /></a>
                  <Link href="/doctor" className="lp-btn lp-btn-glass">Physio dashboard</Link>
                </>
              ) : (
                <>
                  <Link href="/doctor" className="lp-btn lp-btn-white">Open the physio dashboard <Icon name="arrow" size={18} /></Link>
                  <a href="#how" className="lp-btn lp-btn-glass">See how it works</a>
                </>
              )}
            </div>
          </div>

          <div className="lp-stage">
            <div className="lp-card lp-card-summary" aria-hidden>
              <p className="lp-card-label">Session finished</p>
              <p className="lp-card-title">Sit-to-stand, 2 × 10</p>
              <dl>
                <div><dt>Quality</dt><dd className="num">91<span>/100</span></dd></div>
                <div><dt>Knee bend</dt><dd className="num">88°</dd></div>
              </dl>
              <p className="lp-card-foot">Up from 81° last week</p>
            </div>
            <div className="lp-stage-photo"><HeroPhoto /></div>
            <div className="lp-card lp-card-msg" aria-hidden>
              <p className="lp-card-label">Motiva coach · 9:00</p>
              <p>Morning Daniel! Today: chair squats, 2 sets of 10. You reached 81° last time.</p>
              <span className="lp-card-cta">Start session</span>
            </div>
          </div>
          <p className="lp-hero-note">The points on the photo are our pose model&apos;s real output on this picture.</p>
        </section>

        <section className="lp-stats" aria-label="In numbers">
          <dl className="lp-wrap lp-stats-grid">
            <div>
              <dt className="num">117,000+</dt>
              <dd>hip and knee replacements in Canada in one year (<a href="https://www.cihi.ca/en/cjrr-annual-report-hip-and-knee-replacements-in-canada-2021-2022" target="_blank" rel="noreferrer">CIHI, 2021–22</a>)</dd>
            </div>
            <div>
              <dt className="num">193 of 195</dt>
              <dd>squat reps marked by a physiotherapist were found by the live rep counter</dd>
            </div>
            <div>
              <dt className="num">0</dt>
              <dd>video frames leave the patient&apos;s phone. Only numbers are sent</dd>
            </div>
          </dl>
        </section>

        {textUs && IMESSAGE && (
          <section className="lp-start" aria-labelledby="start-title">
            <div className="lp-wrap">
              <div className="lp-start-card">
                <div className="lp-start-copy">
                  <h2 id="start-title">Start in iMessage</h2>
                  <p>Text Motiva like you would text a friend. The coach answers, sends your plan, and checks in every day at the time you pick.</p>
                  <a href={textUs} className="lp-btn lp-btn-dark">Text Motiva <Icon name="arrow" size={18} /></a>
                  <p className="lp-start-address">or send a message to <b>{IMESSAGE}</b></p>
                </div>
                <div className="lp-start-qr">
                  <QrCode text={textUs} size={168} label="QR code: scan with your iPhone camera to text Motiva Health" />
                  <span>Scan with your iPhone camera</span>
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="lp-section" aria-labelledby="why-title">
          <div className="lp-wrap lp-why">
            <div className="lp-head">
              <h2 id="why-title">Most rehab happens at home, where nobody sees it</h2>
              <p>
                After a knee or hip replacement, patients do weeks of exercises on their own. The clinic hands them a
                sheet of paper and finds out how it went at the next visit.
              </p>
            </div>
            <ul className="lp-list">
              <li><span>Who it is for</span><p>Adults after a knee or hip replacement, or with knee or hip arthritis, mostly 55 and older.</p></li>
              <li><span>Who pays</span><p>The hospital or clinic. It is already paid for the rehab and cannot see what happens at home today.</p></li>
              <li><span>What changes</span><p>The physio sees every session: how many reps, how well, and how far the knee bends.</p></li>
            </ul>
          </div>
        </section>

        <section className="lp-section lp-grey" id="how" aria-labelledby="how-title">
          <div className="lp-wrap">
            <div className="lp-head">
              <h2 id="how-title">How it works</h2>
              <p>The patient only ever taps one button.</p>
            </div>
            <ol className="lp-steps">
              <li className="lp-step">
                <div className="lp-step-media">
                  <Image src="/photos/physio-session.webp" alt="An older man exercising with his physiotherapist beside him." fill sizes="(min-width: 900px) 30vw, 100vw" />
                </div>
                <div className="lp-step-text">
                  <span className="lp-step-n">1</span>
                  <h3>The physio picks the exercises</h3>
                  <p>Sets, reps and days per week. The plan goes out as a chat message with a Start button.</p>
                </div>
              </li>
              <li className="lp-step">
                <div className="lp-step-media">
                  <Image src="/photos/home-stretch.webp" alt="An older man stretching on a mat in his living room." fill sizes="(min-width: 900px) 30vw, 100vw" />
                </div>
                <div className="lp-step-text">
                  <span className="lp-step-n">2</span>
                  <h3>The phone coaches every rep</h3>
                  <p>The camera counts out loud, scores each rep and says what to fix, like a physio in the room.</p>
                </div>
              </li>
              <li className="lp-step">
                <div className="lp-step-media lp-step-ui" aria-hidden>
                  <div className="lp-board">
                    <div className="lp-board-head"><span>Patient</span><span>This week</span><span>Knee</span></div>
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
                  <span className="lp-step-n">3</span>
                  <h3>The physio sees who needs help</h3>
                  <p>Results arrive seconds after a session. Pain reports and stalled progress go to the top of the list.</p>
                </div>
              </li>
            </ol>
          </div>
        </section>

        <section className="lp-section" aria-labelledby="chat-title">
          <div className="lp-wrap lp-split">
            <div className="lp-photo">
              <Image src="/photos/phone-at-home.webp" alt="A smiling older man on his sofa, holding a mug and reading his phone." fill sizes="(min-width: 900px) 46vw, 100vw" />
              <div className="lp-bubbles" aria-hidden>
                <p className="in">Can I do it after dinner instead?</p>
                <p className="out"><small>AI coach</small>After dinner works well. The best time is the one you will keep, and you are on a 4-day streak.</p>
              </div>
            </div>
            <div>
              <div className="lp-head left">
                <h2 id="chat-title">The coach lives in the chat</h2>
                <p>Patients already know how to use it. No new app, no account.</p>
              </div>
              <ul className="lp-list">
                {CHAT.map((c) => (
                  <li key={c.title}><span>{c.title}</span><p>{c.body}</p></li>
                ))}
              </ul>
              <p className="lp-fine">Built for WhatsApp. In the demo, our own chat page stands in for it, with the same coach and rules.</p>
            </div>
          </div>
        </section>

        <section className="lp-section lp-grey" id="exercises" aria-labelledby="ex-title">
          <div className="lp-wrap lp-narrow">
            <div className="lp-head">
              <h2 id="ex-title">Three exercises in the camera demo</h2>
              <p>Each one has its own rules for what counts as a rep, which angle to measure and which mistakes to call out.</p>
            </div>
            <ul className="lp-ex">
              {EXERCISES.map((e) => (
                <li key={e.name}>
                  <div>
                    <h3>{e.name}</h3>
                    <p className="lp-ex-measure">{e.measures}</p>
                    <p className="lp-ex-names">Calls out: {e.names.toLowerCase()}</p>
                  </div>
                  <div className="lp-ex-score">
                    <b className="num">{e.score ?? "Rules"}</b>
                    <span>{e.basis}</span>
                  </div>
                </li>
              ))}
            </ul>
            <p className="lp-fine center">Score: macro F1 on people the model never saw. *Sit-to-stand is measured on lab motion-capture data, not phone or webcam video.</p>
          </div>
        </section>

        <section className="lp-section" id="evidence" aria-labelledby="ev-title">
          <div className="lp-wrap lp-split lp-split-text">
            <div className="lp-head left">
              <h2 id="ev-title">Tested on people the model never saw</h2>
              <p>
                Each model is trained on everyone except one person, then tested on that person, once for every person.
                A real patient is always someone new, so this is the test that matters.
              </p>
              <p className="lp-fine">
                The datasets are healthy adults filmed in labs, and phone video is harder than lab data. Recording our own
                clips in the demo setup is the next step.
              </p>
            </div>
            <dl className="lp-scores">
              {[
                { name: "Arm raise to the side", v: 0.66, basis: "phone and webcam video, 14 people" },
                { name: "Sit-to-stand", v: 0.9, basis: "lab motion capture; no camera F1 yet" },
                { name: "Chair squat", v: 0.79, basis: "phone and webcam video, 14 people" },
              ].map((s) => (
                <div key={s.name}>
                  <dt>{s.name}<span>{s.basis}</span></dt>
                  <dd className="num">{s.v.toFixed(2)}</dd>
                  <span className="lp-bar" style={{ ["--v" as string]: s.v }} aria-hidden />
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="lp-section lp-grey" aria-labelledby="privacy-title">
          <div className="lp-wrap">
            <div className="lp-head">
              <h2 id="privacy-title">The video never leaves the phone</h2>
              <p>Pose tracking and scoring run in the patient&apos;s browser. Only numbers travel.</p>
            </div>
            <ol className="lp-flow">
              <li><span className="lp-flow-n">On the phone</span><p>The camera finds 33 body points in each frame and scores every rep.</p></li>
              <li><span className="lp-flow-n">Sent</span><p>Reps, quality scores and angles. No pictures, no video.</p></li>
              <li><span className="lp-flow-n">Stored</span><p>In a database in Canada, seen only by the patient&apos;s physio.</p></li>
            </ol>
            <p className="lp-center"><Link href="/privacy" className="lp-link">Read the privacy policy <Icon name="arrow" size={16} /></Link></p>
          </div>
        </section>

        <section className="lp-section" id="safety" aria-labelledby="safety-title">
          <div className="lp-wrap">
            <div className="lp-head">
              <h2 id="safety-title">Safety comes first</h2>
              <p>A model scores the reps, fixed rules handle safety, and the AI only writes messages.</p>
            </div>
            <ul className="lp-safety">
              <li className="pain">
                <h3>Pain stops everything</h3>
                <p>&quot;Sharp pain, 8 out of 10&quot;, chest pain, a swollen calf or a fall: the patient is asked to stop, the physio gets an alert, and the reply points to Health811 or 911.</p>
              </li>
              <li>
                <h3>The physio stays in charge</h3>
                <p>Only the physio can change the plan or lift a pain hold. Every AI reply is labelled on the dashboard.</p>
              </li>
              <li>
                <h3>Not a diagnosis</h3>
                <p>Motiva coaches, counts and reports. Angles from one camera show a trend over weeks, not a clinical measurement.</p>
              </li>
            </ul>
          </div>
        </section>

        <section className="lp-section lp-cta-section" aria-labelledby="cta-title">
          <div className="lp-wrap">
            <div className="lp-cta">
              <div className="lp-cta-copy">
                <h2 id="cta-title">See the physio&apos;s side</h2>
                <p>Patients, plans, live sessions and the chat thread. Simulated patients are labelled.</p>
                <Link href="/doctor" className="lp-btn lp-btn-white">Open the physio dashboard <Icon name="arrow" size={18} /></Link>
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
            <span className="lp-brand"><Logo size={24} /></span>
            <p>Home rehab, coached by the phone camera. Built at YHacks 2026.</p>
            <p className="lp-fine">A prototype, not a medical device. In an emergency, call 911.</p>
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
            <h2 id="ft-more">Motiva Health</h2>
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
