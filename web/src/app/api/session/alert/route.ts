// The camera session's emergency path: a possible fall seen by the camera, or the patient asking for help out loud
// ("help", "call 911"). The physiotherapist gets an alert at once, and the chat gets a message saying what to do.
// The page itself shows the "Call 911" and "Call <contact>" buttons; nothing here places a call.
import { after } from "next/server";
import { getDb } from "@/lib/db";
import { FALL_REPLY } from "@/lib/safety";
import { processOutbox } from "@/lib/whatsapp/outbox";

const MAX_BODY_BYTES = 4 * 1024;
const REASON = { fall: "possible fall seen by the camera", help: "asked for help out loud" } as const;

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return Response.json({ error: "too large" }, { status: 413 });
  const body = (await request.json().catch(() => ({}))) as { token?: string; kind?: string; exercise?: string };
  if (!body.token || !/^[0-9a-f]{64}$/.test(body.token)) return Response.json({ error: "invalid link" }, { status: 404 });
  if (body.kind !== "fall" && body.kind !== "help") return Response.json({ error: "invalid kind" }, { status: 400 });
  const db = await getDb();
  const [patient] = await db.query<{ id: string }>("select id from patients where session_token = $1", [body.token]);
  if (!patient) return Response.json({ error: "invalid link" }, { status: 404 });
  const during = typeof body.exercise === "string" ? body.exercise.replace(/[^\p{L}\p{N} \-]/gu, "").slice(0, 60) : "a session";
  const detail = `Possible red flag: ${REASON[body.kind]} during ${during}`;
  // One alert per patient every two minutes is enough: a patient lying on the floor is not alerted on twice a second.
  const [recent] = await db.query<{ n: number }>(
    "select count(*)::int as n from alerts where patient_id = $1 and kind = 'red_flag' and created_at > now() - interval '2 minutes'",
    [patient.id],
  );
  if ((recent?.n ?? 0) === 0) {
    await db.query("insert into alerts (patient_id, kind, detail) values ($1, 'red_flag', $2)", [patient.id, detail]);
    await db.query(
      "insert into memories (patient_id, kind, fact, author) values ($1, 'history', $2, 'coach')",
      [patient.id, `${REASON[body.kind][0].toUpperCase()}${REASON[body.kind].slice(1)} during ${during}`],
    );
    await db.query(
      "insert into messages (patient_id, direction, kind, body, payload, status) values ($1, 'out', 'text', $2, $3::jsonb, 'queued')",
      [patient.id, FALL_REPLY, JSON.stringify({ type: "safety_reply", level: "red_flag" })],
    );
    after(() => processOutbox(patient.id));
  }
  return Response.json({ ok: true });
}
