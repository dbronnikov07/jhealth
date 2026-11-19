// The Mac bridge's only door into the server (web/scripts/imessage-bridge.mjs). One POST endpoint, three actions:
//   { action: "inbound", messages: [{ handle, text, guid }] }   texts patients sent to jHealth
//   { action: "claim" }                                        replies waiting to go out (and a heartbeat)
//   { action: "ack", results: [{ id, ok, error? }] }           what happened to them
// Every call needs  Authorization: Bearer <IMESSAGE_BRIDGE_SECRET>  (constant-time compare). Without the secret set
// on the server, the door is shut (503).
import { after } from "next/server";
import { sameSecret } from "@/lib/auth-core";
import { getDb } from "@/lib/db";
import { formatForIMessage, type OutPayload } from "@/lib/imessage/format";
import { handleIMessage } from "@/lib/imessage/inbound";
import { deliverAndCoach } from "@/lib/whatsapp/after-inbound";
import { sessionUrl } from "@/lib/whatsapp/outbox";

const MAX_BODY_BYTES = 64 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const secret = process.env.IMESSAGE_BRIDGE_SECRET;
  if (!secret) return json({ error: "iMessage is not set up on this server." }, 503);
  if (!sameSecret(request.headers.get("authorization") ?? "", `Bearer ${secret}`)) return json({ error: "Unauthorized." }, 401);
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json({ error: "Too large." }, 413);
  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return json({ error: "Too large." }, 413);
  let body: { action?: unknown; messages?: unknown; results?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON." }, 400);
  }

  const db = await getDb();

  if (body.action === "inbound") {
    const list = Array.isArray(body.messages) ? body.messages.slice(0, 50) : [];
    const patients = new Set<string>();
    const toCoach: { patientId: string; messageId: string }[] = [];
    for (const m of list) {
      if (typeof m !== "object" || m === null) continue;
      const { handle, text, guid } = m as Record<string, unknown>;
      if (typeof handle !== "string" || typeof text !== "string" || typeof guid !== "string") continue;
      const r = await handleIMessage({ handle, text, guid });
      if (!r) continue;
      patients.add(r.patientId);
      if (r.coachMessageId) toCoach.push({ patientId: r.patientId, messageId: r.coachMessageId });
    }
    // The coach thinks after we answer; its reply is queued and the bridge collects it on its next claim.
    after(() => deliverAndCoach([...patients], toCoach));
    return json({ ok: true, accepted: patients.size });
  }

  if (body.action === "claim") {
    await db.query("insert into bridge_status (name, last_seen) values ('imessage', now()) on conflict (name) do update set last_seen = now()");
    const claimed = await db.query<{ id: string; body: string | null; payload: OutPayload; handle: string | null; token: string; wrote_recently: boolean }>(
      `select m.id, m.body, m.payload, p.imessage_handle as handle, p.session_token as token,
              exists (select 1 from messages i where i.patient_id = p.id and i.direction = 'in'
                       and i.created_at > now() - interval '24 hours') as wrote_recently
         from claim_outbox_channels(array['imessage'], null, 10) m join patients p on p.id = m.patient_id
        order by m.created_at`,
    );
    const out: { id: string; to: string; text: string }[] = [];
    for (const m of claimed) {
      if (!m.handle || !m.wrote_recently) {
        // Never a cold message: wait until the patient writes (requeue_after_reply sends it then).
        await db.query(
          "update messages set status = 'failed', error_code = 'window', error = $2 where id = $1",
          [m.id, "Waiting for the patient: jHealth only texts people who wrote to it in the last 24 hours. It goes out as soon as they write."],
        );
        continue;
      }
      out.push({ id: m.id, to: m.handle, text: formatForIMessage(m.body ?? "", m.payload, sessionUrl(m.token)) });
    }
    return json({ messages: out });
  }

  if (body.action === "ack") {
    const results = Array.isArray(body.results) ? body.results.slice(0, 50) : [];
    for (const r of results) {
      if (typeof r !== "object" || r === null) continue;
      const { id, ok, error } = r as Record<string, unknown>;
      if (typeof id !== "string" || !UUID.test(id)) continue;
      if (ok === true) {
        await db.query(
          `update messages set status = 'sent', provider_id = $2, sent_at = now(), error = null, error_code = null
            where id = $1 and status = 'sending' and patient_id in (select id from patients where channel = 'imessage')`,
          [id, `imsg.out.${id}`],
        );
      } else {
        await db.query(
          `update messages set status = 'failed', error_code = 'imessage', error = $2
            where id = $1 and status = 'sending' and patient_id in (select id from patients where channel = 'imessage')`,
          [id, `iMessage could not send this: ${String(error ?? "unknown error").slice(0, 200)}`],
        );
      }
    }
    return json({ ok: true });
  }

  return json({ error: "Unknown action." }, 400);
}
