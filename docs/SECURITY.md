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

## The live deployment (Vercel + Supabase, 19 November 2026)

https://jhealth-beta.vercel.app. Website on Vercel (functions in Montreal, `yul1`), database on Supabase's free plan in Canada (`ca-central-1`), created through Vercel's marketplace.

- **Supabase's public web API is closed.** Supabase publishes every table, view and function through an automatic web API that anyone with the project's public key can call. Migration `20261120090000_lock_public_api.sql` removes every right the public roles had (and for anything created later). Then the API was attacked with both public keys and with none: reading all 12 tables and views, inserting a patient, running all 5 functions, 37 attempts in all. Every one was refused (401 or 404), and GraphQL is not enabled. `npm run cloud:check` re-checks this from the database side.
- **Secrets** are stored on Vercel as *sensitive* (write-only: Vercel never displays them again) and in private files outside the project (`~/jhealth-cache/production-secrets.txt`, `~/jhealth-cache/production.env`, owner-only permissions). `DASHBOARD_PASSWORD` is 28 random characters; `CRON_SECRET` is 64 random hex characters. No value was printed or typed into a web page.
- **The upload is an allow-list** (`web/.vercelignore`): source, public files, package and config files only. Never `.env*`, never the research test video.
- **The lockout reads Vercel's own address header.** On Vercel, a `cf-connecting-ip` header is whatever the attacker typed; trusting it would have let a password guesser look like a new address on every try and never be locked out. Fixed and unit-tested.
- **The app refuses to start without its database** on Vercel, instead of falling back to an empty throwaway one.
- **The database connection is encrypted** (TLS, checked from inside Postgres).
- **Vercel's own firewall** noticed the burst of attacks from `scripts/attack.sh` and put this laptop's address behind a security checkpoint within seconds. Preview (non-production) addresses require a Vercel sign-in.

## Still to do before real patients

1. Set `WHATSAPP_APP_SECRET` (Meta app → App settings → Basic → App secret) on Vercel. Without it, the live site refuses every WhatsApp webhook (503), so nobody can fake one, but real messages are refused too.
2. Rotate the keys that were pasted into a chat during development: the Adaption API key (Adaption → Settings → API keys) and the WhatsApp access token (temporary tokens expire by themselves; make a permanent System User token for the demo).

## Known limits (prototype)

- Scripts are allowed inline (`'unsafe-inline'`), which Next.js needs without per-request nonces; external scripts are still blocked.
- The wrong-password lockout is kept in memory per server process. On Vercel several copies of the app can run at once, so an attacker gets roughly 10 guesses per copy per 15 minutes; against a 28-character random password that changes nothing in practice, but a shared store (for example a database table) would make it exact.
- The database connection is encrypted but does not pin Supabase's certificate authority (`ssl: "require"`); adding Supabase's CA file would also rule out an impersonated database server.
- Vercel's Supabase integration also stores Supabase's service-role key in the project's settings. The app never uses it, but anyone who can read the Vercel project's secrets could; keep the Vercel account protected with two-factor sign-in.
- Anyone who has a patient's WhatsApp link can open that patient's exercise page (as with any magic link); it shows the plan, never other patients.
- Clinical wording (safety replies, AI rules) is a draft until a physiotherapist reviews it.
