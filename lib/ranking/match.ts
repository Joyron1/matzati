// Deterministic title matching for product terms and requirements (CLAUDE.md §6.5). Pure: no I/O.
// Titles and phrases go through the same normalization, so "USB-C Chargers" matches
// "usb c charging" and "Water-Proof" matches "water proof".
import type { Requirement } from "@/lib/search/filters";
import { SYNONYM_GROUPS } from "./synonyms";

/** Most other tokens allowed between two consecutive words of a phrase. */
const MAX_GAP = 2;

/** A phrase made only of these words would match almost any title ("non" hits "non-slip"). */
const WEAK_WORDS = new Set(["non", "anti", "no", "free", "with", "for", "and", "the", "of", "in"]);

/** Plurals the suffix rules below get wrong ("knives" would become "knive"). */
const IRREGULAR = new Map([
  ["knives", "knife"],
  ["shelves", "shelf"],
  ["scarves", "scarf"],
  ["leaves", "leaf"],
  ["lenses", "lens"],
  ["lens", "lens"],
]);

function singular(word: string): string {
  if (/\d/.test(word)) return word;
  const irregular = IRREGULAR.get(word);
  if (irregular) return irregular;
  // -ie and -ies both end in -y, so "hoodie" meets "Hoodies" the way "battery" meets "Batteries".
  if (word.length > 4 && /ies?$/.test(word)) return word.replace(/ies?$/, "y");
  if (word.length <= 3 || !word.endsWith("s")) return word;
  if (/(?:ss|us|is)$/.test(word)) return word; // wireless, plus, chassis
  if (/(?:ch|sh|x|ss)es$/.test(word)) return word.slice(0, -2); // watches, boxes
  return word.slice(0, -1);
}

/** Lowercase singular words, with every USB-C spelling (usb-c, type-c, typec) as "usbc". */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\b(?:usb|type)[\s-]?c\b/g, "usbc")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map(singular);
}

/**
 * Trims -ing and -er so "charging" and "charger" both become "charg". The stem must keep 5
 * letters, which leaves short words alone (holder, drawer, folding, water, power).
 */
export function stem(word: string): string {
  if (/\d/.test(word)) return word;
  let w = word;
  for (const suffix of ["ing", "er"]) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 5) w = w.slice(0, -suffix.length);
  }
  return w;
}

export function stems(text: string): string[] {
  return tokenize(text).map(stem);
}

/**
 * A letters-only term also matches the same letters followed by digits: "ipx" → ipx4..ipx8.
 * "usb" also matches "usbc", because a USB-C cable is a USB cable.
 */
function tokenMatches(titleToken: string, term: string): boolean {
  if (titleToken === term) return true;
  if (term === "usb" && titleToken === "usbc") return true;
  return (
    term.length >= 2 &&
    /^[a-z]+$/.test(term) &&
    titleToken.startsWith(term) &&
    /^\d+$/.test(titleToken.slice(term.length))
  );
}

export interface Span {
  /** Index of the phrase's first word in the title tokens. */
  start: number;
  /** Index of the phrase's last word in the title tokens. */
  end: number;
}

function spanEnd(tokens: string[], words: string[], at: number, next: number): number {
  if (next === words.length) return at;
  const last = Math.min(tokens.length - 1, at + MAX_GAP + 1);
  for (let j = at + 1; j <= last; j++) {
    if (!tokenMatches(tokens[j], words[next])) continue;
    const end = spanEnd(tokens, words, j, next + 1);
    if (end >= 0) return end;
  }
  return -1;
}

/**
 * Every place `phrase` occurs in the title tokens: its words in order, with at most MAX_GAP
 * other tokens between them. `split` must normalize the phrase the way the title tokens were
 * (stems by default). Empty and weak-only phrases never occur.
 */
