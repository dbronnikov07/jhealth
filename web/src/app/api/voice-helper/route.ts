// The fast voice helper checks in here (scripts/voice-bg.sh, every 40 s) with the public address of its tunnel.
// While it keeps checking in, session pages send speech to it instead of our slower hosted functions.
//   POST { url, exp, sig }   sig = HMAC-SHA256(TTS_SECRET, "helper.<exp>.<url>")   (url "" = the helper is stopping)
// Only someone who holds TTS_SECRET can register an address, and only a Cloudflare quick-tunnel address is accepted,
// so patients' speech can never be pointed at a stranger's server. The helper itself only answers requests that
// carry our signed tickets (api/stt.py, api/tts.py).
import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";

const TUNNEL = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 2048) return new Response("Too large", { status: 413 });
  const secret = process.env.TTS_SECRET;
  if (!secret) return new Response("Not configured", { status: 503 });
  const body = (await request.json().catch(() => null)) as { url?: unknown; exp?: unknown; sig?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url : null;
  const exp = typeof body?.exp === "number" ? body.exp : NaN;
  const sig = typeof body?.sig === "string" ? body.sig : "";
  const now = Date.now() / 1000;
  if (url === null || !Number.isFinite(exp) || exp < now || exp > now + 300) return new Response("Forbidden", { status: 403 });
  const want = Buffer.from(createHmac("sha256", secret).update(`helper.${exp}.${url}`).digest("hex"));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return new Response("Forbidden", { status: 403 });
  if (url !== "" && !TUNNEL.test(url)) return new Response("Not a tunnel address", { status: 400 });

  const db = await getDb();
  await db.query(
    `insert into bridge_status (name, last_seen, url) values ('voice', now(), $1)
     on conflict (name) do update set last_seen = now(), url = excluded.url`,
    [url || null],
  );
  return Response.json({ ok: true, using: url || null }, { headers: { "Cache-Control": "no-store" } });
}
