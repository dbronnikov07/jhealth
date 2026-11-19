// Product mock-ups for the landing page, built in HTML, CSS and SVG. Names and numbers are illustrative.
import { Goniometer } from "@/components/Goniometer";
import { Icon } from "@/components/Icon";

/**
 * The camera view of a sit-to-stand, side-on: a drawn skeleton, the chair, and a goniometer on the knee.
 * The skeleton is a small rig (shin turns about the ankle, thigh about the knee, trunk about the hip), so on load it
 * can sit down from standing in step with the hero's dial: knee bend 0° to 88°. Its resting pose is the final frame,
 * so without motion (or with reduced motion) the picture is simply the seated reading.
 * The arc on the knee is measured the way a physio places a goniometer: from the line of the thigh to the shin.
 */
function CameraScene() {
  return (
    <svg className="lp-scene" viewBox="0 0 300 640" preserveAspectRatio="xMidYMax slice" aria-hidden>
      <defs>
        <linearGradient id="lp-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#222a3f" />
          <stop offset="1" stopColor="#141a2a" />
        </linearGradient>
        <linearGradient id="lp-floor" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#1d2436" />
          <stop offset="1" stopColor="#0c101b" />
        </linearGradient>
      </defs>
      <rect width="300" height="520" fill="url(#lp-wall)" />
      <rect y="520" width="300" height="120" fill="url(#lp-floor)" />
      <g className="lp-window">
        <rect x="22" y="104" width="92" height="132" rx="3" />
        <path d="M68,104 V236 M22,170 H114" />
      </g>
      <line x1="0" x2="300" y1="520" y2="520" stroke="rgb(255 255 255 / 0.12)" strokeWidth="2" />
      <g className="lp-chair">
        <path d="M70,268 V388 H150 M146,388 V520 M74,388 V520" />
      </g>
      {/* far side of the body, dimmer: the same rig on its own joints */}
      <g className="lp-bones far">
        <path d="M186,510 L214,514" />
        <g className="lp-rig-shin far">
          <path d="M220,406 L186,510" />
          <g className="lp-rig-thigh far">
            <path d="M120,368 L220,406" />
          </g>
        </g>
      </g>
      <g className="lp-bones"><path d="M176,512 L206,516" /></g>
      <g className="lp-rig-shin">
        <g className="lp-bones"><path d="M212,412 L176,512" /></g>
        <g className="lp-rig-thigh">
          {/* goniometer on the knee: fixed arm along the thigh, reading to the shin */}
          <path className="lp-knee-line" d="M212,412 L256.6,429.8" />
          <path className="lp-knee-wedge" pathLength={360} d="M227.78,418.31 A17,17 0 1 1 196.22,405.69 A17,17 0 1 1 227.78,418.31" />
          <g className="lp-bones"><path d="M112,372 L212,412" /></g>
          <g className="lp-rig-trunk">
            <g className="lp-bones far"><path d="M206,253 L230,296 L266,312" /></g>
            <g className="lp-bones"><path d="M209.5,232.6 L198,249 L112,372 M198,249 L238,292 L276,306" /></g>
            <circle className="lp-head" cx="227" cy="208" r="22" />
            <g className="lp-joints">
              <circle cx="198" cy="249" r="5" />
              <circle cx="238" cy="292" r="5" />
              <circle cx="276" cy="306" r="5" />
            </g>
          </g>
          <path className="lp-knee-arc" pathLength={360} d="M243.57,424.63 A34,34 0 1 1 180.43,399.37 A34,34 0 1 1 243.57,424.63" />
          <g className="lp-joints"><circle cx="112" cy="372" r="5" /></g>
        </g>
        <circle className="lp-knee" cx="212" cy="412" r="9" />
      </g>
      <g className="lp-joints">
        <circle cx="176" cy="512" r="5" />
        <circle cx="206" cy="516" r="5" />
      </g>
      <g className="lp-knee-tag">
        <rect x="232" y="374" width="62" height="30" rx="15" />
        <text x="263" y="395" textAnchor="middle">88°</text>
      </g>
    </svg>
  );
}

