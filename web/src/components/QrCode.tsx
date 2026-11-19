// A QR code drawn as plain SVG on the server (no image service, nothing loaded from elsewhere), for opening the demo
// phone on a real phone by scanning the dashboard.
import { encode } from "uqr";

export function QrCode({ text, size = 176, label }: { text: string; size?: number; label: string }) {
  const { data } = encode(text, { ecc: "M", border: 0 });
  const n = data.length;
  const quiet = 3; // white margin scanners need, in modules
  let d = "";
  data.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x} ${y}h1v1h-1z`; }));
  return (
    <svg
      className="qr"
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`${-quiet} ${-quiet} ${n + 2 * quiet} ${n + 2 * quiet}`}
      shapeRendering="crispEdges"
    >
      <rect x={-quiet} y={-quiet} width={n + 2 * quiet} height={n + 2 * quiet} fill="#ffffff" />
      <path d={d} fill="#060a24" />
    </svg>
  );
}
