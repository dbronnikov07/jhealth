// The public front page: what jHealth is, for judges, clinics and patients. Static, no patient data.
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Goniometer } from "@/components/Goniometer";
import { Icon, type IconName } from "@/components/Icon";
import { ExerciseFigure, HeroDial } from "./_landing/Figures";
import { BoardVignette, ChatPhone, HeroVisual, PlanVignette, RepVignette } from "./_landing/Mockups";
import "./landing.css";

export const metadata: Metadata = {
  title: "jHealth · Home rehab, coached in WhatsApp",
  description:
    "jHealth sends the physiotherapist's exercise plan in WhatsApp. The patient's own phone camera counts and scores every repetition, the video never leaves the phone, and the physio sees how it is going.",
};

// The hero is clinic ink, so the phone's browser bar matches it.
export const viewport: Viewport = { themeColor: "#0b1240" };

const EXERCISES = [
  {
    id: "squat",
    name: "Chair squat",
    measures: "Deepest knee bend",
    names: ["Knees caving in", "Not standing up fully", "Going too fast"],
    scored: "on phone and webcam video, people it never saw",
    score: "0.79",
  },
  {
    id: "sit_to_stand",
    name: "Sit-to-stand",
    measures: "Deepest knee bend",
    names: ["Knees caving in", "Not upright at the top", "Sitting down too fast"],
    scored: "on lab data. On camera, the squat model stands in until it is calibrated",
    score: "0.90",
  },
  {
    id: "seated_knee_extension",
    name: "Seated knee extension",
    measures: "Straightest knee",
    names: ["Not straight", "No 2-second hold", "Leaning back", "Lowering too fast"],
    scored: "a physio can read them. No public labelled data exists yet",
    score: null,
  },
  {
    id: "arm_raise",
    name: "Arm raise to the side",
    measures: "Highest arm angle",
    names: ["Not up to shoulder height", "Bent elbow", "Body swaying", "Going too fast"],
    scored: "on lab data; 0.66 on phone video so far",
    score: "0.97",
  },
] as const;

const NOTES: { pin: string; icon: IconName; title: string; body: string }[] = [
  {
    pin: "A", icon: "play", title: "A daily message with a Start button",
    body: "The plan arrives in the app patients already use. The button opens their own private page: nothing to download, no password.",
  },
  {
    pin: "B", icon: "chart", title: "Progress after every session",
    body: "Reps, quality and knee bend, compared with last time, plus one tip to work on.",
  },
  {
    pin: "C", icon: "chat", title: "Questions answered, checked by code",
    body: "An AI coach writes the replies. Code blocks medicine and dose advice, and the physio sees every reply, labelled.",
  },
  {
    pin: "D", icon: "alert", title: "Pain goes to fixed rules, never the AI",
    body: "Pain of 7 out of 10 or more, or a red flag, gets a fixed safety reply, an alert for the physio and no Start button until the physio has looked.",
  },
];

