// The patient's page, opened by the "Start session" button in WhatsApp. No login: the long random token in
// the link is the key. Camera-scored exercises run a live session on the device; the others are ticked off.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Goniometer } from "@/components/Goniometer";
import { Icon } from "@/components/Icon";
import { getDb } from "@/lib/db";
import { SessionApp, type PlanItem } from "./SessionApp";

export const metadata: Metadata = { title: "Your exercises · jHealth", robots: { index: false, follow: false } };

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
  const [patient] = await db.query<{ id: string; first_name: string }>(
    "select id, split_part(trim(display_name), ' ', 1) as first_name from patients where session_token = $1",
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

  return (
    <main className="page patient">
      <header className="pt-head">
        <span className="brand"><Goniometer value={62} size={32} /><span className="wordmark">j<span>Health</span></span></span>
        <span className="pt-kicker">Your home exercises</span>
      </header>
      <h1>Hi {patient.first_name}, here is today&apos;s plan</h1>
      {items.length > 0 && (
        <p className="pt-sub">{items.length === 1 ? "1 exercise" : `${items.length} exercises`} from your physiotherapist. Take your time.</p>
      )}
      {items.length === 0 ? (
        <p className="empty-plan muted"><Icon name="clipboard" size={30} /><span>Your physiotherapist has not set up your exercises yet. You will get a WhatsApp message when they do.</span></p>
      ) : (
        <SessionApp token={token} items={items} source={source} step={!!source && query.step === "1"} />
      )}
      <div className="reassure">
        <p><Icon name="lock" /> <span>Your video never leaves your phone: only the counts and scores are sent to your physiotherapist.</span></p>
        <p className="safety">
          <Icon name="hand" />
          <span>If anything hurts, stop and press “It hurts” or tell the coach in WhatsApp. <strong>In an emergency, call 911.</strong></span>
        </p>
      </div>
    </main>
  );
}
