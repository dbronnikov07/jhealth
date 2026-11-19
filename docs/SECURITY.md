# Security

What protects patient data in jHealth, how it was tested, and what must be set before anyone outside this laptop can reach the app. Checked on 19 November 2026.

## What is exposed, and to whom

| Address | Who may use it | How it is protected |
|---|---|---|
| `/` (landing), `/privacy` | everyone | public by design; no patient data |
| `/doctor/**` (dashboard) | the physiotherapist | `DASHBOARD_PASSWORD` (HTTP Basic, constant-time compare, 10 wrong tries = 15-minute lockout per address). Without a password: only this computer, only in development; through a tunnel or in production it refuses (503) |
| Dashboard actions (add patient, save plan, notes, alerts, retry) | the physiotherapist | checked again **inside every action and every data read** (`web/src/lib/auth.ts`), as Next.js requires: actions are reachable by direct POST requests, so the gate in front is not enough on its own. Ids from the browser must be valid UUIDs; all text is length-limited |
| `/s/<token>` (patient's page) and `/api/session*` | the patient | a 64-character random token (256 bits) in the WhatsApp link; no referrer is ever sent from these pages; not indexed by search engines |
| `/api/whatsapp` | Meta only | every webhook must carry Meta's HMAC-SHA256 signature (`WHATSAPP_APP_SECRET`, constant-time). Without the secret set, unsigned webhooks are accepted only from this computer in development; never through a tunnel or in production. Bodies over 512 kB are refused |
| `/api/cron/reminders` | the scheduler | `CRON_SECRET` (constant-time); without it, only this computer in development |
| `/test/*` (research test video) | this computer only | refused from outside |

## Other protections

- **Database:** every rule is enforced by Postgres itself (constraints, one transaction per plan). Row level security is on for every table with no policies, so the public Supabase API key can read nothing; only the server's own connection can. All queries are parameterised (no SQL is built from user text). `npm run db:verify` runs 41 checks.
- **No raw HTML:** React escapes all text and no page renders raw HTML. A note containing `<script>` and `<img onerror>` was saved and shown as plain text.
- **Security headers on every page:** a Content-Security-Policy that allows scripts, models, fonts and media only from our own site; no embedding in other sites (clickjacking); no MIME sniffing; camera allowed only on our own pages, microphone and location never; HSTS in production; the framework is not advertised.
- **The AI coach:** the pain rule runs before it; its answers are checked by code; it cannot send links or email addresses (removed from every reply), give medicine advice, change a plan, or clear an alert.
- **Secrets:** only in `web/.env.local`, which git ignores. None appear in the code sent to browsers (all 21 scripts scanned).
- **Video never leaves the patient's device;** only counts, scores and angles are sent.
- **Dependencies:** `npm audit`: 0 known vulnerabilities.

## How it was tested

`bash web/scripts/attack.sh` (with the dev server running) makes 37 attacks from "outside", using the headers a Cloudflare tunnel adds: the dashboard and patient records, encoded and case-changed paths, path traversal to `.env.local` and source files, forged and unsigned webhooks, an oversized body, the reminder trigger with a made-up secret, made-up and SQL-injected patient tokens. All 37 are refused. `npm run test:unit` includes the access rules (lockout, constant-time compare, what counts as "this computer").

A dashboard action was also replayed exactly as the browser sends it: it works from this computer, is refused through the tunnel (503), and posted to the public landing or privacy page from outside, Next.js refuses it ("Failed to find Server Action") and nothing is written.

## Before anyone outside this laptop can reach the app

1. Set `DASHBOARD_PASSWORD` to a long random password (at least 20 characters). Without it, the dashboard simply refuses outside visitors.
2. Set `WHATSAPP_APP_SECRET` (Meta app → App settings → Basic → App secret). Without it, WhatsApp messages from Meta are refused through the tunnel.
3. Set `CRON_SECRET` on Vercel if reminders run there.
4. Rotate the keys that were pasted into a chat during development: the Adaption API key (Adaption → Settings → API keys) and the WhatsApp access token (temporary tokens expire by themselves; make a permanent System User token for the demo).

## Known limits (prototype)

- Scripts are allowed inline (`'unsafe-inline'`), which Next.js needs without per-request nonces; external scripts are still blocked.
- The wrong-password lockout is kept in memory per server process; a serverless deployment would need a shared store.
- Anyone who has a patient's WhatsApp link can open that patient's exercise page (as with any magic link); it shows the plan, never other patients.
- Clinical wording (safety replies, AI rules) is a draft until a physiotherapist reviews it.
