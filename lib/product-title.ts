// Which title a product shows, and in which direction. A stored product's AliExpress title
// (products.data.title) is English when a search, /p or an admin import saved it, but AliExpress's
// own Hebrew machine translation when a hot list saved it (lib/hot, target_language HE). So the
// language is read from the title's letters, never from whether we wrote a Hebrew title for it.
import { fixTransliterations } from "./transliterations";

/** Any letter or mark of the Hebrew block (U+0590 to U+05FF). */
const HEBREW = /[֐-׿]/;

export function hasHebrew(text: string): boolean {
  return HEBREW.test(text);
}

export interface ProductTitleView {
  /** The heading text. */
  text: string;
  /** No Hebrew at all: shown left to right (in a bdi). */
  ltr: boolean;
  /** AliExpress's English title under the heading ("השם באלי אקספרס"), or null. */
  original: string | null;
  /** The heading is AliExpress's Hebrew machine translation, not a title we wrote. */
  machineTranslated: boolean;
}

/**
 * AliExpress's Hebrew machine translation of a title (hot lists) as we show it: the known English
 * loan words it writes in Hebrew letters replaced (lib/transliterations.ts, owner decision
 * 2026-09-28), and nothing else. Its English original is unknown, so a spelling that also means
 * something else is left alone. The page still says the title is machine-translated.
 */
export function hotTitle(title: string): string {
  return fixTransliterations(title);
}

/**
 * `titleHe` is our Hebrew title, or the AliExpress title again when we have none (toResultProduct);
 * `titleEn` is the AliExpress title as stored.
 */
export function productTitleView(titleHe: string, titleEn: string): ProductTitleView {
  const ours = titleHe !== titleEn;
  const machineTranslated = !ours && hasHebrew(titleEn);
  const text = machineTranslated ? hotTitle(titleHe) : titleHe;
  return {
    text,
    ltr: !hasHebrew(text),
    original: ours && !hasHebrew(titleEn) ? titleEn : null,
    machineTranslated,
  };
}
