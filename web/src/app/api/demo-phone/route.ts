// The demo phone's API (see lib/demo-phone.ts). One POST endpoint, so the patient's key travels in the body, not in
// the address:
//   { token, action: "list" }                    -> the chat, newest last (also marks the coach's messages read)
//   { token, action: "send", text: "..." }       -> a typed message
//   { token, action: "send", button: "why_time" } -> a tapped quick-reply button
// Refuses (404) any patient who is not on the demo channel, so it can never be used to write as a WhatsApp patient.
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { getDb } from "@/lib/db";
import { demoWebhook, parseDemoRequest, RATE, toPhoneMessage, type MessageRow } from "@/lib/demo-phone";
import { deliverAndCoach } from "@/lib/whatsapp/after-inbound";
import { handleWebhook } from "@/lib/whatsapp/inbound";

const MAX_BODY_BYTES = 8 * 1024;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ error: "Too large." }, 413);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "Too large." }, 413);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }
  const req = parseDemoRequest(parsed);
  if (!req.ok) return json({ error: req.error }, req.status);

  const db = await getDb();
  const [patient] = await db.query<{ id: string; phone: string | null; channel: string }>(
    "select id, phone, channel from patients where session_token = $1",
    [req.token],
  );
  if (!patient || patient.channel !== "demo" || !patient.phone) return json({ error: "Not found." }, 404);

  if (req.action === "list") {
    // Opening the chat is reading it: the dashboard then shows "read ✓✓", as with WhatsApp's read receipts.
    await db.query(
      "update messages set status = 'read' where patient_id = $1 and direction = 'out' and status in ('sent', 'delivered')",
      [patient.id],
    );
    const rows = await db.query<MessageRow>(
      `select id, direction, body, coalesce(sent_at, created_at) as at, payload
         from messages
        where patient_id = $1 and (direction = 'in' or status in ('sent', 'delivered', 'read'))
        order by coalesce(sent_at, created_at) desc limit 80`,
      [patient.id],
    );
    return json({ messages: rows.reverse().map(toPhoneMessage) });
  }

  const [count] = await db.query<{ recent: number; today: number }>(
    `select count(*) filter (where created_at > now() - interval '10 minutes')::int as recent,
            count(*) filter (where created_at > now() - interval '1 day')::int as today
       from messages where patient_id = $1 and direction = 'in'`,
    [patient.id],
  );
  if (count.recent >= RATE.perTenMinutes || count.today >= RATE.perDay) {
    return json({ error: "That's a lot of messages. Take a short break and try again in a few minutes." }, 429);
  }

  const { patients, toCoach } = await handleWebhook(demoWebhook(patient.phone, req, `demo.in.${randomUUID()}`));
  after(() => deliverAndCoach(patients, toCoach));
  return json({ ok: true, coachWillAnswer: toCoach.length > 0 });
}
