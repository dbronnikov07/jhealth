// The Motiva Health logo: the two-wave mark (public/brand/motiva-mark.png, cut from the company logo) and the
// wordmark set in type, "Motiva" over a spaced-out "HEALTH", as in the original.
// On a dark background the mark sits on a small white tile, so its sage and slate stay true.

export function MotivaMark({ size = 28, tile = false }: { size?: number; tile?: boolean }) {
  // eslint-disable-next-line @next/next/no-img-element
  const img = <img src="/brand/motiva-mark.png" alt="" width={Math.round(size * 1.2)} height={size} className="motiva-mark" />;
  return tile ? <span className="motiva-tile" style={{ width: size * 1.55, height: size * 1.55 }} aria-hidden>{img}</span> : <span aria-hidden>{img}</span>;
}

export function Logo({ size = 28, tile = false, compact = false }: { size?: number; tile?: boolean; compact?: boolean }) {
  return (
    <span className={`motiva-logo${compact ? " compact" : ""}`} style={{ fontSize: size * 0.82 }}>
      <MotivaMark size={size} tile={tile} />
      <span className="motiva-word">
        <b>Motiva</b>
        <small>Health</small>
      </span>
    </span>
  );
}
