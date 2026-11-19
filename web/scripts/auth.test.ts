// Who may open the dashboard: the rules in lib/auth-core.ts, tested as an attacker would try them. Run: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPassword, clientAddress, createSession, dashboardAccess, fromThisComputer, resetFailures, safeNext, sameSecret, sessionCookieName, validSession } from "../src/lib/auth-core.ts";
import { cloudConnection, databaseUrl } from "../src/lib/db.ts";

const H = (h: Record<string, string>) => new Headers(h);
const local = { host: "localhost:3100", "x-forwarded-for": "::1" };

test("'this computer' means no tunnel, no proxy, a local host name", () => {
  assert.equal(fromThisComputer(H(local)), true);
  assert.equal(fromThisComputer(H({ host: "abc.trycloudflare.com", "x-forwarded-for": "::1" })), false);
  assert.equal(fromThisComputer(H({ ...local, "cf-connecting-ip": "203.0.113.9" })), false);    // through Cloudflare
  assert.equal(fromThisComputer(H({ host: "localhost:3100", "x-forwarded-for": "203.0.113.9" })), false);
  assert.equal(fromThisComputer(H({ ...local, forwarded: "for=203.0.113.9" })), false);
  assert.equal(fromThisComputer(H({ ...local, "x-real-ip": "203.0.113.9" })), false);
});

test("no password set: only this computer, only in development", () => {
  assert.equal(dashboardAccess(H(local), { production: false }).ok, true);
  assert.deepEqual(dashboardAccess(H({ ...local, "cf-connecting-ip": "203.0.113.9" }), { production: false }).ok, false);
  assert.equal(dashboardAccess(H(local), { production: true }).ok, false);                       // never in production
});

test("password set: only a valid signed session opens the dashboard, from anywhere", () => {
  const env = { password: "correct horse battery staple", production: true };
  const remote = { host: "jhealth.example", "x-forwarded-for": "198.51.100.7" };
  const cookie = (v: string) => ({ ...remote, cookie: `theme=dark; ${sessionCookieName(true)}=${v}` });
  const t0 = 1_800_000_000_000;
  const good = createSession(env.password, t0).value;
  assert.equal(dashboardAccess(H(remote), env, t0).ok, false);                                       // no cookie
  assert.equal(dashboardAccess(H(cookie(good)), env, t0 + 60_000).ok, true);                         // signed in
  assert.equal(dashboardAccess(H({ ...remote, cookie: `jh_session=${good}` }), env, t0).ok, false);   // wrong cookie name in production
  assert.equal(dashboardAccess(H(cookie(good)), env, t0 + 12 * 3600_000 + 1).ok, false);             // expired after 12 hours
  assert.equal(dashboardAccess(H(cookie(good)), { ...env, password: "a new password" }, t0).ok, false); // password changed: everyone out
  const [, expires, sig] = good.split(".");
  assert.equal(dashboardAccess(H(cookie(`v1.${Number(expires) + 3600_000}.${sig}`)), env, t0).ok, false); // extended by hand
  assert.equal(dashboardAccess(H(cookie(`v1.${expires}.${"A".repeat(43)}`)), env, t0).ok, false);       // forged signature
  assert.equal(dashboardAccess(H(cookie(`v1.${t0 + 99 * 3600_000}.${sig}`)), env, t0).ok, false);       // far future
  assert.equal(dashboardAccess(H(cookie("' or 1=1 --")), env, t0).ok, false);
  assert.equal(dashboardAccess(H({ ...remote, authorization: `Basic ${btoa(`doctor:${env.password}`)}` }), env, t0).ok, false); // the old popup is gone
  assert.equal(dashboardAccess(H({ ...local }), env, t0).ok, false);                                  // this computer is no exception
  assert.equal(validSession(good, env.password, t0), true);
});

test("signing in: only the exact password; ten wrong ones lock that address out for 15 minutes", () => {
  resetFailures();
  const env = { password: "s3cret-pass", production: true };
  const attacker = { host: "jhealth.example", "cf-connecting-ip": "192.0.2.66" };
  const t0 = 1_000_000;
  for (const guess of ["", "s3cret-pas", "s3cret-pass ", "S3CRET-PASS", "x".repeat(500)]) {
    assert.equal(checkPassword(H({ host: "jhealth.example", "cf-connecting-ip": "192.0.2.1" }), guess, env, t0).ok, false);
  }
  assert.equal(checkPassword(H(attacker), env.password, env, t0).ok, true);
  for (let i = 0; i < 10; i++) checkPassword(H(attacker), `guess${i}`, env, t0 + i);
  const blocked = checkPassword(H(attacker), env.password, env, t0 + 20);
  assert.equal(blocked.ok, false);
  assert.equal(!blocked.ok && blocked.status, 429);
  assert.equal(checkPassword(H({ ...attacker, "cf-connecting-ip": "192.0.2.67" }), env.password, env, t0 + 20).ok, true); // others unaffected
  assert.equal(checkPassword(H(attacker), env.password, env, t0 + 16 * 60_000).ok, true);                               // lock ends
  assert.equal(checkPassword(H(attacker), env.password, { production: true }, t0).ok, false);                         // no password set
});

test("after signing in, only our own dashboard pages are allowed as the next page", () => {
  assert.equal(safeNext("/doctor/patients/ad4f8668-0876-48c6-a11f-e4bbe7d09440?edit=1"), "/doctor/patients/ad4f8668-0876-48c6-a11f-e4bbe7d09440?edit=1");
  assert.equal(safeNext("/doctor"), "/doctor");
  for (const bad of ["//evil.example", "https://evil.example/doctor", "/doctor/../../evil", "/doctor/%2E%2E/%2e%2e/evil", "/doctorx", "/\\evil.example", "javascript:alert(1)", "/doctor\nSet-Cookie: x", undefined, 42]) {
    assert.equal(safeNext(bad), "/doctor", String(bad));
  }
});

test("on Vercel a made-up cf-connecting-ip cannot dodge the lockout", () => {
  const spoofed = H({ "x-real-ip": "192.0.2.66", "x-forwarded-for": "192.0.2.66", "cf-connecting-ip": "10.9.9.9" });
  assert.equal(clientAddress(spoofed, true), "192.0.2.66");     // Vercel's own header wins
  assert.equal(clientAddress(H({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "::1" }), false), "203.0.113.9"); // tunnel
  assert.equal(clientAddress(H({}), true), "unknown");
});

test("the cloud database URL keeps only the address and always uses TLS", () => {
  const c = cloudConnection("postgres://u:p@aws-0-ca-central-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x&pgbouncer=true");
  assert.equal(c.url, "postgres://u:p@aws-0-ca-central-1.pooler.supabase.com:6543/postgres");
  assert.equal(c.ssl, "require");
  assert.equal(cloudConnection("postgres://u:p@localhost:5432/db").ssl, false);
  assert.equal(databaseUrl({ POSTGRES_URL: "postgres://x" }), "postgres://x");
  assert.equal(databaseUrl({ DATABASE_URL: "", POSTGRES_URL: "" }), undefined);
});

test("secrets are compared in constant time and exactly", () => {
  assert.equal(sameSecret("abc", "abc"), true);
  assert.equal(sameSecret("abc", "abd"), false);
  assert.equal(sameSecret("abc", "abcd"), false);
  assert.equal(sameSecret("", "x"), false);
});
