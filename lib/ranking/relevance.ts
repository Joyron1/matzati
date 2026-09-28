// How exactly a title is what was searched for (docs/search-quality-plan.md, item 2). A score part,
// never a filter: a good product whose title opens with a brand only moves down. Pure: no I/O.
import type { SearchFilters } from "@/lib/search/filters";
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
  const preferred = (f.preferences ?? []).flatMap((p) => p.words.flatMap(stems));
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

/** "small", "mini", "compact" in the search words (keywords or product terms). */
export function asksForSmall(f: Pick<SearchFilters, "keywords_en" | "product_terms">): boolean {
  const words = tokenize([f.keywords_en, ...f.product_terms].join(" "));
  return words.some((w) => w === "small" || w === "mini" || w === "compact");
}
