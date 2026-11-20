// The patient's page, opened by the "Start session" button in WhatsApp. No login: the long random token in
// the link is the key. Camera-scored exercises run a live session on the device; the others are ticked off.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Logo } from "@/components/Logo";
import { Icon } from "@/components/Icon";
import { PhaseStepper } from "@/components/PhaseStepper";
import { getDb } from "@/lib/db";
import { checkCriteria, earnedClearances, nextClearance, PHASES, phaseAt, protocolFor } from "@/lib/phases";
import { loadRecovery } from "@/lib/recovery";
import { slotLong } from "@/lib/visits";
import { logWin } from "./actions";
import { SessionApp, type PlanItem } from "./SessionApp";
import { sttTicket } from "@/lib/coach/voice-coach";

// What iMessage shows as the link preview when the coach texts this page. Nothing personal: the same for everyone.
export const metadata: Metadata = {
  title: "Your exercises · Motiva Health",
  robots: { index: false, follow: false },
  openGraph: {
    title: "Today's exercises from your physio",
    description: "Tap to start. Your phone camera counts every rep, and the video stays on your phone.",
    images: [{ url: "/photos/og-session.jpg", width: 1200, height: 630, alt: "An older man doing a squat with Motiva Health's tracking on him" }],
    siteName: "Motiva Health",
  },
};

/** ?source=/test/clip.mp4 runs the session on a video file instead of the camera: for local testing, and as a
 *  stage fallback when ALLOW_TEST_VIDEO=1. Only files served by this app are accepted. */
function videoSource(raw: string | string[] | undefined): string | null {
  const allowed = process.env.NODE_ENV !== "production" || process.env.ALLOW_TEST_VIDEO === "1";
  if (!allowed || typeof raw !== "string") return null;
  return /^\/(?!\/)[\w\-./]+\.(mp4|webm|mov)$/.test(raw) ? raw : null;
}

