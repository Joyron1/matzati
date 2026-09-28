// Authorization of Vercel Cron requests (app/api/cron/*): Vercel sends
// `Authorization: Bearer <CRON_SECRET>`. Compared in constant time; with no CRON_SECRET set,
// nothing is authorized.
import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();

export function isCronAuthorized(header: string | null, secret: string | undefined): boolean {
  const key = secret?.trim();
  if (!key || !header) return false;
  // Hashing first gives both sides the same length, so the comparison leaks neither the secret's
  // length nor where a guess goes wrong.
  return timingSafeEqual(digest(header.trim()), digest(`Bearer ${key}`));
}