export default function Landing() {
  return (
    <div className="lp">
      <a className="lp-skip" href="#main">Skip to content</a>

      {/* ---------- navigation: stays with the reader, clinic ink like the dashboard's bar ---------- */}
      <header className="lp-navbar">
        <nav className="lp-nav" aria-label="Main">
          <Link href="/" className="lp-brand" aria-label="jHealth home">
            <Goniometer value={62} size={30} />
            <span>j<span>Health</span></span>
          </Link>
          <div className="lp-nav-links">
            <a href="#how">How it works</a>
            <a href="#exercises">Exercises</a>
            <a href="#evidence">Evidence</a>
            <a href="#safety">Safety</a>
            <Link href="/privacy">Privacy</Link>
          </div>
          <Link href="/doctor" className="lp-btn lp-btn-light lp-nav-cta">
            <span className="long">Open the physio dashboard</span><span className="short">Dashboard</span>
            <Icon name="arrow" size={18} />
          </Link>
        </nav>
      </header>

      <main id="main">
        {/* ---------- hero ---------- */}
        <section className="lp-hero" aria-labelledby="hero-title">
          <HeroDial value={88} />
          <div className="lp-hero-grid">
            <div className="lp-hero-copy">
              <p className="lp-kicker"><i aria-hidden /> Home rehab after knee and hip surgery</p>
              <h1 id="hero-title">The home exercise plan that <em>reports back.</em></h1>
              <p className="lp-lede">
                The physiotherapist&apos;s plan arrives in WhatsApp. One tap opens the camera on the patient&apos;s own phone,
                which counts every repetition, scores it and says what to fix. The physio sees the numbers.
              </p>
              <div className="lp-actions">
                <Link href="/doctor" className="lp-btn lp-btn-light">Open the physio dashboard <Icon name="arrow" size={18} /></Link>
                <a href="#how" className="lp-btn lp-btn-ghost">How it works <Icon name="down" size={18} /></a>
              </div>
              <ul className="lp-promises">
                <li><Icon name="check" size={18} /> Nothing to install</li>
                <li><Icon name="lock" size={18} /> Video stays on the phone</li>
                <li><Icon name="user" size={18} /> Physio in the loop</li>
              </ul>
            </div>
            <HeroVisual />
          </div>
        </section>

        {/* ---------- who it is for ---------- */}
        <section className="lp-context" aria-label="Who it is for">
          <div className="lp-wrap lp-context-grid">
            <div>
              <h2 className="lp-label">Who it is for</h2>
              <p>Adults recovering at home after a knee or hip replacement, and people with knee or hip osteoarthritis following a physiotherapist&apos;s plan. Mostly aged 55 and up.</p>
            </div>
            <div>
              <h2 className="lp-label">How many</h2>
              <p>
                <b className="num">117,000+</b> hip and knee replacements in Canada in 2021–2022.{" "}
                <a className="lp-src" href="https://www.cihi.ca/en/cjrr-annual-report-hip-and-knee-replacements-in-canada-2021-2022" target="_blank" rel="noreferrer">Source: CIHI</a>
              </p>
            </div>
            <div>
              <h2 className="lp-label">Who pays</h2>
              <p>The hospital or clinic. It is already paid for the rehab, and today it cannot see what happens at home.</p>
            </div>
          </div>
        </section>

        {/* ---------- how it works ---------- */}
        <section className="lp-section" id="how" aria-labelledby="how-title">
          <div className="lp-wrap">
            <div className="lp-head">
              <h2 id="how-title">Prescribed in the clinic. Done at home. <span>Seen by the physio.</span></h2>
              <p>Three steps, and the patient only ever touches one of them.</p>
            </div>
            <ol className="lp-steps">
              <li>
                <div className="lp-step-text">
                  <span className="lp-step-n"><b>1</b> Physio</span>
                  <h3>The physio prescribes</h3>
                  <p>Tick the exercises, the sets and the reps. The plan goes out as a WhatsApp message with a Start button.</p>
                </div>
                <PlanVignette />
              </li>
              <li>
                <div className="lp-step-text">
                  <span className="lp-step-n"><b>2</b> Patient</span>
                  <h3>The phone coaches every rep</h3>
                  <p>The button opens a page that turns on the camera. It counts each repetition out loud, scores it, and says what to fix.</p>
                </div>
                <RepVignette />
              </li>
              <li>
                <div className="lp-step-text">
                  <span className="lp-step-n"><b>3</b> Physio</span>
                  <h3>The physio sees the work</h3>
                  <p>Adherence, quality and knee bend, within seconds of a finished session. Pain and stalled progress rise to the top.</p>
                </div>
                <BoardVignette />
              </li>
            </ol>
          </div>
        </section>

        {/* ---------- the conversation ---------- */}
        <section className="lp-section lp-tint" aria-labelledby="chat-title">
          <div className="lp-wrap lp-chat-grid">
            <ChatPhone />
            <div className="lp-chat-copy">
              <div className="lp-head left">
                <h2 id="chat-title">It all happens in WhatsApp</h2>
                <p>Patients do not learn a new app. The coach writes like a person; the hard rules live in code.</p>
              </div>
              <ol className="lp-notes">
                {NOTES.map((n) => (
                  <li key={n.pin}>
                    <span className="lp-note-pin" aria-hidden>{n.pin}</span>
                    <div>
                      <h3>{n.title}</h3>
                      <p>{n.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
              <p className="lp-fine">Example conversation. Names and numbers are illustrative.</p>
            </div>
          </div>
        </section>

        {/* ---------- the four exercises ---------- */}
        <section className="lp-section" id="exercises" aria-labelledby="ex-title">
          <div className="lp-wrap">
            <div className="lp-head">
              <h2 id="ex-title">Four exercises the camera can score</h2>
              <p>Each has its own profile: what counts as one repetition, which angle is measured, and which mistakes are named out loud.</p>
            </div>
            <ul className="lp-ex-grid">
              {EXERCISES.map((e) => (
                <li key={e.id} className="lp-ex">
                  <div className="lp-ex-figure">
                    <ExerciseFigure id={e.id} title={`${e.name}: start position dashed, end position solid, measured angle marked`} />
                  </div>
                  <div className="lp-ex-body">
                    <h3>{e.name}</h3>
                    <dl>
                      <div><dt>Measures</dt><dd>{e.measures}</dd></div>
                      <div><dt>Names</dt><dd>{e.names.join(" · ")}</dd></div>
                    </dl>
                    <p className="lp-ex-score">
                      {e.score ? <b className="num">{e.score}</b> : <b className="rules">Rules</b>}
                      <span>{e.scored}</span>
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ---------- evidence ---------- */}
        <section className="lp-section lp-evidence" id="evidence" aria-labelledby="ev-title">
          <div className="lp-wrap">
            <div className="lp-ev-grid">
              <div className="lp-head left">
                <h2 id="ev-title">Tested on people the model never saw</h2>
                <p>
                  Each model is trained on everyone but one person, then tested on that person, once for every person. A real
                  patient is always someone new, so this is the test that predicts real life.
                </p>
                <p className="lp-fine">
                  Score: macro F1 for telling a correct repetition from a wrong one. 1.0 is perfect; always answering
                  “correct” scores about 0.35 to 0.4, the thin mark on each bar.
                </p>
              </div>
              <dl className="lp-scores">
                <div>
                  <dt>Sit-to-stand</dt>
                  <dd><b className="num">0.90</b><span>on lab motion-capture data</span></dd>
                  <span className="lp-bar" style={{ ["--v" as string]: 0.9 }} aria-hidden />
                </div>
                <div>
                  <dt>Arm raise to the side</dt>
                  <dd><b className="num">0.97</b><span>on lab motion-capture data</span></dd>
                  <span className="lp-bar" style={{ ["--v" as string]: 0.97 }} aria-hidden />
                </div>
                <div>
                  <dt>Chair squat</dt>
                  <dd><b className="num">0.79</b><span>on phone and webcam video, 14 people</span></dd>
                  <span className="lp-bar camera" style={{ ["--v" as string]: 0.79 }} aria-hidden />
                </div>
              </dl>
            </div>
            <ul className="lp-proofs">
              <li>
                <b className="num">193 of 195</b>
                <span>squat repetitions hand-marked by a physiotherapist were found by the live rep counter, with no false ones.</span>
              </li>
              <li>
                <b className="num">6 decimals</b>
                <span>The browser and the Python training code give the same score to six decimal places: the patient&apos;s phone runs the same model.</span>
              </li>
              <li>
                <b>Said plainly</b>
                <span>
                  The datasets are healthy adults in labs, not older patients at home, and phone video is harder than lab
                  data. Recording our own clips in the demo setup is the next step.
                </span>
              </li>
            </ul>
          </div>
        </section>

        {/* ---------- privacy ---------- */}
        <section className="lp-section lp-ink" aria-labelledby="privacy-title">
          <div className="lp-wrap lp-privacy-grid">
            <div className="lp-head left">
              <h2 id="privacy-title">The video never leaves the phone</h2>
              <p>
                Pose tracking and the scoring model run inside the patient&apos;s browser. They are served by jHealth itself, so
                once the page has loaded, a weak connection does not matter.
              </p>
              <Link href="/privacy" className="lp-btn lp-btn-ghost">Read the privacy policy <Icon name="arrow" size={18} /></Link>
            </div>
            <ol className="lp-flow" aria-label="What happens to the data">
              <li>
                <span className="lp-flow-icon"><Icon name="camera" size={22} /></span>
                <div><h3>On the phone</h3><p>Camera, 33 body points per frame, joint angles, a score for each repetition.</p></div>
              </li>
              <li className="lp-flow-wire">
                <span className="lp-flow-icon"><Icon name="lock" size={22} /></span>
                <div>
                  <h3>Only numbers are sent</h3>
                  <pre className="lp-payload" aria-label="Example of what is sent for one repetition">{`{ "quality": 0.91,
  "fault": null,
  "knee_bend_deg": 88,
  "rom_deg": null,
  "duration_s": 2.4 }`}</pre>
                </div>
              </li>
              <li>
                <span className="lp-flow-icon"><Icon name="chart" size={22} /></span>
                <div><h3>To the physio</h3><p>The dashboard, and a progress message back in WhatsApp.</p></div>
              </li>
            </ol>
          </div>
        </section>

        {/* ---------- safety ---------- */}
        <section className="lp-section" id="safety" aria-labelledby="safety-title">
          <div className="lp-wrap">
            <div className="lp-head">
              <h2 id="safety-title">Safe by design, with the physio in charge</h2>
              <p>Three jobs, three tools: a model scores the repetition, rules handle mistakes and safety, and the AI only writes text.</p>
            </div>
            <ul className="lp-safety">
              <li className="pain">
                <span className="lp-safety-icon"><Icon name="hand" size={24} /></span>
                <h3>Pain stops everything</h3>
                <p>
                  “Sharp pain, 8 out of 10”, chest pain, a swollen calf or a fall: plain code, never the AI, asks the patient
                  to stop, alerts the physio and points to Health811 or 911. Every camera session has an “It hurts” button.
                </p>
              </li>
              <li>
                <span className="lp-safety-icon"><Icon name="user" size={24} /></span>
                <h3>The physio stays in the loop</h3>
                <p>
                  The physiotherapist prescribes and changes the plan; the coach cannot. Every AI reply is labelled on the
                  dashboard, and only the physio can lift a pain hold.
                </p>
              </li>
              <li>
                <span className="lp-safety-icon"><Icon name="shield" size={24} /></span>
                <h3>Not a diagnosis</h3>
                <p>
                  jHealth coaches, counts and reports. Angles from one camera are a trend over weeks, not a clinical
                  measurement.
                </p>
              </li>
            </ul>
          </div>
        </section>

        {/* ---------- call to action ---------- */}
        <section className="lp-section lp-cta-wrap" aria-labelledby="cta-title">
          <div className="lp-wrap">
            <div className="lp-cta">
              <Goniometer value={88} previous={81} size={120} ticks className="lp-cta-gonio" />
              <div>
                <h2 id="cta-title">See the physio&apos;s side</h2>
                <p>Patients, plans, live sessions and the WhatsApp thread. Simulated patients are labelled; a finished session shows up within seconds.</p>
              </div>
              <div className="lp-actions">
                <Link href="/doctor" className="lp-btn lp-btn-light">Open the physio dashboard <Icon name="arrow" size={18} /></Link>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="lp-footer">
        <div className="lp-wrap lp-footer-grid">
          <div className="lp-footer-about">
            <span className="lp-brand small"><Goniometer value={62} size={24} /><span>j<span>Health</span></span></span>
            <p>Home rehab, coached in WhatsApp. Built at YHacks 2026.</p>
            <p className="lp-footer-fine">A prototype: not a medical device, and not a diagnosis. In an emergency, call 911.</p>
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
