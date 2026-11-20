// A photo framed like a postage stamp (perforated edges), with a handwritten tag stuck on the bottom edge.
import Image from "next/image";

export function Stamp({
  src, alt, tag, ratio = "4 / 5", sizes, className = "", priority = false, n,
}: {
  src: string; alt: string; tag?: string; ratio?: string; sizes: string; className?: string; priority?: boolean;
  /** a step number in a black circle on the corner */
  n?: number;
}) {
  return (
    <figure className={`lp-stamp ${className}`}>
      <div className="lp-stamp-paper">
        <div className="lp-stamp-img" style={{ aspectRatio: ratio }}>
          <Image src={src} alt={alt} fill sizes={sizes} priority={priority} />
        </div>
      </div>
      {n !== undefined && <span className="lp-stamp-n" aria-hidden>{n}</span>}
      {tag && <figcaption className="lp-tag">{tag}</figcaption>}
    </figure>
  );
}

/** A hand-drawn arrow for the handwritten notes. */
export function Scribble({ className = "" }: { className?: string }) {
  return (
    <svg className={`lp-scribble ${className}`} viewBox="0 0 120 70" fill="none" aria-hidden>
      <path d="M6 12 C 34 4, 78 14, 102 52" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M88 47 L103 55 L106 38" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** The four-point sparkle from the logo's energy, used sparingly. */
export function Sparkle({ className = "" }: { className?: string }) {
  return (
    <svg className={`lp-sparkle ${className}`} viewBox="0 0 40 40" aria-hidden>
      <path d="M20 0 C 21.5 13, 27 18.5, 40 20 C 27 21.5, 21.5 27, 20 40 C 18.5 27, 13 21.5, 0 20 C 13 18.5, 18.5 13, 20 0 Z" fill="currentColor" />
    </svg>
  );
}
