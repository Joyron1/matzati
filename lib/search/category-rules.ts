// Rules by category (owner request 2026-10-23), applied by code to the parse of a search whose
// assigned categories (category_guess, lib/search/categories.ts) or page category call for them.
// Applied where a search reads its parse (lib/search/pipeline.ts), cached or new, so a rule
// change needs no new parse; the filters it changes are part of the results cache key.
//
// - Jewelry and watches: "זהב" on AliExpress is nearly always plating. Real gold or silver asked
//   in words ("זהב אמיתי", "14 קראט", "כסף 925") makes the metal a strict requirement whose title
//   must not say plated, filled or "gold color"; a plain "זהב"/"כסף" stays as it was and the page
//   says what it usually means.
// - Toys and kids: a child's age in the query ("לילד בן 5") keeps out toys whose title states an
//   older minimum age (lib/ranking/age.ts).
// - Clothing and shoes: a size is never a title filter (sellers list sizes in variants, which we
//   cannot read): it becomes a preference, and the page says to check the size chart.
import type { ParsedQuery, Preference, Requirement } from "./filters";

const JEWELRY = new Set(["36", "1511"]);
const KIDS = new Set(["26", "1501"]);
const CLOTHING = new Set([
  "3",
  "200000345",
  "200000343",
  "200000297",
  "200574005",
  "322",
  "201768104",
  "1501",
]);

/** The categories a search is in: the page's own, else the parse's assigned ones. */
function categoriesOf(p: ParsedQuery): string[] {
  return p.category_id ? [p.category_id] : (p.category_guess ?? []);
}

const inAny = (ids: string[], set: ReadonlySet<string>) => ids.some((id) => set.has(id));

const words = (r: Requirement) => [r.en, ...r.alt].join(" ").toLowerCase();

// --- Jewelry -------------------------------------------------------------------------------------

/** Plating and look-alike words a real-metal title never needs. */
export const NOT_SOLID_GOLD = [
  "plated",
  "plating",
  "filled",
  "vermeil",
  "gold color",
  "gold tone",
  "golden color",
  "electroplated",
  "pvd",
];
export const NOT_SOLID_SILVER = ["plated", "plating", "silver color", "silver tone", "filled"];

const REAL_GOLD =
  /זהב\s*(?:אמיתי|טהור|מלא)|\d{1,2}\s*(?:קראט|קרט|k\b)|\b(?:solid|real)\s+gold\b|\bau\s?(?:375|585|750)\b|\b(?:9|10|14|18|22|24)k\b/i;
const REAL_SILVER = /כסף\s*(?:925|אמיתי|סטרלינג|טהור)|\bsterling\b|\bs?925\b/i;

const SOLID_GOLD_ALT = [
  "solid gold",
  "real gold",
  "9k gold",
  "10k gold",
  "14k gold",
  "18k gold",
  "au750",
  "au585",
];
const STERLING_ALT = ["s925", "925 silver", "sterling silver", "925 sterling"];