export function phraseSpans(
  titleTokens: string[],
  phrase: string,
  split: (text: string) => string[] = stems,
): Span[] {
  const words = split(phrase);
  if (words.every((w) => WEAK_WORDS.has(w))) return [];
  const spans: Span[] = [];
  for (let i = 0; i < titleTokens.length; i++) {
    if (!tokenMatches(titleTokens[i], words[0])) continue;
    const end = spanEnd(titleTokens, words, i, 1);
    if (end >= 0) spans.push({ start: i, end });
  }
  return spans;
}

/** Each unit and how titles spell it. "hz" covers refresh rates, the parse prompt's "144hz". */
const SPEC_UNITS = {
  w: "w(?:atts?)?",
  mah: "mah",
  gb: "gb",
  tb: "tb",
  inch: "inch(?:es)?",
  mm: "mm",
  hz: "hz",
} as const;

type SpecUnit = keyof typeof SPEC_UNITS;

export interface Spec {
  value: number;
  unit: SpecUnit;
}

/** Storage in GB, so "512gb" is met by a title that says "1TB". Sellers count 1 TB as 1000 GB. */
const GB_PER: Partial<Record<SpecUnit, number>> = { gb: 1, tb: 1000 };

const inBase = (value: number, unit: SpecUnit) => value * (GB_PER[unit] ?? 1);
const sameQuantity = (unit: SpecUnit) =>
  unit in GB_PER ? (Object.keys(GB_PER) as SpecUnit[]) : [unit];

/** "65w", "10000 mah", "27-inch" → a numeric spec; anything else → null. */
export function parseSpec(phrase: string): Spec | null {
  const m = /^(\d+(?:\.\d+)?)[\s-]?(w|watts?|mah|gb|tb|inch(?:es)?|mm|hz)$/.exec(
    phrase.trim().toLowerCase(),
  );
  if (!m) return null;
  const unit = m[2].startsWith("w") ? "w" : m[2].startsWith("inch") ? "inch" : m[2];
  return { value: Number(m[1]), unit: unit as SpecUnit };
}

/**
 * A spec means "at least": "65w" accepts a title that states 67W or 100W. Sellers glue units to
 * other text ("PD60W"), so the number needs no word boundary in front.
 */
export function titleMeetsSpec(title: string, spec: Spec): boolean {
  const text = title.toLowerCase().replace(/(\d),(\d{3})/g, "$1$2");
  const need = inBase(spec.value, spec.unit);
  return sameQuantity(spec.unit).some((unit) => {
    const re = new RegExp(`(\\d+(?:\\.\\d+)?)[\\s-]?(?:${SPEC_UNITS[unit]})(?![a-z])`, "g");
    return [...text.matchAll(re)].some((m) => inBase(Number(m[1]), unit) >= need);
  });
}

/** Canonical form of a phrase, for comparing phrases and building cache keys. */
export function normalizePhrase(phrase: string): string {
  const spec = parseSpec(phrase);
  return spec ? `${spec.value}${spec.unit}` : stems(phrase).join(" ");
}

let groupIndex: Map<string, readonly string[]> | undefined;

function synonymsOf(phrase: string): readonly string[] {
  groupIndex ??= new Map(
    SYNONYM_GROUPS.flatMap((group) => group.map((m) => [normalizePhrase(m), group] as const)),
  );
  return groupIndex.get(normalizePhrase(phrase)) ?? [];
}

/** The requirement's own phrases plus the code synonyms of any of them. */
export function requirementPhrases(req: Requirement): string[] {
  const own = [req.en, ...req.alt];
  return [...new Set([...own, ...own.flatMap(synonymsOf)])];
}

function phraseInTitle(title: string, titleStems: string[], phrase: string): boolean {
  const spec = parseSpec(phrase);
  if (spec) return titleMeetsSpec(title, spec);
  return phraseSpans(titleStems, phrase).length > 0;
}

export function phraseMatches(title: string, phrase: string): boolean {
  return phraseInTitle(title, stems(title), phrase);
}

/** True when the title states the requirement in any of its phrasings. */
export function requirementMatches(title: string, req: Requirement): boolean {
  const titleStems = stems(title);
  return requirementPhrases(req).some((phrase) => phraseInTitle(title, titleStems, phrase));
}
