// When the waiting scene's product cards move (wait-scene.tsx; the keyframes are in
// search-wait.module.css). Derived from the schedule, so the scene tells the story the steps tell:
// the stream starts with the "scan" step, the first two checked cards land in the featured and the
// second slot exactly as the schedule reaches "filter" and "explain" (each slot fills as its card
// lands), and every later checked card heads for the third slot, which only shows with "prepare"
// and stays pending until the real page arrives. Times are seconds from the start of the stream.
import { WAIT_STEPS, type WaitStepId } from "./schedule";

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
/** The magnifier's swoop from the query down to the belt (the .lensX and .lensY transitions). */
export const LENS_SWOOP_S = 1.1;
/** The glint crosses the glass this long after a card arrives under it. */
const GLINT_LAG_S = 0.1;

export type SceneSlot = "a" | "b" | "c";

export interface SceneCard {
  /** The slot a checked card flies to; null for a card that fails the filter. */
  slot: SceneSlot | null;
  /** Animation delay from the start of the stream (negative: already on its way). */
  delayS: number;
  /** The first two picks run once; the stream behind them loops. */
  once: boolean;
}

export interface SceneTiming {
  cycleS: number;
  gapS: number;
  /** One loop of the belt's ticks, so the belt moves exactly as fast as a card riding it. */
  beltTickS: number;
  /** The first glint over the glass; one more every gap. */
  glintAtS: number;
  /** When the featured and the second slot fill: as their card lands. */
  fillAtS: { a: number; b: number };
  cards: SceneCard[];
}

const startS = (id: WaitStepId) => (WAIT_STEPS.find((s) => s.id === id)?.startsAtMs ?? 0) / 1000;

export function sceneTiming(): SceneTiming {
  const stream = startS("scan");
  const fillA = startS("filter") - stream;
  const fillB = startS("explain") - stream;
  // The two picks are neighbours on the belt, so the gap between cards is the gap between fills.
  const gap = fillB - fillA;
  const cycle = gap * CARDS_PER_CYCLE;
  const pickA = fillA - CARD_LANDS * cycle;
  const pickB = pickA + gap;
  // Behind the picks, one cycle of cards that loops; every third passes and heads for slot C.
  const loop: SceneCard[] = Array.from({ length: CARDS_PER_CYCLE }, (_, i) => ({
    slot: (i + 1) % 3 === 0 ? "c" : null,
    delayS: pickB + (i + 1) * gap,
    once: false,
  }));
  return {
    cycleS: cycle,
    gapS: gap,
    beltTickS: (TICK_SPACING * BELT_SHARE * cycle) / BELT_RUN,
    glintAtS: pickA + CARD_AT_LENS * cycle + GLINT_LAG_S,
    fillAtS: { a: fillA, b: fillB },
    cards: [
      { slot: "a", delayS: pickA, once: true },
      { slot: "b", delayS: pickB, once: true },
      ...loop,
    ],
  };
}
