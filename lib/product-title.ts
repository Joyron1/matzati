// Which title a product shows, and in which direction. A stored product's AliExpress title
// (products.data.title) is English when a search, /p or an admin import saved it, but AliExpress's
// own Hebrew machine translation when a hot list saved it (lib/hot, target_language HE). So the
// language is read from the title's letters, never from whether we wrote a Hebrew title for it.

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
 * `titleHe` is our Hebrew title, or the AliExpress title again when we have none (toResultProduct);
 * `titleEn` is the AliExpress title as stored.
 */
export function productTitleView(titleHe: string, titleEn: string): ProductTitleView {
  const ours = titleHe !== titleEn;
  return {
    text: titleHe,
    ltr: !hasHebrew(titleHe),
    original: ours && !hasHebrew(titleEn) ? titleEn : null,
    machineTranslated: !ours && hasHebrew(titleEn),
  };
}
