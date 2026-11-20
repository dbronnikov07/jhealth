// The demo phone: the patient's chat with the coach on our own site, standing in for WhatsApp (lib/demo-phone.ts).
// Opened from the patient's record on the dashboard. Only for patients on the demo channel; anyone else gets 404.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { getDb } from "@/lib/db";
import { DemoPhone } from "./DemoPhone";
import "./phone.css";

export const metadata: Metadata = { title: "Demo phone · Motiva Health", robots: { index: false, follow: false } };

export default async function DemoPhonePage({ params }: { params: Promise<{ token: string }> }) {
  await connection();
  const { token } = await params;
  if (!/^[0-9a-f]{64}$/.test(token)) notFound();
  const db = await getDb();
  const [patient] = await db.query<{ first_name: string; channel: string }>(
    "select split_part(trim(display_name), ' ', 1) as first_name, channel from patients where session_token = $1",
    [token],
  );
  if (!patient || patient.channel !== "demo") notFound();

  return (
    <main className="dp-page">
      <aside className="dp-caption">
        <span className="dp-eyebrow">Demo phone</span>
        <h1>The coach, without WhatsApp.</h1>
        <p>
          This page stands in for WhatsApp while our WhatsApp Business number is being approved. Messages go through
          the same coach, the same pain rule and the same buttons, and every one appears on the physiotherapist&apos;s
          dashboard.
        </p>
        <p className="dp-caption-small">Video never leaves the phone. Only counts, scores and angles are sent.</p>
      </aside>
      <DemoPhone token={token} firstName={patient.first_name} />
    </main>
  );
}
