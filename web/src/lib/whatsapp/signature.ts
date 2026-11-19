// Meta signs every webhook: X-Hub-Signature-256: sha256=<HMAC-SHA256 of the raw request body, keyed with the app secret>.
// Checking it proves a request really came from Meta, not from someone who found the webhook URL.
import { createHmac, timingSafeEqual } from "node:crypto";

export function signatureFor(rawBody: string | Uint8Array, appSecret: string): string {
  return "sha256=" + createHmac("sha256", appSecret).update(rawBody).digest("hex");
}

export function isValidSignature(rawBody: string | Uint8Array, header: string | null, appSecret: string): boolean {
  if (!header) return false;
  const expected = Buffer.from(signatureFor(rawBody, appSecret));
  const received = Buffer.from(header);
  return expected.length === received.length && timingSafeEqual(expected, received); // constant time
}
