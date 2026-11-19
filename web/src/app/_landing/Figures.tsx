// Line drawings in the style of a physiotherapist's home-exercise sheet: the start position faint and dashed,
// the end position in ink, and an arc on the joint the camera measures. Drawn by hand as SVG: no photos of people.
type Id = "squat" | "sit_to_stand" | "seated_knee_extension" | "arm_raise";

const Chair = ({ x0, x1, seat, back }: { x0: number; x1: number; seat: number; back: number }) => (
  <g className="fig-chair">
    <path d={`M${x0},${back} V${seat} H${x1} M${x0 + 4},${seat} V158 M${x1 - 4},${seat} V158`} />
  </g>
);

export function ExerciseFigure({ id, title }: { id: Id; title: string }) {
  const arrow = `url(#fig-arrow-${id})`;
  return (
    <svg className="fig" viewBox="0 0 220 170" role="img" aria-label={title}>
      <line className="fig-floor" x1="14" x2="206" y1="158" y2="158" />
      {id === "squat" && (
        <>
          <Chair x0={30} x1={80} seat={114} back={62} />
          <g className="fig-ghost">
            <circle cx="118" cy="40" r="11" />
            <path d="M118,51 V98 L121,126 L118,154 L134,156 M118,62 L121,80 L124,98" />
          </g>
          <path className="fig-move" d="M108,84 Q92,84 88,98" markerEnd={arrow} />
          <path className="fig-wedge" d="M140,118 L118.8,112.2 A22,22 0 0 0 128.5,136.8 Z" />
          <g className="fig-body">
            <circle cx="129" cy="45" r="11" />
            <path d="M124,55 L96,106 L140,118 L118,154 L136,156 M120,63 L140,80 L162,82" />
          </g>
          <path className="fig-arc" d="M118.8,112.2 A22,22 0 0 0 128.5,136.8" />
          <circle className="fig-joint" cx="140" cy="118" r="4.5" />
        </>
      )}
      {id === "sit_to_stand" && (
        <>
          <Chair x0={28} x1={80} seat={114} back={64} />
          <g className="fig-ghost">
            <circle cx="74" cy="47" r="11" />
            <path d="M72,58 L62,108 L104,108 L104,154 L120,156 M70,68 L82,88 L98,100" />
          </g>
          <path className="fig-wedge" d="M104,108 L82,108 A22,22 0 0 0 104,130 Z" />
          <path className="fig-arc" d="M82,108 A22,22 0 0 0 104,130" />
          <path className="fig-move" d="M70,96 Q74,78 96,82" markerEnd={arrow} />
          <g className="fig-body">
            <circle cx="132" cy="36" r="11" />
            <path d="M132,47 V96 L134,126 L132,154 L148,156 M132,58 L134,78 L136,98" />
          </g>
          <circle className="fig-joint" cx="104" cy="108" r="4.5" />
        </>
      )}
      {id === "seated_knee_extension" && (
        <>
          <Chair x0={30} x1={90} seat={108} back={56} />
          <g className="fig-ghost">
            <path d="M112,102 L112,152 L128,154" />
          </g>
          <path className="fig-wedge" d="M112,102 L112,128 A26,26 0 0 0 138,102 Z" />
          <path className="fig-move" d="M114,136 A34,34 0 0 0 146,104" markerEnd={arrow} />
          <g className="fig-body">
            <circle cx="72" cy="38" r="11" />
            <path d="M71,49 L66,102 L112,102 L162,100 L166,86 M69,62 L80,82 L98,96" />
          </g>
          <circle className="fig-joint" cx="112" cy="102" r="4.5" />
        </>
      )}
      {id === "arm_raise" && (
        <>
          <g className="fig-ghost">
            <path d="M130,56 L134,82 L137,106" />
          </g>
          <path className="fig-wedge" d="M130,56 L130,84 A28,28 0 0 0 158,56 Z" />
          <path className="fig-move" d="M138,94 A38,38 0 0 0 168,62" markerEnd={arrow} />
          <g className="fig-body">
            <circle cx="110" cy="33" r="11" />
            <path d="M110,44 V104 M90,56 H130 M98,104 H122 M98,104 L96,154 L86,156 M122,104 L124,154 L134,156 M90,56 L86,82 L83,106 M130,56 L156,56 L184,56" />
          </g>
          <circle className="fig-joint" cx="130" cy="56" r="4.5" />
        </>
      )}
      <defs>
        <marker id={`fig-arrow-${id}`} viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path className="fig-arrowhead" d="M1,1 L8,5 L1,9" />
        </marker>
      </defs>
    </svg>
  );
}

/**
 * The hero's background: a goniometer the size of the page. The fixed arm lies along the floor (0°), the moving arm
 * sweeps up to 88°, the same knee bend the phone in the hero is reading.
 */
export function HeroDial({ value = 88 }: { value?: number }) {
  const cx = 700, cy = 700, r = 640;
  const pt = (deg: number, rr: number) => {
    const a = (deg * Math.PI) / 180;
    return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)] as const;
  };
  const f = (n: number) => n.toFixed(1);
  const ticks = [];
  for (let d = 0; d <= 180; d += 2) {
    const major = d % 30 === 0;
    const mid = d % 10 === 0;
    const [x1, y1] = pt(d, r - (major ? 30 : mid ? 18 : 9));
    const [x2, y2] = pt(d, r);
    ticks.push(<line key={d} className={major ? "major" : mid ? "mid" : undefined} x1={f(x1)} y1={f(y1)} x2={f(x2)} y2={f(y2)} />);
  }
  // Only the three readings that stay clear of the headline and the phone.
  const labels = [0, 90, 180].map((d) => {
    const [x, y] = pt(d, r - 54);
    return <text key={d} x={f(x)} y={f(y + 6)} textAnchor="middle">{d}°</text>;
  });
  const [tx, ty] = pt(value, r + 34);
  const [wx, wy] = pt(value, 210);
  return (
    <svg className="lp-dial" viewBox="0 0 1400 720" preserveAspectRatio="xMidYMax meet" aria-hidden>
      <path className="ring" d={`M${cx - r},${cy} A${r},${r} 0 0 1 ${cx + r},${cy}`} />
      <path className="ring inner" d={`M${cx - r + 120},${cy} A${r - 120},${r - 120} 0 0 1 ${cx + r - 120},${cy}`} />
      <g className="ticks">{ticks}</g>
      <g className="labels">{labels}</g>
      <path className="sweep" pathLength={100} d={`M${cx + 210},${cy} A210,210 0 0 0 ${f(wx)},${f(wy)}`} />
      <line className="fixed" x1={cx} y1={cy} x2={cx + r} y2={cy} />
      <g className="moving" style={{ ["--to" as string]: `${-value}deg` }}>
        <line x1={cx} y1={cy} x2={cx + r + 6} y2={cy} />
        <circle cx={cx + r + 6} cy={cy} r="7" />
      </g>
      <circle className="pivot" cx={cx} cy={cy} r="14" />
      <text className="reading" x={f(tx)} y={f(ty)} textAnchor="middle">{value}°</text>
    </svg>
  );
}
