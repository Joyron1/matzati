// Post-check for LLM text (CLAUDE.md §6.8): every number in the output must come from the input.

/** units_sold_30d covers the last 30 days, so "ב־30 הימים האחרונים" is always grounded. */
export const SALES_WINDOW_DAYS = 30;
const ALWAYS_ALLOWED = [String(SALES_WINDOW_DAYS)];

/** "96.8% ... 3,412 ... ₪100" → ["96.8", "3412", "100"] */
export function extractNumbers(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map(normalizeNumber);
}

function normalizeNumber(raw: string): string {
  // "3,412" → "3412"; "96.8" stays; "1,234.5" → "1234.5"
  const noThousands = raw.replace(/,(?=\d{3}(?:\D|$))/g, "");
  const n = Number(noThousands.replace(",", "."));
  return Number.isFinite(n) ? String(n) : noThousands;
}

/**
 * Collects every number in the input's values. Keys are skipped: the field name
 * "units_sold_30d" must not make 30 look like a fact about the product.
 */
export function numbersIn(data: unknown): Set<string> {
  const found = new Set<string>();
  const visit = (value: unknown): void => {
    if (typeof value === "string") extractNumbers(value).forEach((n) => found.add(n));
    else if (typeof value === "number" && Number.isFinite(value)) {
      extractNumbers(String(value)).forEach((n) => found.add(n));
    } else if (Array.isArray(value)) value.forEach(visit);
    else if (value !== null && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(data);
  return found;
}

/**
 * True when every number in `text` appears in `data` or in `always`.
 * Titles pass `always = []`: their numbers must come from the original title only.
 */
export function numbersAreGrounded(
  text: string,
  data: unknown,
  always: readonly string[] = ALWAYS_ALLOWED,
): boolean {
  const allowed = numbersIn(data);
  return extractNumbers(text).every((n) => allowed.has(n) || always.includes(n));
}
