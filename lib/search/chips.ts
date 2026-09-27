// "הבנתי ככה" chips. Price chips are rendered by code from the numbers, so they are always
// grounded and each maps to exactly one removable filter.
import { formatIls } from "@/lib/format";
import type { FilterChip } from "@/lib/types";
import type { ParsedQuery } from "./filters";

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

/** Removing a chip drops that filter; the parse itself is reused, so no LLM call. */
export function applyOverrides(parsed: ParsedQuery, without: string[]): ParsedQuery {
  if (!without.length) return parsed;
  const drop = new Set(without);
  const next: ParsedQuery = {
    ...parsed,
    requirements: parsed.requirements.filter((r) => !drop.has(requirementChipId(r.en))),
  };
  if (drop.has(MIN_CHIP)) delete next.min_price_ils;
  if (drop.has(MAX_CHIP)) delete next.max_price_ils;
  return next;
}
