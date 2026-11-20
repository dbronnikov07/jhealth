# Security

What protects patient data in Motiva Health, how it was tested, and what must be set before anyone outside this laptop can reach the app. Checked on 19 November 2026.

## What is exposed, and to whom

| Address | Who may use it | How it is protected |
|---|---|---|
| `/` (landing), `/privacy` | everyone | public by design; no patient data |
| `/doctor/**` (dashboard) | the physiotherapist | sign in on `/login` with `DASHBOARD_PASSWORD` (constant-time compare; 10 wrong tries = 15-minute lockout per address). The browser then holds a signed session cookie for 12 hours: `HttpOnly` (page scripts cannot read it), `Secure`, `SameSite=Lax`, `__Host-` prefix (this exact site only), signed with HMAC-SHA256 under a key derived from the password, so it cannot be forged or extended, and changing the password signs everyone out. After sign-in the page only returns to `/doctor` pages (no open redirect). Without a password: only this computer, only in development; through a tunnel or in production it refuses (503) |
| Dashboard actions (add patient, save plan, notes, alerts, retry) | the physiotherapist | checked again **inside every action and every data read** (`web/src/lib/auth.ts`), as Next.js requires: actions are reachable by direct POST requests, so the gate in front is not enough on its own. Ids from the browser must be valid UUIDs; all text is length-limited |
| `/s/<token>` (patient's page) and `/api/session*` | the patient | a 64-character random token (256 bits) in the WhatsApp link; no referrer is ever sent from these pages; not indexed by search engines |
| `/api/whatsapp` | Meta only | every webhook must carry Meta's HMAC-SHA256 signature (`WHATSAPP_APP_SECRET`, constant-time). Without the secret set, unsigned webhooks are accepted only from this computer in development; never through a tunnel or in production. Bodies over 512 kB are refused |
| `/api/cron/reminders` | the scheduler | `CRON_SECRET` (constant-time); without it, only this computer in development |
| `/test/*` (research test video) | this computer only | refused from outside |

## Other protections

- **Database:** every rule is enforced by Postgres itself (constraints, one transaction per plan). Row level security is on for every table with no policies, so the public Supabase API key can read nothing; only the server's own connection can. All queries are parameterised (no SQL is built from user text). `npm run db:verify` runs 41 checks.
- **No raw HTML:** React escapes all text and no page renders raw HTML. A note containing `<script>` and `<img onerror>` was saved and shown as plain text.
- **Security headers on every page:** a Content-Security-Policy that allows scripts, models, fonts and media only from our own site; no embedding in other sites (clickjacking); no MIME sniffing; camera and microphone allowed only on our own pages (the microphone hears voice commands such as "help" and "call 911" during a camera session; the browser's speech service, Apple's or Google's, turns them into text, and only five commands do anything), location never; HSTS in production; the framework is not advertised.
- **The AI coach:** the pain rule runs before it; its answers are checked by code; it cannot send links or email addresses (removed from every reply), give medicine advice, change a plan, or clear an alert.
- **Secrets:** only in `web/.env.local`, which git ignores. None appear in the code sent to browsers (all 21 scripts scanned).
- **Video never leaves the patient's device;** only counts, scores and angles are sent.
- **Dependencies:** `npm audit`: 0 known vulnerabilities.

## How it was tested

`bash web/scripts/attack.sh` (with the dev server running) makes 43 attacks from "outside", using the headers a Cloudflare tunnel adds: the dashboard and patient records, encoded and case-changed paths, path traversal to `.env.local` and source files, forged and unsigned webhooks, an oversized body, the reminder trigger with a made-up secret, made-up and SQL-injected patient tokens, and the demo phone (made-up keys, invented buttons, oversized bodies). All 43 are refused. Against the live site run it with `BASE=https://motiva-health.vercel.app DELAY=2`: Vercel's own firewall blocks this computer for a few minutes after the path-traversal probes, which is why they run last. `npm run test:unit` includes the access rules (lockout, constant-time compare, what counts as "this computer").

A dashboard action was also replayed exactly as the browser sends it: it works from this computer, is refused through the tunnel (503), and posted to the public landing or privacy page from outside, Next.js refuses it ("Failed to find Server Action") and nothing is written.

## The live deployment (Vercel + Supabase, 19 November 2026)

https://motiva-health.vercel.app. Website on Vercel (functions in Montreal, `yul1`), database on Supabase's free plan in Canada (`ca-central-1`), created through Vercel's marketplace.

- **Supabase's public web API is closed.** Supabase publishes every table, view and function through an automatic web API that anyone with the project's public key can call. Migration `20261120090000_lock_public_api.sql` removes every right the public roles had (and for anything created later). Then the API was attacked with both public keys and with none: reading all 12 tables and views, inserting a patient, running all 5 functions, 37 attempts in all. Every one was refused (401 or 404), and GraphQL is not enabled. `npm run cloud:check` re-checks this from the database side.
- **Secrets** are stored on Vercel as *sensitive* (write-only: Vercel never displays them again) and in private files outside the project (`~/jhealth-cache/production-secrets.txt`, `~/jhealth-cache/production.env`, owner-only permissions). `DASHBOARD_PASSWORD` is 28 random characters; `CRON_SECRET` is 64 random hex characters. No value was printed or typed into a web page.
- **The upload is an allow-list** (`web/.vercelignore`): source, public files, package and config files only. Never `.env*`, never the research test video.
- **The lockout reads Vercel's own address header.** On Vercel, a `cf-connecting-ip` header is whatever the attacker typed; trusting it would have let a password guesser look like a new address on every try and never be locked out. Fixed and unit-tested.
- **The app refuses to start without its database** on Vercel, instead of falling back to an empty throwaway one.
- **The database connection is encrypted** (TLS, checked from inside Postgres).
- **Vercel's own firewall** noticed the burst of attacks from `scripts/attack.sh` and put this laptop's address behind a security checkpoint within seconds. Preview (non-production) addresses require a Vercel sign-in.

## The demo phone (added 19 November)

A chat page on our own site that stands in for WhatsApp (`/s/<token>/phone`, API `/api/demo-phone`).

- Same key as the exercise page (64 random hex characters). Works only for patients the physiotherapist put on the demo channel; a WhatsApp patient's key gets 404 on both the page and the API (tested), so it cannot be used to write as them.
- Every field is checked (`parseDemoRequest`, unit-tested): key format, text of 1 to 1,000 characters with control characters removed, buttons only from the coach's own list (titles come from our list, never from the request or the database). Bodies over 8 kB are refused (413).
- 20 messages per patient per 10 minutes, 200 a day (429 after that, tested), counted in the database so it holds across Vercel's copies of the app. This also caps what the AI coach can spend.
- The Start button's link is built from the key on the page, never taken from a message. React escapes all text.
- The QR code on the dashboard is hidden until asked for, so it is not shown on a projector.

## The iMessage bridge (added 19 November)

- **One door, one key.** The Mac bridge talks to `/api/imessage` only, with `Authorization: Bearer <IMESSAGE_BRIDGE_SECRET>` (64 random hex characters, constant-time compare, stored as sensitive on Vercel). Without the secret on the server the door is shut (503). Attacked: fake texts, pulling replies, a made-up secret, the wrong scheme, GET: all refused.
- **The Mac is not exposed.** It only makes outgoing HTTPS calls; there is no tunnel and no open port.
- **Its own Apple ID.** The bot uses a separate Apple ID, so nobody's personal messages pass through the bridge. Group chats are ignored.
- **No cold messages.** The server only hands the bridge a message for someone who wrote in the last 24 hours; at most one send every 1.5 s and 300 a day. This keeps the Apple ID from being flagged as spam.
- **Logs** show masked addresses (••• 0142) and message lengths, never the text.
- **Input checks:** addresses normalised and validated, text stripped of control characters and capped, message ids validated, bodies over 64 kB refused. A reply like "2" only counts as an answer when the coach's last message offered numbered answers.

## Two bugs found while testing (fixed)

- **JSON stored as text on Supabase.** The cloud database driver encoded the app's JSON a second time, so on Supabase every message's details (reminder-time buttons, the "AI coach" label, Start-button flags) were stored as a plain string and lost. The local database never showed it. Fixed in `src/lib/db.ts`; `npm run cloud:check` now checks it against the real database with the app's own settings.
- **The attack test sent half-messages.** macOS's built-in bash 3.2 split JSON bodies at their commas inside nested quotes, so several attacks sent a fragment (refused for the wrong reason). Bodies are now built once in plain assignments, and checked to be valid JSON. All 43 attacks pass with complete messages.
- **A safety gap in quick replies (WhatsApp too).** After a pain report, tapping "No time" still offered a Start button. Now no tap can offer Start while a pain or red-flag alert is open.

## Still to do before real patients

1. Rotate the Adaption API key, which was pasted into a chat during development (Adaption → Settings → API keys), then save the new one with `bash scripts/set-secret.sh ADAPTION_API_KEY` from `web/` and redeploy.
2. WhatsApp is not connected. The Meta account used during the build was disabled on 19 November, and all WhatsApp keys were removed from Vercel and the laptop the same day, so the site holds no Meta credentials. Without them the webhook refuses everything (verification 403, messages 503), and the demo phone carries the demo. To connect WhatsApp later, an adult owner sets it up under their own Meta business account (WhatsApp Business requires 18+), then saves `WHATSAPP_TOKEN` (a permanent System User token), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN` and `WHATSAPP_APP_SECRET` with `scripts/set-secret.sh`.

## Known limits (prototype)

- Scripts are allowed inline (`'unsafe-inline'`), which Next.js needs without per-request nonces; external scripts are still blocked.
- Sign-out clears the cookie in that browser; a copied cookie stays valid until it expires (12 hours) or the password changes. Per-session revocation would need a sessions table.
- The wrong-password lockout is kept in memory per server process. On Vercel several copies of the app can run at once, so an attacker gets roughly 10 guesses per copy per 15 minutes; against a 28-character random password that changes nothing in practice, but a shared store (for example a database table) would make it exact.
- The database connection is encrypted but does not pin Supabase's certificate authority (`ssl: "require"`); adding Supabase's CA file would also rule out an impersonated database server.
- Vercel's Supabase integration also stores Supabase's service-role key in the project's settings. The app never uses it, but anyone who can read the Vercel project's secrets could; keep the Vercel account protected with two-factor sign-in.
- Anyone who has a patient's WhatsApp link can open that patient's exercise page (as with any magic link); it shows the plan, never other patients.
- Clinical wording (safety replies, AI rules) is a draft until a physiotherapist reviews it.

## Emergency path (added 20 November 2026)

- A possible fall (the camera sees someone who was upright end up lying down, or drop fast and vanish) or a spoken "help" / "call 911" opens an "Are you okay?" screen with buttons to call 911 and the patient's emergency contact. **Nothing calls anyone by itself:** the buttons are ordinary `tel:` links, so the phone asks before dialling.
- `POST /api/session/alert` takes only a 64-character session token, a kind (`fall` or `help`) and the exercise name (letters and digits only, 60 characters), refuses bodies over 4 KB, and raises at most one red-flag alert per patient every two minutes. `scripts/attack.sh` checks a made-up token, SQL in the token and an unknown kind.
- The emergency contact (name and number) is stored on the patient row, entered by the physiotherapist, and shown only on the patient's own session page, reached through their private link.

## Spoken coach (added 20 November 2026)

- `POST /api/session/talk` takes a 64-character session token, one of four events, at most 300 characters of heard text and a few numbers (each clamped), refuses bodies over 8 KB, and answers at most 40 turns per patient every 10 minutes (counted in `voice_turns`). `scripts/attack.sh` checks a made-up token and an unknown event.
- Pain and red-flag words in what the patient says go to the fixed safety rules (`lib/safety.ts`) before any AI: alert, remembered fact, fixed answer, session stopped.
- What leaves the device: the browser's speech service (Apple's or Google's) turns speech into text; that text and the session numbers go to the AI that writes the answer (OpenAI when `OPENAI_API_KEY` is set, otherwise Adaption); the answer's text goes to OpenAI's text-to-speech. The video never leaves the device. Conversations are stored in `voice_turns` (row level security on, no web API rights) so the physiotherapist can read them.
- The coach's voice is made on our own server (`web/api/tts.py`, Kokoro-82M, open model): no paid service and nothing sent to a third party for speech. It speaks only text signed by `/api/session/talk` (HMAC-SHA256 with `TTS_SECRET`, valid one minute, at most 400 characters), so it cannot be used to make the site say anything else. `scripts/attack.sh` checks that unsigned text is refused. The model file is downloaded from its GitHub release and checked against its SHA-256 before use.

## iMessage on a personal Apple ID (added 20 November 2026)

- A new sender only becomes a patient when their first text mentions "Motiva" (the invite link and QR code type it). Anyone else is ignored and nothing they wrote is stored (`JOIN_WORD` in `web/src/lib/imessage/format.ts`).
- `npm run imessage:bridge -- --personal` keeps private messages on the Mac: a text leaves only if it says "Motiva" or comes from someone who already did (kept in `~/jhealth-cache/imessage-patients.json`, readable only by the user); replies go only to those people, at most 60 a day.
- The iMessage address is printed on the public front page only with `IMESSAGE_PUBLIC=1`; otherwise the QR code is shown to signed-in staff on the dashboard, so a personal phone number or email is never public.

