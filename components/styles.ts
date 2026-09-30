// Shared class strings for buttons and surfaces, so sizes and states stay consistent.
const base =
  "inline-flex items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60";

export const btnPrimary = `${base} bg-accent text-on-accent hover:bg-accent-ink`;
export const btnSecondary = `${base} border border-line bg-surface text-ink hover:border-accent hover:text-accent-ink`;
export const btnGold = `${base} bg-gold text-on-gold hover:brightness-95`;

/**
 * A button that is busy but keeps keyboard focus: aria-disabled instead of disabled (a disabled
 * button drops focus to <body>). Its form or click handler must then ignore it while busy.
 */
export const btnBusy = "aria-disabled:cursor-not-allowed aria-disabled:opacity-60";

export const btnLg = "h-14 px-7 text-base";
export const btnMd = "h-12 px-5 text-[15px]";
/**
 * A button of a narrow card (two in a row on a phone): 44px tall at least, its label wrapping
 * instead of overflowing the card (the base keeps a label on one line, so this overrides it).
 */
export const btnSm = "min-h-11 whitespace-normal! px-3 py-2 text-sm leading-snug text-balance";

export const card = "rounded-card border border-line bg-surface";
export const featured = "rounded-composer border border-line bg-surface shadow-soft";
