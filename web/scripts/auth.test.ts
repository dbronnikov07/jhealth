// Who may open the dashboard: the rules in lib/auth-core.ts, tested as an attacker would try them. Run: npm run test:unit
import assert from "node:assert/strict";
import { test } from "node:test";
import { clientAddress, dashboardAccess, fromThisComputer, resetFailures, sameSecret } from "../src/lib/auth-core.ts";
import { cloudConnection, databaseUrl } from "../src/lib/db.ts";

const H = (h: Record<string, string>) => new Headers(h);
const local = { host: "localhost:3100", "x-forwarded-for": "::1" };
const basic = (password: string) => `Basic ${btoa(`doctor:${password}`)}`;

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

test("password set: only the right password opens it, from anywhere", () => {
  resetFailures();
  const env = { password: "correct horse battery staple", production: true };
  const remote = { host: "jhealth.example", "x-forwarded-for": "198.51.100.7" };
  assert.equal(dashboardAccess(H(remote), env).ok, false);                                          // no credentials
  assert.equal(dashboardAccess(H({ ...remote, authorization: basic("wrong") }), env).ok, false);
  assert.equal(dashboardAccess(H({ ...remote, authorization: basic("correct horse battery stapl") }), env).ok, false);
  assert.equal(dashboardAccess(H({ ...remote, authorization: basic("correct horse battery staple!") }), env).ok, false);
  assert.equal(dashboardAccess(H({ ...remote, authorization: "Basic !!!notbase64" }), env).ok, false);
  assert.equal(dashboardAccess(H({ ...remote, authorization: `Basic ${btoa("no-colon")}` }), env).ok, false);
  assert.equal(dashboardAccess(H({ ...remote, authorization: basic(env.password) }), env).ok, true);
  assert.equal(dashboardAccess(H({ ...local, authorization: basic("wrong") }), env).ok, false);    // local is no exception
});

test("ten wrong passwords lock that address out for 15 minutes, even with the right one", () => {
  resetFailures();
  const env = { password: "s3cret-pass", production: true };
  const attacker = { host: "jhealth.example", "cf-connecting-ip": "192.0.2.66" };
  const t0 = 1_000_000;
  for (let i = 0; i < 10; i++) dashboardAccess(H({ ...attacker, authorization: basic(`guess${i}`) }), env, t0 + i);
  const blocked = dashboardAccess(H({ ...attacker, authorization: basic(env.password) }), env, t0 + 20);
  assert.equal(blocked.ok, false);
  assert.equal(!blocked.ok && blocked.status, 429);
  // another address is not affected; the lock ends after 15 minutes
  assert.equal(dashboardAccess(H({ ...attacker, "cf-connecting-ip": "192.0.2.67", authorization: basic(env.password) }), env, t0 + 20).ok, true);
  assert.equal(dashboardAccess(H({ ...attacker, authorization: basic(env.password) }), env, t0 + 16 * 60_000).ok, true);
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
