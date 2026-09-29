// Meta signs every webhook POST: the X-Hub-Signature-256 header is "sha256=" + the hex HMAC-SHA256
// of the raw request body, keyed with the app secret. Verify it on the raw text, before parsing.
import { createHmac, timingSafeEqual } from "node:crypto";

/** True when `header` is the valid signature of `rawBody`. Constant-time; false on any bad input. */
export function verifySignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header || !appSecret || !header.startsWith("sha256=")) return false;
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}
