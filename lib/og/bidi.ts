// Hebrew for Open Graph images. The image renderer (next/og, Satori) has no bidi support: it draws
// every string left to right, so Hebrew comes out backwards. ogWords() turns text into the units
// a card lays out in a right-to-left wrapping row (flex-direction row-reverse): each unit is
// already in visual order (a Hebrew word reversed, a run of English words and numbers as it is),
// and the row puts the first unit on the right, so lines also wrap where Hebrew wraps.

const HEBREW = /[֐-׿]/;
/** A strong left-to-right character: Latin letters and digits. */
const LTR = /[A-Za-z0-9]/;
/** A left-to-right run inside a word: "30", "USB-C", "3.5", "95%". */
const TOKENS = /[A-Za-z0-9](?:[A-Za-z0-9.,:%/+-]*[A-Za-z0-9%])?|[^A-Za-z0-9]+/g;
const MIRROR: Record<string, string> = {
  "(": ")",
  ")": "(",
  "[": "]",
  "]": "[",
  "{": "}",
  "}": "{",
  "<": ">",
  ">": "<",
  "«": "»",
  "»": "«",
};

const graphemes = new Intl.Segmenter("he", { granularity: "grapheme" });

/** Right-to-left text in visual order: characters reversed (niqqud stays on its letter), mirrored. */
function reverseRtl(text: string): string {
  return [...graphemes.segment(text)]
    .map((s) => MIRROR[s.segment] ?? s.segment)
    .reverse()
    .join("");
}

/** One word with Hebrew in it: its runs in reverse order, the right-to-left ones reversed. */
function visualWord(word: string): string {
  const tokens = word.match(TOKENS) ?? [word];
  return tokens
    .reverse()
    .map((t) => (LTR.test(t[0]!) ? t : reverseRtl(t)))
    .join("");
}

/**
 * A run of left-to-right words as it shows inside Hebrew: in order, with the punctuation at its
 * logical end ("iPhone 15,") moved to its visual start (",iPhone 15") and the reverse.
 */
function visualLtrRun(run: string): string {
  const match = /^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9%]*)$/.exec(run)!;
  const [, lead, core, trail] = match;
  return `${reverseRtl(trail!)}${core}${reverseRtl(lead!)}`;
}

function isLtrWord(word: string): boolean {
  return !HEBREW.test(word) && LTR.test(word);
}

/**
 * The display units of `text`, in reading order, each in visual order. Lay them out in a row with
 * flex-direction row-reverse and flex-wrap wrap, a word space apart. Text without Hebrew is one
 * unit per word (render it left to right instead: see isRtlText).
 */
export function ogWords(text: string): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (!HEBREW.test(text)) return words;
  const units: string[] = [];
  let run: string[] = [];
  // A Hebrew prefix glued to the run's first word ("ל־" of "ל־iPhone 15"), shown at its right.
  let prefix = "";
  const flush = () => {
    if (run.length) units.push(`${visualLtrRun(run.join(" "))}${prefix}`);
    run = [];
    prefix = "";
  };
  words.forEach((word, i) => {
    if (isLtrWord(word)) {
      run.push(word);
      return;
    }
    flush();
    const tokens = word.match(TOKENS) ?? [word];
    const last = tokens[tokens.length - 1]!;
    const next = words[i + 1];
    if (tokens.length > 1 && LTR.test(last[0]!) && next && isLtrWord(next)) {
      prefix = visualWord(tokens.slice(0, -1).join(""));
      run.push(last);
      return;
    }
    units.push(visualWord(word));
  });
  flush();
  return units;
}

/** Whether a card should lay `text` out right to left (it has Hebrew). */
export function isRtlText(text: string): boolean {
  return HEBREW.test(text);
}

/**
 * `text` cut at a word boundary to at most `max` characters, with "…" when cut. The images cannot
 * clamp lines, so every text is cut to what its box holds.
 */
export function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,.;:־-]+$/, "")}…`;
}
