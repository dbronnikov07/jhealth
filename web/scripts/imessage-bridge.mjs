#!/usr/bin/env node
// The iMessage bridge: connects Messages on this Mac (signed into jHealth's own Apple ID) to the jHealth server.
//
//   cd ~/jhealth/web && npm run imessage:bridge
//
// - Incoming: `imsg watch --json` streams new messages; each one a patient sent is posted to the server.
// - Outgoing: every 2 seconds the bridge asks the server for queued replies and sends them with `imsg send`.
// The Mac only connects out to the server (HTTPS), so nothing on it is reachable from the internet.
//
// Needs: `brew install steipete/tap/imsg`; Full Disk Access for the terminal (to read new messages) and, on the
// first send, permission to control Messages. Settings come from web/.env.local or the environment:
//   IMESSAGE_BRIDGE_SECRET   shared with the server (required)
//   JHEALTH_URL              default https://jhealth-beta.vercel.app
// Safety: replies only (the server never lets it text someone who has not written in the last 24 hours), at most one
// send every 1.5 s and 300 a day, group chats ignored. Logs never show full addresses or message text.
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
function loadEnv(file) {
  try {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
    }
  } catch { /* no file: rely on the environment */ }
}
loadEnv(path.resolve(here, "..", ".env.local"));

const SERVER = (process.env.JHEALTH_URL ?? "https://jhealth-beta.vercel.app").replace(/\/$/, "");
const SECRET = process.env.IMESSAGE_BRIDGE_SECRET;
if (!SECRET) {
  console.error("IMESSAGE_BRIDGE_SECRET is not set (web/.env.local). Run: bash scripts/set-secret.sh IMESSAGE_BRIDGE_SECRET");
  process.exit(1);
}

const mask = (h) => (h?.includes("@") ? `${h.slice(0, 1)}•••@${h.split("@")[1]}` : `••• ${String(h ?? "").slice(-4)}`);
const time = () => new Date().toLocaleTimeString([], { hour12: false });
const log = (...a) => console.log(time(), ...a);

async function call(body) {
  const res = await fetch(`${SERVER}/api/imessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${data.error ?? ""}`.trim());
  return data;
}

// ---------- incoming ----------
const seen = new Set();
function watch() {
  const child = spawn("imsg", ["watch", "--json", "--debounce", "250ms"], { stdio: ["ignore", "pipe", "pipe"] });
  log(`watching Messages for new texts (server ${SERVER})`);
  readline.createInterface({ input: child.stdout }).on("line", async (line) => {
    let m;
    try { m = JSON.parse(line); } catch { return; }
    if (m.is_from_me || m.type || !m.text?.trim() || !m.sender || !m.guid) return; // ours, an edit/unsend, or empty
    if (Array.isArray(m.participants) && m.participants.length > 1) return;        // group chats are never patients
    if (seen.has(m.guid)) return;
    seen.add(m.guid);
    try {
      await call({ action: "inbound", messages: [{ handle: m.sender, text: m.text, guid: m.guid }] });
      log(`← from ${mask(m.sender)} (${m.text.length} chars)`);
    } catch (e) {
      seen.delete(m.guid);
      log(`! could not pass on a message from ${mask(m.sender)}: ${e.message}`);
    }
  });
  child.stderr.on("data", (d) => {
    const s = String(d);
    if (/full disk access|not permitted|authorization denied|unable to open database/i.test(s)) {
      console.error("imsg cannot read Messages. Give your terminal Full Disk Access (System Settings > Privacy & Security), then restart it.");
    }
  });
  child.on("exit", (code) => {
    log(`imsg watch stopped (${code}); restarting in 3 s`);
    setTimeout(watch, 3000);
  });
}

// ---------- outgoing ----------
let sentToday = 0;
let day = new Date().toDateString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function send(to, text) {
  return new Promise((resolve) => {
    const child = spawn("imsg", ["send", "--to", to, "--text", text, "--service", "imessage"], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill(), 30_000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? { ok: true } : { ok: false, error: err.trim().split("\n").pop() || `exit ${code}` });
    });
  });
}

async function pump() {
  for (;;) {
    try {
      if (new Date().toDateString() !== day) { day = new Date().toDateString(); sentToday = 0; }
      const { messages = [] } = await call({ action: "claim" });
      const results = [];
      for (const m of messages) {
        if (sentToday >= 300) { results.push({ id: m.id, ok: false, error: "daily limit of 300 reached" }); continue; }
        const r = await send(m.to, m.text);
        if (r.ok) sentToday++;
        results.push({ id: m.id, ...r });
        log(r.ok ? `→ to ${mask(m.to)} (${m.text.length} chars)` : `! could not send to ${mask(m.to)}: ${r.error}`);
        await sleep(1500);
      }
      if (results.length) await call({ action: "ack", results });
    } catch (e) {
      log(`! server: ${e.message}`);
      await sleep(5000);
    }
    await sleep(2000);
  }
}

process.on("SIGINT", () => { log("bridge stopped"); process.exit(0); });
watch();
pump();
