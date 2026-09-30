// How exactly a title is what was searched for (docs/search-quality-plan.md, item 2). A score part,
// never a filter: a good product whose title opens with a brand only moves down. Pure: no I/O.
import type { Preference, SearchFilters } from "@/lib/search/filters";
import { RELEVANCE, TYPE_GATE } from "./config";
import { requirementPhrases, stem, stems, tokenize } from "./match";
import { PRODUCT_SYNONYM_GROUPS } from "./synonyms";
import { BUNDLE_WORDS, productMatch } from "./type-gate";

/** Words that say nothing about the product. */
const NOT_COUNTED = new Set([
  "for",
  "with",
  "and",
  "the",
  "of",
  "in",
  "non",
  "anti",
  "no",
  "free",
  "durable",
  "quality",
  "best",
  "good",
  "new",
  "premium",
  "hot",
  "cheap",
]);

let oneWordSynonyms: Map<string, string[]> | undefined;

/** Single-word synonyms of a stem, so "Earphones" covers the search word "earbuds". */
function synonymsOf(word: string): string[] {
  if (!oneWordSynonyms) {
    oneWordSynonyms = new Map();
    for (const group of PRODUCT_SYNONYM_GROUPS) {
      const single = group.filter((m) => !m.includes(" ")).map((m) => stems(m)[0]);
      for (const w of single) oneWordSynonyms.set(w, single);
    }
  }
  return oneWordSynonyms.get(word) ?? [word];
}

/**
 * The search words a title should contain: keywords_en as stems, without requirement words (the
 * filter already checked them, often in another phrasing) and words that say nothing, plus the
 * words of stated needs no filter checks (SearchFilters.preferences: "laptop" and "phone" for
 * "לטלפון ולמחשב נייד"), so titles that say them rank higher.
 */
export function coverageWords(
  f: Pick<SearchFilters, "keywords_en" | "requirements" | "preferences">,
): string[] {
  const required = new Set(f.requirements.flatMap((r) => requirementPhrases(r).flatMap(stems)));
  // A whole phrase ("3rd birthday", "number 3") counts only as a whole (preferenceFit), never as
  // its words: "number" alone would favor a "Number 5" balloon.
  const preferred = (f.preferences ?? []).flatMap((p) =>
    p.words.filter((w) => !isPreferencePhrase(w)).flatMap(stems),
  );
  const own = [...stems(f.keywords_en), ...preferred].filter(
    (w) => !required.has(w) && !NOT_COUNTED.has(w) && !/^\d+$/.test(w),
  );
  return [...new Set(own)];
}

/**
 * The title's stems that describe the listing itself: all but the words right after "with"
 * ("Storage Box Organizer with Drawers" has drawers; it is not a drawer organizer).
 */
function ownStems(title: string): Set<string> {
  const words = tokenize(title);
  const own = new Set<string>();
  let part = 0;
  for (const w of words) {
    if (BUNDLE_WORDS.has(w)) {
      part = TYPE_GATE.bundleGap;
      continue;
    }
    if (part > 0) part--;
    else own.add(stem(w));
  }
  return own;
}

/**
 * Relevance in [0, 1]: RELEVANCE.termPosition × where the product term starts (1 within the first
 * RELEVANCE.headWords words, falling to 0 at the end of the type gate's window), plus
 * RELEVANCE.subject when no unsearched object ("Car ...") comes before it, plus RELEVANCE.coverage
 * × the share of `words` (coverageWords) the title says of the listing itself (ownStems), plus
 * RELEVANCE.primaryTerm when the first product term matched in its own words (ProductMatch).
 * 0 when the title is not the product.
 */
export function relevance(
  title: string,
  f: Pick<SearchFilters, "keywords_en" | "product_terms" | "requirements" | "preferences">,
  words: readonly string[] = coverageWords(f),
): number {
  const match = productMatch(title, f);
  if (!match) return 0;
  const span = TYPE_GATE.windowTokens - RELEVANCE.headWords;
  const position =
    match.position <= RELEVANCE.headWords
      ? 1
      : Math.max(0, (TYPE_GATE.windowTokens - match.position) / span);
  const titleStems = ownStems(title);
  const covered = words.filter((w) => synonymsOf(w).some((s) => titleStems.has(s))).length;
  const coverage = words.length ? covered / words.length : 1;
  return (
    RELEVANCE.termPosition * position +
    RELEVANCE.subject * (match.forOtherObject ? 0 : 1) +
    RELEVANCE.coverage * coverage +
    RELEVANCE.primaryTerm * (match.primary ? 1 : 0)
  );
}

/**
 * A preference entry that is matched as a whole phrase: several words, or a number ("3rd
 * birthday", "number 3", "3 years"). A plain word ("laptop") is a coverage word as before.
 */
export function isPreferencePhrase(entry: string): boolean {
  return /\s|\d/.test(entry.trim());
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The title says `phrase` as a whole: its words in order, apart from spaces, hyphens or
 * underscores, and not inside a longer word or number. A phrase that starts with a number is not
 * the end of a range ("1-3 Years" does not say "3 years"), and one that ends with a number is not
 * the start of one ("Number 3-5"). So "3pcs", "3m", "3 in 1" or "Number 30" never say "number 3" or
 * "3 years".
 */
export function titleSaysPhrase(title: string, phrase: string): boolean {
  const words = phrase
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean);
  if (!words.length) return false;
  const body = words.map(escapeRegExp).join("[\\s_-]+");
  const notRangeEnd = /^\d/.test(words[0]) ? "(?<!\\d\\s*[-–~/+]\\s*)" : "";
  const notRangeStart = /\d$/.test(words.at(-1)!) ? "(?!\\s*[-–~/.,]\\s*\\d)" : "";
  const re = new RegExp(
    `${notRangeEnd}(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])${notRangeStart}`,
    "iu",
  );
  return re.test(title);
}

/**
 * The title says the preference: one of its whole phrases (titleSaysPhrase), or, for a preference
 * of plain words (a need no filter could check, "laptop" and "phone"), every one of its words.
 */
export function statesPreference(title: string, p: Preference): boolean {
  const phrases = p.words.filter(isPreferencePhrase);
  if (phrases.some((phrase) => titleSaysPhrase(title, phrase))) return true;
  const plain = p.words.filter((w) => !isPreferencePhrase(w)).flatMap(stems);
  if (!plain.length) return false;
  const titleStems = ownStems(title);
  return plain.every((w) => synonymsOf(w).some((s) => titleStems.has(s)));
}

/**
 * The share of the search's preferences the title states (statesPreference), in [0, 1]; 0 without
 * preferences. The score adds it with WEIGHTS.preference, so among comparable passers the ones
 * that say "Number 3" or "3rd Birthday" come first for "יום הולדת 3".
 */
export function preferenceFit(title: string, f: Pick<SearchFilters, "preferences">): number {
  const prefs = f.preferences ?? [];
  if (!prefs.length) return 0;
  return prefs.filter((p) => statesPreference(title, p)).length / prefs.length;
}

/** "small", "mini", "compact" in the search words (keywords or product terms). */
export function asksForSmall(f: Pick<SearchFilters, "keywords_en" | "product_terms">): boolean {
  const words = tokenize([f.keywords_en, ...f.product_terms].join(" "));
  return words.some((w) => w === "small" || w === "mini" || w === "compact");
}
