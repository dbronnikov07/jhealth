// A goniometer reading, drawn: the instrument a physiotherapist uses to measure a joint angle.
// The fixed arm lies flat (a straight leg is 0°); the moving arm is drawn at the knee bend, so the glyph
// shows the real angle. An optional dashed arm marks an earlier reading. Purely presentational.
export function Goniometer({
  value,
  previous = null,
  size = 26,
  ticks = false,
  label,
  className = "",
}: {
  value: number;
  previous?: number | null;
  size?: number;
  ticks?: boolean;
  label?: string;
  className?: string;
}) {
  const r = 10, pad = 1.6;
  const cx = r + pad, cy = r + pad;
  const w = 2 * r + 2 * pad, h = r + 2 * pad;
  const at = (deg: number, len = r) => {
    const a = (Math.min(180, Math.max(0, deg)) * Math.PI) / 180;
    return [cx + len * Math.cos(a), cy - len * Math.sin(a)] as const;
  };
  const [ex, ey] = at(value);
  const f = (n: number) => n.toFixed(2);
  return (
    <svg
      className={`gonio ${className}`}
      viewBox={`0 0 ${w} ${h}`}
      width={size}
      height={(size * h) / w}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path className="track" d={`M${f(cx - r)},${f(cy)} A${r},${r} 0 0 1 ${f(cx + r)},${f(cy)}`} />
      {ticks &&
        [30, 60, 90, 120, 150].map((d) => {
          const [x1, y1] = at(d, r - 1.8);
          const [x2, y2] = at(d, r);
          return <line key={d} className="tick" x1={f(x1)} y1={f(y1)} x2={f(x2)} y2={f(y2)} />;
        })}
      <path className="wedge" d={`M${f(cx)},${f(cy)} L${f(cx + r)},${f(cy)} A${r},${r} 0 0 0 ${f(ex)},${f(ey)} Z`} />
      {previous !== null && (() => {
        const [px, py] = at(previous);
        return <line className="prev" x1={f(cx)} y1={f(cy)} x2={f(px)} y2={f(py)} />;
      })()}
      <line className="base" x1={f(cx)} y1={f(cy)} x2={f(cx + r)} y2={f(cy)} />
      <line className="arm" x1={f(cx)} y1={f(cy)} x2={f(ex)} y2={f(ey)} />
      <circle className="pivot" cx={f(cx)} cy={f(cy)} r={1.5} />
    </svg>
  );
}
