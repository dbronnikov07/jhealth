// A patient's recovery story: the phase sign-offs and the wins log. Server-side only. No auth check here:
// the dashboard reaches it through lib/data.ts (physio), the patient's page through its secret link.
import "server-only";
import type { Db } from "./db";
import { DONE, phaseAt, standingSignOffs, type Protocol, type SignOff } from "./phases";

export type Win = { at: Date; text: string; source: "patient" | "doctor" | "camera" | "phase" };
export type { SignOff };

/** Knee bend thresholds worth celebrating the first time they are passed (constants, written into the SQL). */
const BEND_STEPS = [80, 90, 100, 110, 120];
const SESSION_STEPS = [1, 10, 25, 50, 100];

export async function loadRecovery(db: Db, patientId: string, protocol: Protocol, limit = 12) {
  const [signoffRows, winRows, cameraRows] = await Promise.all([
    db.query<{ created_at: Date; from_phase: number; to_phase: number; note: string | null }>(
      "select created_at, from_phase, to_phase, note from phase_signoffs where patient_id = $1 order by created_at desc limit 20",
      [patientId],
    ),
    db.query<{ created_at: Date; text: string; author: "patient" | "doctor" }>(
      "select created_at, text, author from wins where patient_id = $1 order by created_at desc limit 40",
      [patientId],
    ),
    // Wins the camera can see: the first session, round numbers of sessions, and a knee bend passed for the
    // first time (only steps above where the patient started, so the very first session does not earn three).
    db.query<{ kind: "sessions" | "bend"; value: number; at: Date }>(
      `with s as (
         select started_at, knee_bend_deg::float8 as bend, row_number() over (order by started_at) as n
           from sessions where patient_id = $1
       ),
       first_bend as (select bend from s where bend is not null order by n limit 1)
       select 'sessions' as kind, n::int as value, started_at as at from s where n in (${SESSION_STEPS.join(", ")})
       union all
       select 'bend' as kind, t.deg as value, min(s.started_at) as at
         from (values ${BEND_STEPS.map((d) => `(${d})`).join(", ")}) as t(deg) join s on s.bend >= t.deg
        where t.deg > coalesce((select bend from first_bend), 1000)
        group by t.deg`,
      [patientId],
    ),
  ]);

  const signoffs: SignOff[] = signoffRows.map((r) => ({ at: new Date(r.created_at), from: r.from_phase, to: r.to_phase, note: r.note }));
  const wins: Win[] = [
    ...winRows.map((r) => ({ at: new Date(r.created_at), text: r.text, source: r.author })),
    ...cameraRows.map((r) => ({
      at: new Date(r.at),
      source: "camera" as const,
      text: r.kind === "bend"
        ? `Knee bent past ${r.value}° for the first time`
        : r.value === 1 ? "First session done" : `${r.value} sessions done`,
    })),
    ...standingSignOffs(signoffs).map((s) => ({
      at: s.at,
      source: "phase" as const,
      text: s.to >= DONE ? protocol.done : `Phase ${s.from} signed off${phaseAt(protocol, s.to)?.clearance ? `: ${phaseAt(protocol, s.to)!.clearance!.toLowerCase()}` : ""}`,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  return { signoffs, wins: wins.slice(0, limit), winsTotal: wins.length };
}
