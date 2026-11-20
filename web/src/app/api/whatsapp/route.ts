// The WhatsApp webhook. In Meta's app settings: Callback URL = https://<your app>/api/whatsapp,
// Verify token = WHATSAPP_VERIFY_TOKEN, and subscribe to the "messages" field.
import { after } from "next/server";
import { deliverAndCoach } from "@/lib/whatsapp/after-inbound";
import { handleWebhook } from "@/lib/whatsapp/inbound";
import { fromThisComputer, sameSecret } from "@/lib/auth-core";
import { isValidSignature } from "@/lib/whatsapp/signature";

const MAX_BODY_BYTES = 512 * 1024; // Meta's webhooks are a few kB; anything far bigger is not from Meta

/** Meta checks the URL once: echo the challenge back if the verify token matches. */
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN;
  if (expected && q.get("hub.mode") === "subscribe" && sameSecret(q.get("hub.verify_token") ?? "", expected)) {
    return new Response(q.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new Response("Forbidden", { status: 403 });
}

/** Messages and delivery receipts. Must answer 200 quickly; sending replies happens after the response. */
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return new Response("Too large", { status: 413 });
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.length > MAX_BODY_BYTES) return new Response("Too large", { status: 413 });
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (secret) {
    if (!isValidSignature(raw, request.headers.get("x-hub-signature-256"), secret)) {
      return new Response("Invalid signature", { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production" || !fromThisComputer(request.headers)) {
    // Without the app secret we cannot tell Meta from anyone else: unsigned webhooks are only accepted from this
    // computer during development (the fake-WhatsApp scripts), never through a tunnel or in production.
    return new Response("Set WHATSAPP_APP_SECRET before receiving WhatsApp messages from outside this computer.", { status: 503 });
  }

  let body: Parameters<typeof handleWebhook>[0];
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // One line per webhook: which kind of event, how many messages and receipts (never the message text).
  console.log("[whatsapp] webhook:", (body.entry ?? []).flatMap((e) => (e.changes ?? []).map((c) =>
    `${c.field} (${c.value?.messages?.length ?? 0} messages, ${c.value?.statuses?.length ?? 0} receipts)`)).join("; ") || "empty");

  // If this throws (for example the database is down) we answer 500 and Meta retries later.
  const { patients, toCoach, voiceNotes } = await handleWebhook(body);
  after(() => deliverAndCoach(patients, toCoach, voiceNotes));
  return new Response("OK", { status: 200 });
}
