// When and where the waiting scene's product cards move (wait-scene.tsx; the keyframes are in
// search-wait.module.css), for a page of `slots` results (RESULTS_PER_PAGE). The stream starts
// once the query is understood (the "scan" step); the first checked card lands in the featured slot
// exactly as the schedule makes filtering current (FILTER_AFTER_MS), and one more every gap after
// it fills the next slot, each slot filling as its card lands. The last slot is never filled: every
// later checked card heads for it, and it shows a pending draft once the lines are being written,
// until the real page arrives. No slot ever shows a winner. Times are seconds from the start of the
// stream; places are the SVG's user units (640x360).
import { FILTER_AFTER_MS } from "./schedule";

/** Share of its cycle at which a card reaches the magnifier, leaves it, and lands in a slot. */
export const CARD_AT_LENS = 0.36;
export const CARD_LEAVES = 0.46;
export const CARD_LANDS = 0.57;
/** A card rides the belt from x=700 to x=420 (user units) in this share of its cycle. */
const BELT_SHARE = 0.3;
const BELT_RUN = 280;
/** The belt's ticks are this far apart; one loop of their animation moves them this far. */
const TICK_SPACING = 40;
/** Cards in one cycle of the stream; one of them reaches the magnifier every gap. */
export const CARDS_PER_CYCLE = 6;
/** Seconds between two cards under the magnifier, and between two slots filling. */
export const PICK_GAP_S = 1.5;
/** The magnifier's swoop from the query down to the belt (the .lensX and .lensY transitions). */
export const LENS_SWOOP_S = 1.1;
/** The glint crosses the glass this long after a card arrives under it. */
const GLINT_LAG_S = 0.1;

export interface SceneCard {
  /** The slot (0: featured) a checked card flies to; null for a card that fails the filter. */
  slot: number | null;
  /** Animation delay from the start of the stream (negative: already on its way). */
  delayS: number;
  /** The picks run once; the stream behind them loops. */
  once: boolean;
}

export interface SceneTiming {
  cycleS: number;
  gapS: number;
  /** One loop of the belt's ticks, so the belt moves exactly as fast as a card riding it. */
  beltTickS: number;
  /** The first glint over the glass; one more every gap. */
  glintAtS: number;
  /** When each slot but the last fills: as its card lands. */
  fillAtS: number[];
  cards: SceneCard[];
}

/** At least a featured slot and one more. */
const slotCount = (slots: number) => Math.max(2, Math.trunc(slots) || 2);

export function sceneTiming(slots: number): SceneTiming {
  const count = slotCount(slots);
  const gap = PICK_GAP_S;
  const cycle = gap * CARDS_PER_CYCLE;
  const firstFill = FILTER_AFTER_MS / 1000;
  const fillAtS = Array.from({ length: count - 1 }, (_, i) => firstFill + i * gap);
  const picks: SceneCard[] = fillAtS.map((at, i) => ({
    slot: i,
    delayS: at - CARD_LANDS * cycle,
    once: true,
  }));
  const lastPick = picks[picks.length - 1].delayS;
  // Behind the picks, one cycle of cards that loops; every third passes and heads for the last slot.
  const loop: SceneCard[] = Array.from({ length: CARDS_PER_CYCLE }, (_, i) => ({
    slot: (i + 1) % 3 === 0 ? count - 1 : null,
    delayS: lastPick + (i + 1) * gap,
    once: false,
  }));
  return {
    cycleS: cycle,
    gapS: gap,
    beltTickS: (TICK_SPACING * BELT_SHARE * cycle) / BELT_RUN,
    glintAtS: picks[0].delayS + CARD_AT_LENS * cycle + GLINT_LAG_S,
    fillAtS,
    cards: [...picks, ...loop],
  };
}

export interface SlotBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The results shelf: the featured slot at the start (right), the others in a column or two. */
const FEATURED: SlotBox = { x: 150, y: 26, w: 110, h: 150 };
const REST: SlotBox = { x: 26, y: 26, w: 114, h: 150 };
const GAP_X = 8;
const GAP_Y = 10;

/**
 * Where each result slot is drawn, laid out like the results page: the featured one, then the
 * others in one column (up to 2) or two, filled from the start (right) edge, row by row.
 */
export function slotBoxes(slots: number): SlotBox[] {
  const rest = slotCount(slots) - 1;
  const cols = rest <= 2 ? 1 : 2;
  const rows = Math.ceil(rest / cols);
  const w = (REST.w - GAP_X * (cols - 1)) / cols;
  const h = (REST.h - GAP_Y * (rows - 1)) / rows;
  const boxes = Array.from({ length: rest }, (_, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    return {
      x: REST.x + (cols - 1 - col) * (w + GAP_X),
      y: REST.y + row * (h + GAP_Y),
      w,
      h,
    };
  });
  return [FEATURED, ...boxes];
}

export const slotCenter = (b: SlotBox) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
