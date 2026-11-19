// Pretend to be WhatsApp: send a correctly signed webhook to the app, exactly as Meta would.
// Useful to rehearse the demo, or to test, without a phone.
//
//   node scripts/fake-whatsapp.mjs text +14165550142 "hi" ["Their Name"] [--id wamid.X]
//   node scripts/fake-whatsapp.mjs button +14165550142 time_morning "Morning"
//   node scripts/fake-whatsapp.mjs status wamid.MOCK1 read
//
// Reads WHATSAPP_APP_SECRET from .env.local (or the environment). APP_URL defaults to http://localhost:3100.
import { createHmac, randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
const env = { ...process.env };
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const appUrl = (env.APP_URL ?? "http://localhost:3100").replace(/\/$/, "");
const args = process.argv.slice(2);
const idFlag = args.indexOf("--id");
const fixedId = idFlag >= 0 ? args.splice(idFlag, 2)[1] : null;
const [kind, a, b, c] = args;

let value;
if (kind === "text" && a && b) {
  const from = a.replace(/^\+/, "");
  value = {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "15550000000", phone_number_id: env.WHATSAPP_PHONE_NUMBER_ID ?? "000" },
    contacts: [{ profile: { name: c ?? "Test Patient" }, wa_id: from }],
    messages: [{ from, id: fixedId ?? `wamid.FAKE${randomUUID().replace(/-/g, "")}`, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: b } }],
  };
} else if (kind === "button" && a && b) {
  // a tapped quick-reply button: node scripts/fake-whatsapp.mjs button +14165550142 time_morning "Morning"
  const from = a.replace(/^\+/, "");
  value = {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "15550000000", phone_number_id: env.WHATSAPP_PHONE_NUMBER_ID ?? "000" },
    contacts: [{ profile: { name: "Test Patient" }, wa_id: from }],
    messages: [{ from, id: fixedId ?? `wamid.FAKE${randomUUID().replace(/-/g, "")}`, timestamp: String(Math.floor(Date.now() / 1000)),
                 type: "interactive", interactive: { type: "button_reply", button_reply: { id: b, title: c ?? b } } }],
  };
} else if (kind === "status" && a && b) {
  value = {
    messaging_product: "whatsapp",
    metadata: { display_phone_number: "15550000000", phone_number_id: env.WHATSAPP_PHONE_NUMBER_ID ?? "000" },
    statuses: [{ id: a, status: b, timestamp: String(Math.floor(Date.now() / 1000)), recipient_id: "0" }],
  };
} else {
  console.log('usage:\n  node scripts/fake-whatsapp.mjs text +14165550142 "hi" ["Name"] [--id wamid.X]\n  node scripts/fake-whatsapp.mjs status wamid.MOCK1 read');
  process.exit(1);
}

const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "0", changes: [{ field: "messages", value }] }] });
const headers = { "Content-Type": "application/json" };
if (env.WHATSAPP_APP_SECRET && !env.UNSIGNED) {
  headers["X-Hub-Signature-256"] = "sha256=" + createHmac("sha256", env.WHATSAPP_APP_SECRET).update(body).digest("hex");
}
const res = await fetch(`${appUrl}/api/whatsapp`, { method: "POST", headers, body });
console.log(`${res.status} ${await res.text()}`);
process.exit(res.ok ? 0 : 1);
