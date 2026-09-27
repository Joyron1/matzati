// Slugs for the SEO landing pages (/s/<slug>): Hebrew-friendly and readable in the address bar,
// e.g. "אוזניות לריצה, עמידות למים" → "אוזניות-לריצה-עמידות-למים". Pure and client-safe: the admin
// form suggests a slug live from the query with the same function the server validates with.
// The database checks the same rule (supabase/migrations/phase2_seo.sql).

export const SLUG_MAX_LENGTH = 60;

// Hebrew letters (final forms included), Latin lowercase letters and digits.
const WORD = "[\\u05D0-\\u05EAa-z0-9]+";
const SLUG_PATTERN = new RegExp(`^${WORD}(?:-${WORD})*$`);

const MAQAF = /־/g; // Hebrew hyphen "־"
// Niqqud, cantillation and the other marks that sit on a letter (the maqaf is handled above).
const MARKS = /[֑-ׇ]/g;
// Quote-like characters are dropped inside words, so ש״ח becomes שח and צ׳יפס becomes ציפס.
const QUOTES = /["'`´״׳“”„‘’]/g;
const NOT_SLUG_CHAR = /[^א-תa-z0-9]+/g;

/** A stored slug: Hebrew letters, a-z, 0-9, single dashes between words, at most 60 characters. */
export function isValidSlug(slug: unknown): slug is string {
  return (
    typeof slug === "string" &&
    slug.length > 0 &&
    slug.length <= SLUG_MAX_LENGTH &&
    SLUG_PATTERN.test(slug)
  );
}

/** Joins words with "-" up to the length limit, cutting at a word boundary when it can. */
function joinWords(words: string[]): string {
  let slug = "";
  for (const word of words) {
    const next = slug ? `${slug}-${word}` : word;
    if (next.length > SLUG_MAX_LENGTH) {
      // A single word longer than the limit is cut; otherwise stop before the word that overflows.
      return slug || word.slice(0, SLUG_MAX_LENGTH);
    }
    slug = next;
  }
  return slug;
}

/**
 * Builds a slug from a search query: niqqud and quotes removed, ₪ spelled "שח", punctuation and
 * spaces become single dashes, Latin letters lowercased, at most 60 characters (cut between
 * words). Returns "" when nothing usable is left (e.g. a query of emoji only).
 */
export function slugFromQuery(query: string): string {
  const words = query
    .normalize("NFKC")
    .replace(MAQAF, " ")
    .replace(MARKS, "")
    .replace(QUOTES, "")
    .replace(/₪/g, " שח ")
    .toLowerCase()
    .replace(NOT_SLUG_CHAR, " ")
    .split(" ")
    .filter(Boolean);
  return joinWords(words);
}

/**
 * What the admin typed in the slug field, lightly normalized (trimmed, lowercased, spaces and
 * the Hebrew maqaf turned into dashes, repeated dashes collapsed). The result still has to pass
 * isValidSlug: other characters are reported, not silently removed.
 */
export function normalizeSlugInput(raw: string): string {
  return raw
    .normalize("NFC")
    .trim()
    .toLowerCase()
    .replace(MAQAF, "-")
    .replace(/\s+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The [slug] route param as a stored slug, or null when it cannot be one (so no database query
 * runs for it). Accepts the param percent-encoded or already decoded.
 */
export function parseSlugParam(param: string): string | null {
  let decoded = param;
  if (param.includes("%")) {
    try {
      decoded = decodeURIComponent(param);
    } catch {
      return null;
    }
  }
  const slug = decoded.normalize("NFC");
  return isValidSlug(slug) ? slug : null;
}

/** Public path of a landing page, percent-encoded so it is a valid URL in links and the sitemap. */
export function seoPath(slug: string): string {
  return `/s/${encodeURIComponent(slug)}`;
}
