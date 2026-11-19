// Knee bend over time, as a small line chart drawn on the server (no chart library needed).
export function Sparkline({ points }: { points: { at: Date; value: number }[] }) {
  if (points.length < 2) return <p className="muted small">Not enough sessions yet to draw a trend.</p>;
  const w = 560, h = 104, top = 10, bottom = 8, left = 38, right = 64;
  const t0 = points[0].at.getTime(), t1 = points[points.length - 1].at.getTime();
  const vals = points.map((p) => p.value);
  const lo = Math.floor(Math.min(...vals) - 2), hi = Math.ceil(Math.max(...vals) + 2);
  const x = (t: number) => left + ((t - t0) / Math.max(1, t1 - t0)) * (w - left - right);
  const y = (v: number) => h - bottom - ((v - lo) / Math.max(1, hi - lo)) * (h - top - bottom);
  const xy = points.map((p) => [x(p.at.getTime()), y(p.value)] as const);
  const d = xy.map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`).join(" ");
  const area = `${d} L${xy[xy.length - 1][0].toFixed(1)},${h - bottom} L${xy[0][0].toFixed(1)},${h - bottom} Z`;
  const last = points[points.length - 1];
  const [lx, ly] = xy[xy.length - 1];
  const mid = Math.round((hi + lo) / 2);
  // Whole degrees, like every other angle on the page: one camera cannot measure tenths.
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Knee bend from ${Math.round(vals[0])}° to ${Math.round(last.value)}°`}>
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="fill-top" />
          <stop offset="1" className="fill-bottom" />
        </linearGradient>
      </defs>
      <line className="grid" x1={left} x2={w - right} y1={y(hi)} y2={y(hi)} />
      <line className="grid" x1={left} x2={w - right} y1={y(mid)} y2={y(mid)} />
      <line className="axis" x1={left} x2={w - right} y1={h - bottom} y2={h - bottom} />
      <text x={0} y={y(hi) + 4}>{hi}°</text>
      <text x={0} y={y(mid) + 4}>{mid}°</text>
      <text x={0} y={h - bottom}>{lo}°</text>
      <path className="area" d={area} />
      <path className="line" d={d} />
      {points.length <= 24 && xy.slice(0, -1).map(([px, py], i) => <circle key={i} className="pt" cx={px} cy={py} r={2.6} />)}
      <circle className="halo" cx={lx} cy={ly} r={10} />
      <circle className="dot" cx={lx} cy={ly} r={5} />
      <text className="last" x={lx + 14} y={ly + 4}>{Math.round(last.value)}°</text>
    </svg>
  );
}
