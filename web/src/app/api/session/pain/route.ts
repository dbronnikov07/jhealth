// The "It hurts" button on the session page: the same safety path as a pain message in WhatsApp.
import { after } from "next/server";
import { getDb } from "@/lib/db";
import { HIGH_PAIN_REPLY } from "@/lib/safety";
import { raiseSafetyAlert } from "@/lib/safety-actions";
import { processOutbox } from "@/lib/whatsapp/outbox";

const MAX_BODY_BYTES = 256 * 1024; // a session is at most 200 reps of a few numbers each

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return Response.json({ error: "too large" }, { status: 413 });
  const body = (await request.json().catch(() => ({}))) as { token?: string; exercise?: string };
  if (!body.token || !/^[0-9a-f]{64}$/.test(body.token)) return Response.json({ error: "invalid link" }, { status: 404 });
  const db = await getDb();
  const [patient] = await db.query<{ id: string }>("select id from patients where session_token = $1", [body.token]);
  if (!patient) return Response.json({ error: "invalid link" }, { status: 404 });
  const during = typeof body.exercise === "string" ? body.exercise.slice(0, 60) : "a session";
  await raiseSafetyAlert({
    patientId: patient.id,
    level: "high_pain",
    reason: `pain during ${during} (pressed "It hurts")`,
    reply: HIGH_PAIN_REPLY,
  });
  after(() => processOutbox(patient.id));
  return Response.json({ ok: true, message: HIGH_PAIN_REPLY });
}
