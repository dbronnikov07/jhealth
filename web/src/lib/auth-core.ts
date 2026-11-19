// Who may open the physiotherapist's dashboard. One function, used by the proxy (the gate in front of /doctor)
// AND inside every dashboard action and data read (lib/auth.ts), because Next.js server actions are reachable by
// direct POST requests and must never rely on the gate alone.
//
// Rules:
//   - DASHBOARD_PASSWORD set: sign in once on /login with that password (constant-time compare); the browser then
//     carries a signed, HttpOnly session cookie for 12 hours.
//   - not set: only requests made on this computer, in development. Through a tunnel or in production: refused.
//   - 10 wrong passwords from one address within 15 minutes: that address is locked out for 15 minutes.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type Access = { ok: true } | { ok: false; status: 401 | 403 | 429 | 503; message: string };

/** True when the request came from this computer itself, not through a tunnel or proxy. */
export function fromThisComputer(h: Headers): boolean {
  const host = (h.get("host") ?? "").replace(/:\d+$/, "");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(host)) return false;
  if (h.has("cf-connecting-ip") || h.has("cf-ray") || h.has("forwarded") || h.has("x-real-ip")) return false;
  // Next.js itself adds x-forwarded-for with the caller's address; anything but this computer means a proxy.
  const chain = (h.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return chain.every((ip) => ip === "::1" || ip === "127.0.0.1" || ip === "::ffff:127.0.0.1");
}

/**
 * The caller's address, read only from the header our own front door writes. Anyone can send any header, so a
 * header the platform does not overwrite would let an attacker pick a new "address" for every password guess and
 * never be locked out. On Vercel, Vercel overwrites x-real-ip / x-forwarded-for (a cf-connecting-ip sent there is
 * the attacker's own text); through a Cloudflare tunnel, Cloudflare overwrites cf-connecting-ip.
 */
export function clientAddress(h: Headers, onVercel = Boolean(process.env.VERCEL)): string {
  const first = (v: string | null) => (v ?? "").split(",")[0].trim();
  if (onVercel) return first(h.get("x-real-ip")) || first(h.get("x-forwarded-for")) || "unknown";
  return first(h.get("cf-connecting-ip")) || first(h.get("x-forwarded-for")) || "unknown";
}

/** Constant-time comparison: how long it takes does not reveal how much of a guess was right. */
export function sameSecret(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

const failures = new Map<string, { count: number; since: number }>();
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES = 10;

function lockedOut(ip: string, now: number): boolean {
  const f = failures.get(ip);
  if (!f) return false;
  if (now - f.since > WINDOW_MS) {
    failures.delete(ip);
    return false;
  }
  return f.count >= MAX_FAILURES;
}

function recordFailure(ip: string, now: number) {
  const f = failures.get(ip);
  if (!f || now - f.since > WINDOW_MS) failures.set(ip, { count: 1, since: now });
  else f.count++;
  if (failures.size > 10_000) failures.clear(); // never let the table grow without bound
}

type Env = { password?: string; production: boolean };
const currentEnv = (): Env => ({ password: process.env.DASHBOARD_PASSWORD, production: process.env.NODE_ENV === "production" });

// ---- sign-in sessions -------------------------------------------------------------------------------------------
// After the right password, the browser gets a cookie "v1.<expires>.<signature>". The signature is an HMAC of the
// expiry time with a key derived from DASHBOARD_PASSWORD, so nobody can forge or extend one, and changing the
// password signs everybody out. The cookie is HttpOnly (page scripts cannot read it), Secure and SameSite=Lax.
export const SESSION_HOURS = 12;

/** The cookie's name. "__Host-" makes the browser refuse it unless it is Secure, for this exact host, path "/". */
export function sessionCookieName(production: boolean): string {
  return production ? "__Host-jh_session" : "jh_session";
}

function sessionSignature(expires: number, password: string): string {
  const key = createHash("sha256").update(`jhealth-dashboard-session:${password}`).digest();
  return createHmac("sha256", key).update(`v1.${expires}`).digest("base64url");
}

export function createSession(password: string, now = Date.now()): { value: string; maxAge: number } {
  const expires = now + SESSION_HOURS * 3600_000;
  return { value: `v1.${expires}.${sessionSignature(expires, password)}`, maxAge: SESSION_HOURS * 3600 };
}

export function validSession(value: string | undefined | null, password: string, now = Date.now()): boolean {
  const m = /^v1\.(\d{13})\.([A-Za-z0-9_-]{43})$/.exec(value ?? "");
  if (!m) return false;
  const expires = Number(m[1]);
  if (!(expires > now) || expires > now + SESSION_HOURS * 3600_000 + 60_000) return false;
  return sameSecret(m[2], sessionSignature(expires, password));
}

function cookieValue(h: Headers, name: string): string | undefined {
  for (const part of (h.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** May this request use the dashboard? Used by the proxy (the gate) and inside every action and data read. */
export function dashboardAccess(h: Headers, env: Env = currentEnv(), now = Date.now()): Access {
  if (!env.password) {
    if (!env.production && fromThisComputer(h)) return { ok: true };
    return { ok: false, status: 503, message: "Set DASHBOARD_PASSWORD to open the dashboard from another device." };
  }
  if (validSession(cookieValue(h, sessionCookieName(env.production)), env.password, now)) return { ok: true };
  return { ok: false, status: 401, message: "Sign in to open the dashboard." };
}

/** One sign-in attempt. Wrong passwords count towards the lockout for that address; the right one resets nothing. */
export function checkPassword(h: Headers, given: string, env: Env = currentEnv(), now = Date.now()): Access {
  if (!env.password) return { ok: false, status: 503, message: "Sign-in is not set up on this server (no DASHBOARD_PASSWORD)." };
  const ip = clientAddress(h);
  if (lockedOut(ip, now)) return { ok: false, status: 429, message: "Too many wrong passwords. Try again in 15 minutes." };
  if (given.length > 0 && given.length <= 200 && sameSecret(given, env.password)) return { ok: true };
  recordFailure(ip, now);
  return { ok: false, status: 401, message: "That password is not right." };
}

/** Where to go after signing in: only our own dashboard pages, so the sign-in page cannot be used to bounce a
 *  physio to another site (an "open redirect", e.g. ?next=//evil.example). */
export function safeNext(raw: unknown): string {
  const next = typeof raw === "string" ? raw : "";
  const ours = /^\/doctor(?:[/?][A-Za-z0-9\-._~/?=&%]*)?$/.test(next) && !/\.\.|%2e/i.test(next); // no "..", even encoded
  return ours ? next : "/doctor";
}

/** For tests only. */
export function resetFailures() {
  failures.clear();
}