export default async function SessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await connection();
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();
  const db = await getDb();
  const [patient] = await db.query<{
    id: string; first_name: string; channel: string; emergency_name: string | null; emergency_phone: string | null;
    condition: string; phase: number;
  }>(
    `select id, split_part(trim(display_name), ' ', 1) as first_name, channel, emergency_name, emergency_phone, condition, phase
       from patients where session_token = $1`,
    [token],
  );
  if (!patient) notFound();
  const query = await searchParams;
  const source = videoSource(query.source);
  const items = await db.query<PlanItem>(
    `select e.id as exercise_id, e.name, e.instructions, pe.sets, pe.reps, e.tracking, e.model_key,
            exists (select 1 from sessions s where s.patient_id = r.patient_id and s.exercise_id = e.id
                     and s.started_at >= date_trunc('day', now())) as done_today
       from prescriptions r
       join prescription_exercises pe on pe.prescription_id = r.id
       join exercises e on e.id = pe.exercise_id
      where r.patient_id = $1 and r.status = 'active'
      order by pe.position`,
    [patient.id],
  );
  const protocol = protocolFor(patient.condition);
  const phase = phaseAt(protocol, patient.phase);
  const [[week], recovery] = await Promise.all([
    db.query<{ bend_7d: number | null; days_active_7d: number; quality_7d: number | null }>(
      "select bend_7d, days_active_7d, quality_7d from patient_overview where id = $1",
      [patient.id],
    ),
    loadRecovery(db, patient.id, protocol, 6),
  ]);
  // The team's fast voice helper, if it has checked in during the last two minutes.
  const [helper] = await db.query<{ url: string }>(
    "select url from bridge_status where name = 'voice' and url is not null and last_seen > now() - interval '2 minutes'",
  );
  const [visit] = await db.query<{ status: string; chosen_at: Date | null; clinic: string | null }>(
    `select v.status, v.chosen_at, d.clinic from visits v left join doctors d on d.id = v.doctor_id
      where v.patient_id = $1 and (v.status = 'proposed' or (v.status = 'confirmed' and v.chosen_at > now() - interval '2 hours'))
      order by v.created_at desc limit 1`,
    [patient.id],
  );
  const checked = phase && week ? checkCriteria(phase, { bend: week.bend_7d, days: week.days_active_7d, quality: week.quality_7d }) : [];
  const earned = earnedClearances(protocol, patient.phase);
  const logged = new Set(recovery.wins.map((w) => w.text));
  const suggestions = (phase ?? protocol.phases[PHASES - 1]).wins.filter((w) => !logged.has(w));

  return (
    <main className="page patient">
      <header className="pt-head">
        <span className="brand"><Logo size={30} /></span>
        {patient.channel === "demo" ? (
          <a className="pt-kicker" href={`/s/${token}/phone`}>← Back to the chat</a>
        ) : (
          <span className="pt-kicker">Your home exercises</span>
        )}
      </header>
      <h1>Hi {patient.first_name}, here is today&apos;s plan</h1>
      {visit?.status === "confirmed" && visit.chosen_at && (
        <p className="visit-banner"><Icon name="clipboard" size={26} /><span><b>Your check-up:</b> {slotLong(new Date(visit.chosen_at))}{visit.clinic ? `, ${visit.clinic}` : ""}</span></p>
      )}
      {visit?.status === "proposed" && (
        <p className="visit-banner wait"><Icon name="chat" size={26} /><span><b>Your physiotherapist offered a check-up.</b> Pick a time in the chat.</span></p>
      )}
      {items.length > 0 && (
        <p className="pt-sub">{items.length === 1 ? "1 exercise" : `${items.length} exercises`} from your physiotherapist. Take your time.</p>
      )}
      {items.length === 0 ? (
        <p className="empty-plan muted"><Icon name="clipboard" size={30} /><span>Your physiotherapist has not set up your exercises yet. You will get a message from the coach when they do.</span></p>
      ) : (
        <SessionApp
          token={token} items={items} source={source} step={!!source && query.step === "1"}
          emergency={patient.emergency_name && patient.emergency_phone ? { name: patient.emergency_name, phone: patient.emergency_phone } : null}
          listenTicket={sttTicket()}
          voiceHelper={helper?.url ?? null}
        />
      )}
      <section className="journey" aria-labelledby="journey-title">
        <p className="journey-kicker">Your recovery</p>
        <h2 id="journey-title">{phase ? `Phase ${patient.phase} of ${PHASES}: ${phase.name}` : protocol.done}</h2>
        <PhaseStepper protocol={protocol} phase={patient.phase} />
        {phase && (
          <div className="journey-next">
            <p className="journey-goal"><span>Next milestone</span> {nextClearance(protocol, patient.phase)}</p>
            <p className="muted">What your physiotherapist looks for:</p>
            <ul className="criteria big">
              {checked.map((c) => (
                <li key={c.text} className={c.met === null ? "physio" : c.met ? "met" : "unmet"}>
                  <span className="mark" aria-hidden>{c.met ? "✓" : ""}</span>
                  <span className="what">{c.text}</span>
                  {c.met !== null && <span className="how">{c.met ? "Done" : `This week: ${c.reading}`}</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {earned.length > 0 && (
          <p className="journey-earned"><Icon name="check" size={20} /> {earned.join(" · ")}</p>
        )}
        <p className="journey-pace">Every recovery moves at its own pace. Your physiotherapist decides when you are ready for the next step.</p>
      </section>
      <section className="wins-pt" aria-labelledby="wins-title">
        <h2 id="wins-title">Your wins</h2>
        {recovery.wins.length > 0 ? (
          <ul className="wins">
            {recovery.wins.map((w, i) => (
              <li key={i}>
                <span className="win-dot" aria-hidden><Icon name="check" size={16} /></span>
                <span className="what">{w.text}</span>
                <span className="when">{new Intl.DateTimeFormat("en-CA", { month: "short", day: "numeric", timeZone: "America/Toronto" }).format(w.at)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Small things count. Tap one when it happens.</p>
        )}
        {suggestions.length > 0 && (
          <form action={logWin.bind(null, token)} className="win-quick">
            {suggestions.map((w) => (
              <button key={w} type="submit" name="win" value={w} className="win-chip"><Icon name="plus" size={18} /> {w}</button>
            ))}
          </form>
        )}
        <form action={logWin.bind(null, token)} className="win-own">
          <input type="text" name="win" placeholder="Something else, e.g. first full bike turn" aria-label="Your own win" maxLength={120} minLength={2} required />
          <button type="submit" className="btn">Add win</button>
        </form>
      </section>
      <div className="reassure">
        <p><Icon name="lock" /> <span>Your video never leaves your phone: only the counts and scores are sent to your physiotherapist.</span></p>
        <p className="safety">
          <Icon name="hand" />
          <span>If anything hurts, stop and press “It hurts” or tell the coach in the chat. <strong>In an emergency, call 911.</strong></span>
        </p>
      </div>
    </main>
  );
}
