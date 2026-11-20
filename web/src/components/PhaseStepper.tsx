// The recovery journey: the same four segments for every patient. What it takes to finish each one depends on
// their operation (lib/phases.ts), and only the physiotherapist moves them on.
import { DONE, PHASES, type Protocol } from "@/lib/phases";

export function PhaseStepper({ protocol, phase }: { protocol: Protocol; phase: number }) {
  return (
    <ol className="stepper" aria-label={`Recovery: ${phase >= DONE ? protocol.done : `phase ${phase} of ${PHASES}`}`}>
      {protocol.phases.map((p, i) => {
        const n = i + 1;
        const state = n < phase ? "done" : n === phase ? "now" : "next";
        return (
          <li key={n} className={state} aria-current={state === "now" ? "step" : undefined}>
            <span className="bar" aria-hidden />
            <span className="n">Phase {n}{state === "done" ? " ✓" : ""}</span>
            <span className="name">{p.name}</span>
            <span className="clear">{p.clearance ?? "Starting point"}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** The one-line version for the dashboard's patient rows. */
export function PhaseMini({ protocol, phase }: { protocol: Protocol; phase: number }) {
  const label = phase >= DONE ? protocol.done : `Phase ${phase} · ${protocol.phases[phase - 1].name}`;
  return (
    <span className="phase-mini">
      <span className="segs" aria-hidden>
        {protocol.phases.map((_, i) => <i key={i} className={i + 1 < phase ? "done" : i + 1 === phase ? "now" : ""} />)}
      </span>
      <span>{label}</span>
    </span>
  );
}