function jewelry(p: ParsedQuery, query: string, notes: string[]): Requirement[] {
  let reqs = p.requirements;
  const goldIdx = reqs.findIndex((r) => /\bgold\b/.test(words(r)));
  const silverIdx = reqs.findIndex((r) => /\bsilver\b|\b925\b/.test(words(r)));
  if (REAL_GOLD.test(query)) {
    const strict = (r: Requirement): Requirement => ({
      ...r,
      alt: r.en === "gold" ? [...new Set([...r.alt, ...SOLID_GOLD_ALT])].slice(0, 8) : r.alt,
      he: /אמיתי|קראט|קרט/.test(r.he) ? r.he : `${r.he} אמיתי`,
      not: NOT_SOLID_GOLD,
    });
    reqs =
      goldIdx >= 0
        ? reqs.map((r, i) => (i === goldIdx ? strict(r) : r))
        : [
            ...reqs,
            {
              en: "solid gold",
              alt: SOLID_GOLD_ALT.slice(1),
              he: "זהב אמיתי",
              not: NOT_SOLID_GOLD,
            },
          ];
    notes.push(
      "זהב אמיתי: הוצאנו מוצרים שבשם שלהם כתוב ציפוי (plated, filled, gold color). כדאי לוודא את סימון הקראט בעמוד המוצר.",
    );
  } else if (goldIdx >= 0) {
    notes.push(
      "בתכשיטים באלי אקספרס ״זהב״ הוא כמעט תמיד ציפוי זהב. לזהב אמיתי כתבו ״זהב אמיתי״ או ״14 קראט״.",
    );
  }
  if (REAL_SILVER.test(query)) {
    const strict = (r: Requirement): Requirement => ({
      ...r,
      alt: [...new Set([...r.alt, ...STERLING_ALT])].slice(0, 6),
      he: /925|אמיתי/.test(r.he) ? r.he : `${r.he} 925`,
      not: NOT_SOLID_SILVER,
    });
    reqs =
      silverIdx >= 0
        ? reqs.map((r, i) => (i === silverIdx ? strict(r) : r))
        : [
            ...reqs,
            {
              en: "sterling silver",
              alt: STERLING_ALT.filter((a) => a !== "sterling silver"),
              he: "כסף 925",
              not: NOT_SOLID_SILVER,
            },
          ];
  } else if (silverIdx >= 0) {
    notes.push("תכשיטים ״מכסף״ באלי אקספרס הם לעיתים קרובות ציפוי. לכסף אמיתי כתבו ״כסף 925״.");
  }
  return reqs;
}

// --- Kids ----------------------------------------------------------------------------------------

const BIRTHDAY = /יום\s*הולדת|יומולדת|מסיבה/;
const CHILD_AGE =
  /(?:בן|בת|בני|בנות|לגיל|גיל|בגיל)\s*(\d{1,2})(?!\s*(?:ס״מ|ס"מ|מ״מ|מ"מ|ש״ח|ש"ח|שקל|₪|%|\d))/;

/** The child's age the query states, in years (1-16), or null. */
export function childAgeFrom(query: string): number | null {
  if (BIRTHDAY.test(query)) return null;
  const m = CHILD_AGE.exec(query);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= 16 ? n : null;
}

// --- Clothing ------------------------------------------------------------------------------------

const SIZE_EN = /^(?:size\s*)?(?:eu\s*|us\s*)?(?:\d{2}(?:\.5)?|x{0,3}[sml]|\d?x{1,3}l|[2-6]xl)$/i;

function isSize(r: Requirement): boolean {
  return SIZE_EN.test(r.en.trim()) || /מידה|מידות/.test(r.he);
}

// --- All -----------------------------------------------------------------------------------------

/**
 * The parse with its category's rules applied, and the notes the results page shows about them
 * (`category_notes`). A search in no ruled category comes back unchanged (the same object).
 */
export function applyCategoryRules(parsed: ParsedQuery, query: string): ParsedQuery {
  const cats = categoriesOf(parsed);
  if (!cats.length) return parsed;
  const notes: string[] = [];
  let requirements = parsed.requirements;
  let preferences: Preference[] = parsed.preferences ?? [];
  let childAge: number | null = null;

  if (inAny(cats, JEWELRY)) requirements = jewelry({ ...parsed, requirements }, query, notes);

  if (inAny(cats, KIDS)) {
    childAge = childAgeFrom(query);
    if (childAge !== null) {
      notes.push(`לא הצגנו מוצרים שבשם שלהם כתוב שהם לגיל מבוגר מ־${childAge}.`);
    }
  }

  if (inAny(cats, CLOTHING)) {
    const sizes = requirements.filter(isSize);
    if (sizes.length) {
      requirements = requirements.filter((r) => !isSize(r));
      preferences = [
        ...preferences,
        ...sizes.map((r) => ({ words: r.en.toLowerCase().split(/\s+/), he: r.he })),
      ];
      notes.push(
        "את המידה בודקים בטבלת המידות בעמוד המוצר באלי אקספרס: המוכרים כמעט לא כותבים אותה בשם המוצר.",
      );
    }
  }

  if (requirements === parsed.requirements && childAge === null && !notes.length) return parsed;
  return {
    ...parsed,
    requirements,
    ...(preferences.length ? { preferences } : {}),
    ...(childAge !== null ? { child_age: childAge } : {}),
    ...(notes.length ? { category_notes: notes } : {}),
  };
}
