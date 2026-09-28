// Checks for LLM-written Hebrew copy, applied after generation.

// Scripts that never belong in our Hebrew UI copy (Arabic, Cyrillic, CJK, Hangul). Haiku once
// wrote "לרقبה" (Arabic letters inside a Hebrew word) in a product title.
const FOREIGN_SCRIPT =
  /[\u0600-\u06FF\u0750-\u077F\u0400-\u04FF\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;

export function hasForeignScript(text: string): boolean {
  return FOREIGN_SCRIPT.test(text);
}

// Copy rules: plural, gender-neutral address (שלכם, לכם), never singular (שלך, לך, אתה).
// אתה may carry a ש/ו prefix ("מה שאתה צריך").
const SINGULAR_ADDRESS = /(^|[\s"'(־])(שלך|לך|[וש]?אתה)(?=$|[\s.,!?:;)"'])/;

export function usesSingularAddress(text: string): boolean {
  return SINGULAR_ADDRESS.test(text);
}

// A one-letter prefix glued to Latin or digits ("וQC3.0", "ב-PD") takes a maqaf.
const PREFIX_BEFORE_LATIN = /(^|[\s("])([ובלהמשכ])-?(?=[A-Za-z0-9])/g;

/**
 * Misspellings seen in real queries and model output, and their spelling. Each matches a whole
 * word after up to two one-letter prefixes (`prefixes`, default ובלהמש). Keep the table small and
 * sure: every entry rewrites copy other shoppers see.
 */
const MISSPELLINGS: { wrong: string; right: string; prefixes?: string }[] = [
  // A model label, eval round 2 ("אטום לדיסות").
  { wrong: "דיסות", right: "דליפות" },
  // A shopper's typo that reached the labels and every line (typo-earbuds, eval round 3). No ש
  // prefix: "שמיים" is a word.
  { wrong: "מיים", right: "מים", prefixes: "ובלהמ" },
  // Bluetooth written like the plural of "gland". "בלוטות׳", with a geresh, is right and stays.
  { wrong: "בלוטות", right: "בלוטוס" },
  // Model output, eval round 3 ("ותפתוח חושי").
  { wrong: "תפתוח", right: "פיתוח" },
  // Bone conduction, a common earphone type: the construct form (eval round 3, "הולכה עצם").
  { wrong: "הולכה עצם", right: "הולכת עצם" },
];
const misspelled = MISSPELLINGS.map(
  ({ wrong, right, prefixes = "ובלהמש" }) =>
    [
      new RegExp(`(^|[^א-ת])([${prefixes}]{0,2})${wrong}(?![א-ת׳״'"])`, "g"),
      `$1$2${right}`,
    ] as const,
);

/**
 * Fixes the known misspellings (MISSPELLINGS). Applied to the parse's Hebrew labels, to the
 * explain input built from them and to the model's lines, so a typo in one shopper's query never
 * reaches copy that is cached and shown to others.
 */
export function fixSpelling(text: string): string {
  return misspelled.reduce((s, [re, fix]) => s.replace(re, fix), text).replace(/ייי+/g, "יי"); // three yods in a row is never right ("נייידה", eval round 3)
}

/**
 * Safe spelling fixes applied before the checks: a maqaf after a one-letter prefix, the Hebrew
 * marks in abbreviations (ס"מ → ס״מ, אינץ' → אינץ׳) and the known misspellings (fixSpelling).
 */
export function tidyHebrew(text: string): string {
  return fixSpelling(
    text
      .replace(PREFIX_BEFORE_LATIN, "$1$2־")
      .replace(/([א-ת])"(?=[א-ת])/g, "$1״")
      // A quoted phrase ('נגד החלקה') keeps its closing quote; any other ' after a letter is a geresh.
      .replace(/(^|[\s(])'[^'\n]+'(?![א-תA-Za-z0-9])|([א-ת])'/g, (m, _start, letter?: string) =>
        letter ? `${letter}׳` : m,
      ),
  );
}

// Garbled words and transliterations the model wrote for English title words (eval round 3 and
// the live site). A line with one is rejected: there is no safe fix. Matched inside a word, so
// prefixed and inflected forms count.
const GARBLED = ["קולפסיבילי", "הסיסמום", "סופטני", "וזקנין"];

export function hasGarbledWord(text: string): boolean {
  return text.split(/[^א-ת]+/).some((word) => GARBLED.some((g) => word.includes(g)));
}

// "מתחת לתקציב שלכם" is true only when the shopper gave a budget (a max price).
const BUDGET_WORD = /(^|[^א-ת])[ובלהמש]{0,3}תקציב/;

export function mentionsBudget(text: string): boolean {
  return BUDGET_WORD.test(text);
}

// ---------------------------------------------------------------- Latin words in Hebrew copy
// Hebrew copy keeps a Latin word only when title_en has it and it is a brand, a model or a spec
// (docs/search-quality-plan.md, A9): "רמקול Zealot-S32 עמיד למים IPX6", never "מארגן מגירות
// Expandable", and never the brand of the device a product fits ("New For OPPO ... Smart Watch" is
// not an OPPO watch) unless the copy says "for" too ("מגן ל־iPhone 15").

/** Specs and standards: kept wherever the title states them, also after "for". */
const SPEC_WORDS = new Set([
  "bluetooth",
  "wifi",
  "usb",
  "usbc",
  "lightning",
  "hdmi",
  "magsafe",
  "qi",
  "nfc",
  "gps",
  "gan",
  "led",
  "rgb",
  "lcd",
  "oled",
  "amoled",
  "hd",
  "fhd",
  "uhd",
  "hifi",
  "tws",
  "anc",
  "enc",
  "pd",
  "qc",
  "pps",
  "otg",
  "bpa",
  "eva",
  "abs",
  "tpe",
  "tpu",
  "pvc",
  "pu",
  "mah",
]);
// "65W", "22.5W", "10000mAh", "V5.4", "2.4G", "38L", "3D", and IP ratings ("IPX7", "IP68").
const SPEC_TOKEN = /^(?:v?\d+[a-z]{0,4}|ipx?\d{0,2})$/;

/** Kept next to a model number only ("H9 Pro Max"); alone they are plain words. */
const MODEL_SUFFIXES = new Set(["pro", "max", "mini", "plus", "ultra", "lite", "air", "neo", "se"]);

/**
 * Plain seller words that may open a title but are never a brand ("Expandable Kitchen Cabinet",
 * "Magnetic Car Wireless Charger"). Adjectives are caught by their endings; this names the rest.
 */
const COMMON_WORDS = new Set(
  (
    "car cute smart men women man woman kids kid baby children child set winter summer cartoon " +
    "outdoor outdoors travel ultra garden type large small big multi open wooden anime motion " +
    "fashion bone fast high sport sports bike bicycle kitchen home house water black white pink " +
    "blue red green grey gray gold silver soft drawer running magic wall color colour choice ice " +
    "real memory solar strong super heavy storage warm non music double dual true pure cotton " +
    "space plug compact pot luggage night phone watch style round luxury laser power tool tools " +
    "neck design short long slim light mouse speaker speakers earphones headphones earbuds headset " +
    "charger cable holder stand mount backpack bag case cover organizer pillow lamp bottle cup " +
    "toy toys game box rack shelf kit pack piece pieces pcs pc best top quality brand for with " +
    "and the new hot sale thin mesh camp hiking fishing gym yoga office school desk bath shower " +
    "pet dog cat"
  ).split(" "),
);
// Adjective endings: expandable, magnetic, wireless, waterproof, folding, colorful, tactical ...
const ADJECTIVE_ENDING = /(?:able|ible|ing|ed|ful|less|proof|ive|ous|ic|al)$/;
/** Title words sellers put before the brand ("Original GDLYL HD65", "New For OPPO ..."). */
const TITLE_FILLER = new Set([
  "new",
  "original",
  "genuine",
  "official",
  "hot",
  "sale",
  "upgraded",
  "updated",
  "latest",
  "newest",
]);
/** A title word that makes what follows the device a product fits: "... For iPhone 15". */
const FOR_WORDS = new Set(["for", "fit", "fits", "compatible", "suitable"]);
/** How many words after "for" (numbers not counted) name the device: "For iPhone 12 13 Samsung". */
const FOR_REACH = 4;

type Shape = "caps" | "camel" | "title" | "lower";

interface TitleIndex {
  /** Every run of 1-3 title words, glued and lowercased ("zealots32"), and where it starts. */
  starts: Map<string, number[]>;
  shapes: Map<string, Shape>;
  /** Per title word: its place after the last "for" (1: right after it; numbers not counted). */
  afterFor: number[];
  /** The title's first word after the fillers: sellers open with the brand. */
  firstWord: string | null;
}

/** "USB-C", "usb c", "Type-C" and "typec" are one spec. */
const glue = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .replace(/typec/g, "usbc");

function shapeOf(original: string, capsTitle: boolean): Shape {
  const letters = original.replace(/[^A-Za-z]/g, "");
  if (letters.length >= 2 && letters === letters.toUpperCase()) return capsTitle ? "title" : "caps";
  if (/[a-z][A-Z]/.test(original)) return "camel";
  return /^[A-Z]/.test(letters) ? "title" : "lower";
}

function indexTitle(titleEn: string): TitleIndex {
  const words = titleEn.split(/[^A-Za-z0-9]+/).filter(Boolean);
  // In a title written all in capitals, capitals say nothing about brands.
  const lettered = words.filter((w) => /[A-Za-z]{2}/.test(w));
  const capsTitle =
    lettered.length > 0 &&
    lettered.filter((w) => w === w.toUpperCase()).length / lettered.length > 0.6;
  const starts = new Map<string, number[]>();
  const shapes = new Map<string, Shape>();
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 3 && i + n <= words.length; n++) {
      const original = words.slice(i, i + n).join("");
      const key = glue(original);
      starts.set(key, [...(starts.get(key) ?? []), i]);
      if (!shapes.has(key)) shapes.set(key, shapeOf(original, capsTitle));
    }
  }
  const afterFor: number[] = [];
  let since = Infinity;
  for (const w of words) {
    afterFor.push(since);
    if (FOR_WORDS.has(w.toLowerCase())) since = 0;
    else if (!/^\d+$/.test(w)) since += 1;
  }
  const first = words.find((w) => !/^\d/.test(w) && !TITLE_FILLER.has(w.toLowerCase()));
  const firstWord = first && !FOR_WORDS.has(first.toLowerCase()) ? glue(first) : null;
  return { starts, shapes, afterFor: afterFor.map((d) => d + 1), firstWord };
}

// A word of Latin letters and digits: "Zealot-S32", "V5.4", "USB-C", "3/Y", "220V/110V".
const LATIN_WORD = /[A-Za-z0-9](?:[A-Za-z0-9.+/-]*[A-Za-z0-9+])?/g;
// What joins Latin words into one name ("Lenovo S102", "Bluetooth ו־Wi-Fi"). Not a comma: after
// one, a number may start the next Hebrew phrase ("Adjustable, 4 שכבות").
const RUN_GAP = /^\s+(?:ו־)?$|^\s*[/&+]\s*$/;
/** Hebrew before a name that says "for": "ל־iPhone", "תואם Samsung". */
const COMPAT_BEFORE =
  /(?:^|[^א-ת])(?:ל־|(?:תואם|תואמת|תואמים|תואמות|עבור|מתאים|מתאימה|מתאימים|מתאימות)\s+)$/;
/** A device named in Hebrew with "for", before its model: "לטסלה 3/Y", "לאייפון 15 Pro". */
const FOR_DEVICE_BEFORE = /(?:^|[^א-ת])ל[א-ת]+\s+$/;

interface Word {
  text: string;
  start: number;
  end: number;
}

interface LatinRun {
  /** The name's words; numbers count as a model ("Lenovo S102", "Tribit 20"). */
  words: Word[];
  ok: boolean;
}

const hasLatin = (w: Word) => /[A-Za-z]/.test(w.text);

function latinWordOk(word: string, title: TitleIndex, hasModel: boolean, compat: boolean) {
  const key = glue(word);
  const at = title.starts.get(key);
  if (!at) return false;
  // A shape letter ("U Shaped") or a spec ("IPX7", "65W") is fine wherever the title has it.
  if (key.length === 1 || SPEC_WORDS.has(key) || SPEC_TOKEN.test(key)) return true;
  if (at.every((i) => title.afterFor[i] <= FOR_REACH) && !compat) return false;
  if (/\d/.test(key)) return true;
  const shape = title.shapes.get(key);
  if (shape === "caps" || shape === "camel") return true;
  if (shape !== "title") return false;
  if (MODEL_SUFFIXES.has(key)) return hasModel;
  if (COMMON_WORDS.has(key) || ADJECTIVE_ENDING.test(key)) return false;
  return key === title.firstWord || hasModel;
}

function latinRuns(text: string, titleEn: string): LatinRun[] {
  const groups: Word[][] = [];
  for (const m of text.matchAll(LATIN_WORD)) {
    const w = { text: m[0], start: m.index, end: m.index + m[0].length };
    const last = groups.at(-1);
    if (last && RUN_GAP.test(text.slice(last.at(-1)!.end, w.start))) last.push(w);
    else groups.push([w]);
  }
  const title = indexTitle(titleEn);
  return groups
    .filter((g) => g.some(hasLatin))
    .map((words) => {
      const hasModel = words.some((w) => /\d/.test(w.text));
      const before = text.slice(0, words[0].start);
      // "לרכב iPhone 15" does not say the car is an iPhone's, but "לטסלה 3/Y" names Tesla's model.
      const modelOnly = words.every(
        (w) => !hasLatin(w) || /\d/.test(w.text) || MODEL_SUFFIXES.has(w.text.toLowerCase()),
      );
      const compat = COMPAT_BEFORE.test(before) || (modelOnly && FOR_DEVICE_BEFORE.test(before));
      const ok = words.every((w) => !hasLatin(w) || latinWordOk(w.text, title, hasModel, compat));
      return { words, ok };
    });
}

/** True when the text has a Latin word that is not a brand, model or spec of this title. */
export function hasForeignWord(text: string, titleEn: string): boolean {
  return latinRuns(text, titleEn).some((r) => !r.ok);
}

// Hebrew that belongs to a dropped Latin name and would dangle without it: "עם Fast Charging".
const LEAD_IN =
  /(?:(?:^|\s)(?:עם|של|ללא|בלי|מסוג|דגם|מבית|תואם|תואמת|עבור|בעל|בעלת|כולל))?\s*(?:[ובלהמשכ]־)?$/;

/**
 * Drops each Latin name that fails hasForeignWord's rules, with a one-letter prefix or a lead-in
 * word that belongs to it ("מעמד לרכב עם Fast Charging" → "מעמד לרכב"), but not the numbers
 * after it ("Adjustable 4 שכבות" → "4 שכבות"). Dropping says less and never adds a claim.
 */
export function withoutForeignWords(text: string, titleEn: string): string {
  let out = text;
  for (const run of latinRuns(text, titleEn).reverse()) {
    if (run.ok) continue;
    let last = run.words.length - 1;
    while (last > 0 && !hasLatin(run.words[last])) last--;
    const before = out.slice(0, run.words[0].start).replace(LEAD_IN, "");
    out = `${before} ${out.slice(run.words[last].end)}`;
  }
  return out
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,;:])(?=[,.;:])/g, "")
    .replace(/^[\s,;:]+|[\s,;:]+$/g, "")
    .replace(/\s+/g, " ");
}

// Hebrew and Latin letters inside one word, e.g. "רשult" (seen in a real Haiku output). One
// Hebrew letter before Latin is a prefix, which tidyHebrew already separated when it could.
const MIXED_SCRIPT = /[א-ת]{2,}[A-Za-z]|[A-Za-z][א-ת]/;

export function hasMixedScript(text: string): boolean {
  return MIXED_SCRIPT.test(text);
}

/**
 * A line that is very short or lacks final punctuation was most likely cut off: under structured
 * output an ASCII " typed for gershayim ends the JSON string ("מארגן פלסטיק לסכו").
 */
export function isTruncated(text: string, minLength: number): boolean {
  return text.length < minLength || !/[.!?]$/.test(text);
}

// The card already shows the price, rounded and with ≈ when converted (CLAUDE.md §9). A second
// price in the line would disagree with it.
const PRICE =
  /₪|\$|(^|[^א-ת])(ש["״”'׳]ח|[בלו]?(שקל|שקלים|דולר|דולרים)|[בוה]?מחיר(\s+של)?\s+\d)(?=$|[^א-ת])/;

export function writesPrice(text: string): boolean {
  return PRICE.test(text);
}

export type Superlative =
  | "cheapest"
  | "most_sold"
  | "top_feedback"
  | "top_discount"
  /** "הכי טוב", "נוח ביותר", "המשתלם מבין השלושה": nothing in our data can prove it. */
  | "unverifiable";

const SUFFIX = "(?:ה|ת|ים|ות)?";
// A claim takes its scope with it ("הזול מבין השלושה"), so a scope left over belongs to a
// comparison we cannot check ("המשתלם מבין השלושה").
const claim = (forms: string) => new RegExp(`(?:${forms})(?:\\s+מבין\\s+[א-ת]+)?`, "g");
const VERIFIABLE: [Exclude<Superlative, "unverifiable">, RegExp][] = [
  [
    "cheapest",
    claim(
      `ה?זול${SUFFIX}\\s+ביותר|הזול${SUFFIX}(?![א-ת])|הכי\\s+זול${SUFFIX}|מחיר\\s+(?:הכי\\s+נמוך|הנמוך(?:\\s+ביותר)?)`,
    ),
  ],
  [
    "most_sold",
    claim(
      [
        `הנמכר${SUFFIX}(?:\\s+ביותר)?(?![א-ת])`,
        `הכי\\s+נמכר${SUFFIX}`,
        `מכירות\\s+(?:הכי\\s+גבוהות|הגבוה(?:ות)?\\s+ביותר)`,
        `הכי\\s+הרבה\\s+(?:מכירות|יחידות|קונים|נמכרו)`,
        `הכי\\s+פופולרי${SUFFIX}`,
        `הפופולרי${SUFFIX}(?:\\s+ביותר)?(?![א-ת])`,
        `רב(?:י|ת)?[\\s־-]+ה?מכר`,
      ].join("|"),
    ),
  ],
  [
    "top_feedback",
    claim(
      `(?:משוב(?:\\s+ה?חיובי)?|דירוג)\\s+(?:הכי\\s+גבוה|הגבוה\\s+ביותר)|הכי\\s+הרבה\\s+משוב(?:\\s+חיובי)?|המדורג${SUFFIX}\\s+ביותר`,
    ),
  ],
  [
    "top_discount",
    claim(
      `הנחה\\s+(?:הכי\\s+(?:גדולה|גבוהה)|ה(?:גדולה|גבוהה)\\s+ביותר)|הכי\\s+הרבה\\s+הנחה|הכי\\s+מוזל${SUFFIX}|המוזל${SUFFIX}\\s+ביותר`,
    ),
  ],
];
const ANY_SUPERLATIVE = /(^|[^א-ת])([וש]?הכי|ביותר)(?=$|[^א-ת])/;
// "מבין השלושה" or "מהאחרים" with no verifiable claim in front of it.
const ANY_COMPARISON = /(^|[^א-ת])ו?מבין(?=$|[^א-ת])|האחר(?:ים|ות)(?![א-ת])/;

/**
 * Comparative claims in a line. The caller checks each verifiable claim against the products
 * shown together; any other superlative left over is "unverifiable".
 */
export function superlativeClaims(text: string): Superlative[] {
  const claims: Superlative[] = [];
  let rest = text;
  for (const [claim, re] of VERIFIABLE) {
    if (rest.match(re)) {
      claims.push(claim);
      rest = rest.replace(re, " ");
    }
  }
  if (ANY_SUPERLATIVE.test(rest) || ANY_COMPARISON.test(rest)) claims.push("unverifiable");
  return claims;
}

/** How many products a comparison says it covers: "מבין השלושה" → 3, "מבין שני המוצרים" → 2. */
export function comparisonSizes(text: string): number[] {
  const sizes: number[] = [];
  if (/מבין\s+(?:השלושה|השלוש|שלושת|שלוש)(?![א-ת])/.test(text)) sizes.push(3);
  if (/מבין\s+(?:השניים|השתיים|שני|שתי|שניהם|שתיהן)(?![א-ת])/.test(text)) sizes.push(2);
  return sizes;
}