function CameraPhone() {
  return (
    <div className="lp-phone lp-phone-cam">
      <div className="lp-screen">
        <div className="lp-statusbar"><span>8:14</span><span className="lp-island" /><span className="lp-sb-icons" /></div>
        <div className="lp-stage">
          <CameraScene />
          <div className="lp-hud-top">
            <span className="lp-live"><i />Coach is watching</span>
            <span className="lp-count">18<small>/20</small></span>
          </div>
          <div className="lp-cue"><Icon name="speaker" size={16} /><span>Sit down slowly, with control</span></div>
          <div className="lp-hud-bottom">
            <span>Sit-to-stand · set 2 of 2</span>
            <span className="lp-readout"><small>Knee bend</small> <b><span className="lp-tally"><span>88</span></span>°</b></span>
          </div>
        </div>
        <div className="lp-controls">
          <div className="lp-chips">
            {[94, 91, 96, 74, 90, 93, 95].map((q, i) => (
              <span key={i} className={q < 80 ? "warn" : undefined}>{q}</span>
            ))}
          </div>
          <div className="lp-callbtns">
            <span>End session</span>
            <span className="hurt">It hurts</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function CoachAvatar({ size = 30 }: { size?: number }) {
  return (
    <span className="lp-avatar" style={{ width: size, height: size }}>
      <Goniometer value={62} size={Math.round(size * 0.62)} />
    </span>
  );
}

export function HeroVisual() {
  return (
    <div
      className="lp-visual"
      role="img"
      aria-label="Illustration: a WhatsApp message with a Start session button, the camera session counting a sit-to-stand and reading a knee bend of 88 degrees, and the physio dashboard showing the result."
    >
      <div className="lp-float lp-float-msg" aria-hidden>
        <div className="lp-float-head">
          <CoachAvatar size={28} />
          <span><b>jHealth coach</b><small>WhatsApp · 8:02</small></span>
        </div>
        <p>Good morning, Margaret. Today: sit-to-stand and seated knee extension, 2 sets of 10.</p>
        <span className="lp-wa-btn"><Icon name="play" size={14} /> Start session</span>
      </div>

      <div className="lp-phone-slot" aria-hidden><CameraPhone /></div>

      <div className="lp-float lp-float-board" aria-hidden>
        <div className="lp-float-head">
          <span className="lp-float-title">Physio dashboard</span>
          <span className="lp-float-live">just now</span>
        </div>
        <div className="lp-board-name">
          <b>Margaret T.</b>
          <span className="pill on_track"><i />On track</span>
        </div>
        <div className="lp-board-row">
          <span className="pips"><i className="on" /><i className="on" /><i className="on" /><i className="on" /><i /></span>
          <span className="num">4/5 days</span>
        </div>
        <div className="lp-board-row">
          <Goniometer value={88} previous={81} size={34} />
          <span className="num">81° <span className="faint">→</span> 88°</span>
          <span className="lp-up">▲ 7°</span>
        </div>
      </div>
    </div>
  );
}

type Msg = { side: "in" | "out"; text: string; time: string; note?: string; button?: boolean; tag?: string };

const THREAD: (Msg | { divider: string })[] = [
  { divider: "Monday" },
  {
    side: "in", note: "A", time: "8:02", button: true,
    text: "Good morning, Margaret. Today's plan:\n1. Sit-to-stand, 2 × 10\n2. Seated knee extension, 2 × 10",
  },
  { side: "out", time: "8:31", text: "Done! Knee was stiff at first" },
  {
    side: "in", note: "B", time: "8:31",
    text: "Well done: 20 of 20, quality 91/100. Deepest knee bend 88°, up from 81° last week.\nTip: sit down slowly, with control.",
  },
  { side: "out", time: "8:33", text: "Can I do 3 sets tomorrow?" },
  {
    side: "in", note: "C", time: "8:33", tag: "AI coach",
    text: "Your physiotherapist set 2 sets for now, so keep to that. I have passed your question on to them.",
  },
  { divider: "Wednesday" },
  { side: "out", time: "19:10", text: "sharp pain in my knee, 8 out of 10" },
  {
    side: "in", note: "D", time: "19:10", tag: "Pain rule",
    text: "Thank you for telling me. Please stop today's exercises.\nI have told your physiotherapist so they can contact you.\nIf the pain gets worse, call Health811 (dial 811). In an emergency, call 911.",
  },
];

export function ChatPhone() {
  return (
    <div className="lp-phone lp-phone-chat" role="img" aria-label="Illustration of a WhatsApp conversation between a patient and the jHealth coach.">
      <div className="lp-screen" aria-hidden>
        <div className="lp-statusbar light"><span>8:02</span><span className="lp-island" /><span className="lp-sb-icons" /></div>
        <div className="lp-wa-bar">
          <span className="lp-wa-back">‹</span>
          <CoachAvatar size={34} />
          <span className="lp-wa-who"><b>jHealth coach</b><small>Your physio&apos;s home exercise coach</small></span>
        </div>
        <ol className="lp-thread">
          {THREAD.map((m, i) =>
            "divider" in m ? (
              <li key={i} className="lp-day"><span>{m.divider}</span></li>
            ) : (
              <li key={i} className={`lp-msg ${m.side}`}>
                {m.note && <span className="lp-note-pin">{m.note}</span>}
                <div className="lp-bubble">
                  {m.tag && <span className={`lp-msg-tag${m.tag === "Pain rule" ? " rule" : ""}`}>{m.tag}</span>}
                  <span className="lp-msg-text">{m.text}</span>
                  <span className="lp-msg-time">{m.time}{m.side === "out" && <span className="lp-ticks">✓✓</span>}</span>
                </div>
                {m.button && <span className="lp-msg-btn"><Icon name="play" size={13} /> Start session</span>}
              </li>
            ),
          )}
        </ol>
        <div className="lp-wa-input"><span>Message</span><i /></div>
      </div>
    </div>
  );
}

/* ---------- small vignettes for "How it works" ---------- */

export function PlanVignette() {
  const rows = [
    ["Sit-to-stand", true],
    ["Seated knee extension", true],
    ["Chair squat", false],
  ] as const;
  return (
    <div className="lp-vig lp-vig-plan" aria-hidden>
      <div className="lp-vig-title">Plan for Margaret T.</div>
      {rows.map(([name, on]) => (
        <div key={name} className={`lp-vig-choice${on ? " on" : ""}`}>
          <span className="box">{on && <Icon name="check" size={13} />}</span>
          <span className="name">{name}</span>
          <span className="num">{on ? "2 × 10" : "–"}</span>
        </div>
      ))}
      <span className="lp-vig-btn">Prescribe &amp; message patient</span>
    </div>
  );
}

export function RepVignette() {
  return (
    <div className="lp-vig lp-vig-rep" aria-hidden>
      <div className="lp-vig-reading">
        <Goniometer value={88} previous={81} size={88} ticks />
        <div>
          <small>Knee bend</small>
          <b className="num">88°</b>
        </div>
      </div>
      <div className="lp-vig-chips">
        {[94, 91, 96, 74, 90].map((q, i) => <span key={i} className={q < 80 ? "warn" : undefined}>{q}</span>)}
      </div>
      <div className="lp-vig-say"><Icon name="speaker" size={16} /> “Sit down slowly, with control”</div>
    </div>
  );
}

export function BoardVignette() {
  const rows = [
    { name: "Ahmed K.", status: "alert", label: "Needs review", why: "Pain 8/10 after a session", days: 3 },
    { name: "Lucie B.", status: "stalling", label: "Stalling", why: "Knee bend flat for 2 weeks", days: 4 },
    { name: "Margaret T.", status: "on_track", label: "On track", why: "Knee bend 81° → 88°", days: 4 },
  ] as const;
  return (
    <div className="lp-vig lp-vig-board" aria-hidden>
      {rows.map((r) => (
        <div key={r.name} className={`lp-vig-row st-${r.status}`}>
          <div>
            <b>{r.name}</b>
            <small>{r.why}</small>
          </div>
          <span className={`pill ${r.status}`}><i />{r.label}</span>
          <span className="pips">{Array.from({ length: 5 }, (_, i) => <i key={i} className={i < r.days ? "on" : ""} />)}</span>
        </div>
      ))}
    </div>
  );
}
