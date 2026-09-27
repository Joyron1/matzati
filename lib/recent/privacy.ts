// Which searches may appear on the public recent-searches page (/searches). Queries are typed by
// anyone, so a query that could carry personal details (a phone or ID number, an email, a link, a
// handle) is never listed. Pure; applied when the search is logged (search_log.listable) and again when the
// page reads it (lib/recent/db.ts). The migration 20260927210000_recent_searches.sql backfilled
// old rows with a stricter SQL copy of these rules; keep the two in step.

const MIN_CHARS = 2;
const MAX_CHARS = 120;

// 7+ digits in any script, with up to 3 characters that are neither letters nor digits between
// them (spaces, any dash or maqaf, dots, commas, slashes, brackets, "*", a soft hyphen): phone, ID
// and card numbers, however they are written. A letter ends the run, so "2560x1440" and
// "RTX 4060 8GB" are specs, not numbers.
const LONG_NUMBER = /\p{Nd}(?:[^\p{L}\p{Nd}]{0,3}\p{Nd}){6,}/u;
// Emails and handles in any script ("@דני" too). No product query needs an @.
const AT_SIGN = /@/;
// Links and anything shaped like a domain ("shop.co.il", "example.de", "x.tk/abc"): a name, a dot
// and 2+ Latin letters, whatever the ending. No word boundary before the name, so "x_shop.com" is
// caught too. Specs keep a digit after the dot ("3.5mm", "5.3").
const LINK = /https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,24}\b/i;

/** True when a visitor's query may be shown to other visitors. */
export function isListableQuery(query: string): boolean {
  // NFKC first, so lookalikes are caught: fullwidth digits, "＠" and "﹫", a fullwidth dot. Runs of
  // whitespace count as one space, so padding digits apart does not hide a number.
  const q = query.normalize("NFKC").replace(/\s+/g, " ").trim();
  if (q.length < MIN_CHARS || q.length > MAX_CHARS) return false;
  return !LONG_NUMBER.test(q) && !AT_SIGN.test(q) && !LINK.test(q);
}
