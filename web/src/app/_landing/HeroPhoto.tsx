// The landing page's hero: a real person exercising at home, with what jHealth's camera session actually measures
// drawn over him. The points are the output of our own MediaPipe pose model (heavy, still-image mode) run on this
// very photo (ml: scratch run 19 Nov 2026, see public/photos/CREDITS.md): not a drawing, not a mock-up.
import Image from "next/image";

// Image pixels of the 1200 x 1800 photo. "l_" is the person's own left (on the right of the picture).
const P = {
  nose: [521, 507], ls: [611, 586], rs: [407, 585], le: [699, 649], re: [370, 622], lw: [790, 691], rw: [337, 637],
  lh: [555, 890], rh: [425, 885], lk: [649, 1035], rk: [403, 1015], la: [559, 1234], ra: [395, 1244],
  lf: [638, 1312], rf: [377, 1332],
} as const;
type Joint = keyof typeof P;

const BONES: [Joint, Joint][] = [
  ["ls", "rs"], ["ls", "le"], ["le", "lw"], ["rs", "re"], ["re", "rw"], ["ls", "lh"], ["rs", "rh"], ["lh", "rh"],
  ["lh", "lk"], ["lk", "la"], ["la", "lf"], ["rh", "rk"], ["rk", "ra"], ["ra", "rf"],
];

/** The knee bend our model measured on this photo (3D world landmarks, the same maths as the app): 79.5 degrees. */
const KNEE_BEND = 80;

/** An arc at the knee from the thigh to the shin, the way a goniometer is read. */
function kneeArc(r = 74) {
  const [kx, ky] = P.lk;
  const a1 = Math.atan2(P.lh[1] - ky, P.lh[0] - kx);
  const a2 = Math.atan2(P.la[1] - ky, P.la[0] - kx);
  const at = (a: number) => `${(kx + r * Math.cos(a)).toFixed(1)} ${(ky + r * Math.sin(a)).toFixed(1)}`;
  // the inside of the knee: sweep from the shin round to the thigh, the short way
  let d = a1 - a2;
  while (d < 0) d += 2 * Math.PI;
  const large = d > Math.PI ? 1 : 0;
  return { wedge: `M${kx} ${ky} L${at(a2)} A${r} ${r} 0 ${large} 1 ${at(a1)} Z`, arc: `M${at(a2)} A${r} ${r} 0 ${large} 1 ${at(a1)}` };
}

export function HeroPhoto() {
  const knee = kneeArc();
  return (
    <figure className="hp">
      <div className="hp-frame">
        <Image
          src="/photos/hero-squat.webp"
          alt="An older man doing a squat in his living room, arms out in front, with a laptop on a stool beside him."
          fill
          priority
          sizes="(min-width: 1100px) 520px, (min-width: 760px) 46vw, 100vw"
          className="hp-photo"
        />
        {/* Same coordinate system as the photo; "slice" crops exactly like object-fit: cover, so the points stay on the joints. */}
        <svg className="hp-track" viewBox="0 0 1200 1800" preserveAspectRatio="xMidYMid slice" aria-hidden>
          <g className="hp-bones">
            {BONES.map(([a, b]) => (
              <line key={a + b} x1={P[a][0]} y1={P[a][1]} x2={P[b][0]} y2={P[b][1]} />
            ))}
          </g>
          <path className="hp-wedge" d={knee.wedge} />
          <path className="hp-arc" d={knee.arc} pathLength={1} />
          <g className="hp-joints">
            {(Object.keys(P) as Joint[]).filter((j) => j !== "nose").map((j) => (
              <circle key={j} cx={P[j][0]} cy={P[j][1]} r={j === "lk" ? 15 : 10} className={j === "lk" ? "on" : undefined} />
            ))}
          </g>
        </svg>

        <div className="hp-chip hp-rep">
          <span>Chair squat</span>
          <b className="num">6<span>/10</span></b>
        </div>
        <div className="hp-chip hp-angle" style={{ left: `${(P.lk[0] / 1200) * 100 + 7}%`, top: `${((P.lk[1] - 150) / 1500) * 100 - 3}%` }}>
          <span>Knee bend</span>
          <b className="num">{KNEE_BEND}°</b>
        </div>
        <p className="hp-cue">Good depth. Now stand up tall.</p>
      </div>
    </figure>
  );
}
