// The youngest age a toy's title states it is for (owner request 2026-10-23, category rules): a
// search for a child of a stated age never shows a toy whose title says it is for older children
// ("14+ years" for a 5-year-old: small parts, difficulty). A title that states no age passes.

const PATTERNS: readonly RegExp[] = [
  // "3+ years", "14+ yrs", "8+ y/o", "6 + Years Old"
  /\b(\d{1,2})\s*\+\s*(?:years?|yrs?|y\/?o)\b/gi,
  // "ages 8+", "age 3+", "for ages 6+"
  /\bages?\s*(?:of\s*)?(\d{1,2})\s*\+/gi,
  // "ages 3-6", "age 8 to 12"
  /\bages?\s*(?:of\s*)?(\d{1,2})\s*(?:-|to|~)\s*\d{1,2}\b/gi,
  // "3-6 years", "8 to 12 yrs", "3-6 y/o"
  /\b(\d{1,2})\s*(?:-|to|~)\s*\d{1,2}\s*(?:years?|yrs?|y\/?o)\b/gi,
  // "14 years old and up", "12 years and above", "6 years & older"
  /\b(\d{1,2})\s*(?:years?|yrs?)\s*(?:old\s*)?(?:and|&)\s*(?:up|above|older)\b/gi,
];

/** The smallest minimum age the title states, in years, or null when it states none. */
export function titleMinAge(title: string): number | null {
  let min: number | null = null;
  for (const re of PATTERNS) {
    for (const m of title.matchAll(re)) {
      const n = Number(m[1]);
      if (Number.isInteger(n) && n >= 0 && n <= 18 && (min === null || n < min)) min = n;
    }
  }
  return min;
}

/** The toy is not stated to be for children older than `age` years. */
export function ageFits(title: string, age: number): boolean {
  const min = titleMinAge(title);
  return min === null || min <= age;
}
