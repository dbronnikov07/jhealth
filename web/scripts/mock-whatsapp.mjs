// A fake WhatsApp Cloud API for local testing. It accepts what the app sends, records every request to a
// log file (one JSON object per line) and answers like Meta does.
//
//   node scripts/mock-whatsapp.mjs [port]           (default port 3199)
//   then set WHATSAPP_API_BASE=http://localhost:3199 for the app
//
// MOCK_LOG=<file>               where to record requests (default: mock-whatsapp.jsonl in this folder)
// FAIL_ONCE_131047=1416...,...  numbers whose FIRST message is refused with error 131047 (24-hour window)
import { appendFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.argv[2] ?? 3199);
const log = process.env.MOCK_LOG ?? path.join(path.dirname(fileURLToPath(import.meta.url)), "mock-whatsapp.jsonl");
const failOnce = new Set((process.env.FAIL_ONCE_131047 ?? "").split(",").filter(Boolean));
let count = 0;
const run = Date.now().toString(36); // real WhatsApp ids never repeat, even across restarts

http
  .createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      let body = {};
      try { body = JSON.parse(raw); } catch {}
      const to = body.to ?? body.recipient;
      const entry = { at: new Date().toISOString(), method: req.method, path: req.url, auth: req.headers.authorization, body };
      const reply = (status, json) => {
        appendFileSync(log, JSON.stringify({ ...entry, status, response: json }) + "\n");
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(json));
      };
      if (!/^\/v\d+\.\d+\/[^/]+\/messages$/.test(req.url ?? "") || req.method !== "POST") {
        return reply(404, { error: { message: "Unknown path", code: 100 } });
      }
      if (!String(req.headers.authorization ?? "").startsWith("Bearer ")) {
        return reply(401, { error: { message: "Invalid OAuth access token.", code: 190 } });
      }
      if (failOnce.has(to)) {
        failOnce.delete(to);
        return reply(400, {
          error: {
            message: "(#131047) Re-engagement message",
            type: "OAuthException",
            code: 131047,
            error_data: { messaging_product: "whatsapp", details: "Message failed to send because more than 24 hours have passed since the customer last replied to this number." },
          },
        });
      }
      reply(200, { messaging_product: "whatsapp", contacts: [{ input: to, wa_id: to }], messages: [{ id: `wamid.MOCK${run}${++count}` }] });
    });
  })
  .listen(port, () => console.log(`fake WhatsApp API on http://localhost:${port}, recording to ${log}`));
