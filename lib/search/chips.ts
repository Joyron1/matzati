// "הבנתי ככה" chips. Price chips are rendered by code from the numbers, so they are always
// grounded and each maps to exactly one removable filter.
import { formatIls } from "@/lib/format";
import type { FilterChip } from "@/lib/types";
import type { ParsedQuery, Requirement } from "./filters";

export const PRODUCT_CHIP = "product";
export const MIN_CHIP = "min";
export const MAX_CHIP = "max";
export const requirementChipId = (en: string) => `req:${en}`;

export function buildChips(parsed: ParsedQuery): FilterChip[] {
  const chips: FilterChip[] = [
    { id: PRODUCT_CHIP, kind: "keywords", label_he: parsed.product_he, removable: false },
  ];
  for (const r of parsed.requirements) {
    chips.push({ id: requirementChipId(r.en), kind: "must_have", label_he: r.he, removable: true });
  }
  if (parsed.min_price_ils !== undefined) {
    chips.push({
      id: MIN_CHIP,
      kind: "min_price",
      label_he: `מ־${formatIls(parsed.min_price_ils, false)}`,
      removable: true,
    });
  }
  if (parsed.max_price_ils !== undefined) {
    chips.push({
      id: MAX_CHIP,
      kind: "max_price",
      label_he: `עד ${formatIls(parsed.max_price_ils, false)}`,
      removable: true,
    });
  }
  return chips;
}

const words = (s: string) => s.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * The AliExpress keywords once `removed` requirements are dropped: their words (en and alt) leave
 * the search too (docs/search-quality-plan.md item 8), except words a kept requirement or the
 * product's own name (the first product phrase) uses. With fewer than 2 words left, the first
 * product phrase is the search: the parse makes it two words when one would name other things.
 */
function keywordsWithout(parsed: ParsedQuery, removed: Requirement[], kept: Requirement[]): string {
  const phrases = (rs: Requirement[]) => rs.flatMap((r) => [r.en, ...r.alt]).flatMap(words);
  const keep = new Set([...phrases(kept), ...words(parsed.product_terms[0] ?? "")]);
  const drop = new Set(phrases(removed).filter((w) => !keep.has(w)));
  const left = parsed.keywords_en.split(/\s+/).filter((w) => w && !drop.has(w.toLowerCase()));
  if (left.length >= 2) return left.join(" ");
  return parsed.product_terms[0]?.trim() || parsed.keywords_en;
}

/**
 * Removing a chip drops that filter; the parse itself is reused, so no LLM call. A removed
 * requirement's words also leave the AliExpress keywords (keywordsWithout), so the search is no
 * longer narrowed to titles that name it.
 */
export function applyOverrides(parsed: ParsedQuery, without: string[]): ParsedQuery {
  if (!without.length) return parsed;
  const drop = new Set(without);
  const removed = parsed.requirements.filter((r) => drop.has(requirementChipId(r.en)));
  const kept = parsed.requirements.filter((r) => !drop.has(requirementChipId(r.en)));
  const next: ParsedQuery = {
    ...parsed,
    requirements: kept,
    ...(removed.length ? { keywords_en: keywordsWithout(parsed, removed, kept) } : {}),
  };
  if (drop.has(MIN_CHIP)) delete next.min_price_ils;
  if (drop.has(MAX_CHIP)) delete next.max_price_ils;
  return next;
}
