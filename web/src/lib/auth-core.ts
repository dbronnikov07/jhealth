// Who may open the physiotherapist's dashboard. One function, used by the proxy (the gate in front of /doctor)
// AND inside every dashboard action and data read (lib/auth.ts), because Next.js server actions are reachable by
// direct POST requests and must never rely on the gate alone.
//
// Rules:
//   - DASHBOARD_PASSWORD set: HTTP Basic sign-in with that password (any user name), compared in constant time.
//   - not set: only requests made on this computer, in development. Through a tunnel or in production: refused.
//   - 10 wrong passwords from one address within 15 minutes: that address is locked out for 15 minutes.
import { createHash, timingSafeEqual } from "node:crypto";

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

export function dashboardAccess(
  h: Headers,
  env: { password?: string; production: boolean } = { password: process.env.DASHBOARD_PASSWORD, production: process.env.NODE_ENV === "production" },
  now = Date.now(),
): Access {
  if (!env.password) {
    if (!env.production && fromThisComputer(h)) return { ok: true };
    return { ok: false, status: 503, message: "Set DASHBOARD_PASSWORD to open the dashboard from another device." };
  }
  const ip = clientAddress(h);
  if (lockedOut(ip, now)) return { ok: false, status: 429, message: "Too many wrong passwords. Try again in 15 minutes." };
  const [scheme, encoded] = (h.get("authorization") ?? "").split(" ");
  if (scheme === "Basic" && encoded) {
    let decoded = "";
    try {
      decoded = atob(encoded);
    } catch {
      decoded = "";
    }
    const given = decoded.slice(decoded.indexOf(":") + 1);
    if (decoded.includes(":") && sameSecret(given, env.password)) return { ok: true };
    recordFailure(ip, now);
  }
  return { ok: false, status: 401, message: "Sign-in required" };
}

/** For tests only. */
export function resetFailures() {
  failures.clear();
}
