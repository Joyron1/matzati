import { describe, expect, it } from "vitest";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import {
  CARDS_PER_CYCLE,
  CARD_AT_LENS,
  CARD_LANDS,
  CARD_LEAVES,
  LENS_SWOOP_S,
  sceneTiming,
  slotBoxes,
} from "./scene-timing";
import { FILTER_AFTER_MS } from "./schedule";

/** Every time from the start of the stream at which the card with `delay` reaches `share`. */
const times = (cycle: number, delay: number, share: number, once: boolean, until = 60) => {
  const first = delay + share * cycle;
  if (once) return [first];
  const out: number[] = [];
  for (let s = first; s <= until; s += cycle) out.push(s);
  return out;
};

describe.each([3, 5, RESULTS_PER_PAGE])("sceneTiming for a page of %i", (slots) => {
  const t = sceneTiming(slots);

  it("lands one pick per slot but the last, the first as filtering becomes current", () => {
    const picks = t.cards.filter((c) => c.once);
    expect(picks.map((c) => c.slot)).toEqual(Array.from({ length: slots - 1 }, (_, i) => i));
    expect(picks[0].delayS + CARD_LANDS * t.cycleS).toBeCloseTo(FILTER_AFTER_MS / 1000);
    picks.forEach((c, i) => expect(t.fillAtS[i]).toBeCloseTo(c.delayS + CARD_LANDS * t.cycleS));
  });

  it("brings the first card under the magnifier only after it has swooped down", () => {
    const first = Math.min(...t.cards.map((c) => c.delayS + CARD_AT_LENS * t.cycleS));
    expect(first).toBeGreaterThanOrEqual(LENS_SWOOP_S);
    expect(t.glintAtS).toBeGreaterThan(first);
    expect(t.glintAtS).toBeLessThan(first + (CARD_LEAVES - CARD_AT_LENS) * t.cycleS);
  });

  it("sends one card under the magnifier per gap, and it is clear before the next arrives", () => {
    const arrivals = t.cards
      .flatMap((c) => times(t.cycleS, c.delayS, CARD_AT_LENS, c.once))
      .filter((s) => s <= 40)
      .sort((x, y) => x - y);
    for (let i = 1; i < arrivals.length; i++) {
      expect(arrivals[i] - arrivals[i - 1]).toBeCloseTo(t.gapS);
    }
    expect((CARD_LEAVES - CARD_AT_LENS) * t.cycleS).toBeLessThan(t.gapS);
    expect(t.cycleS).toBeCloseTo(t.gapS * CARDS_PER_CYCLE);
  });

  it("never sends a check into a filled slot: later checks go to the last one, after the picks", () => {
    const later = t.cards.filter((c) => !c.once);
    expect(later.every((c) => c.slot === null || c.slot === slots - 1)).toBe(true);
    expect(later.some((c) => c.slot === slots - 1)).toBe(true);
    expect(later.some((c) => c.slot === null)).toBe(true);
    const lastFill = Math.max(...t.fillAtS);
    for (const c of later.filter((x) => x.slot !== null)) {
      expect(c.delayS + CARD_LANDS * t.cycleS).toBeGreaterThan(lastFill);
    }
  });

  it("moves the belt as fast as a card riding it", () => {
    // Cards ride 280 user units in 30% of a cycle; the ticks move 40 units per loop.
    expect(40 / t.beltTickS).toBeCloseTo(280 / (0.3 * t.cycleS));
  });
});

describe("slotBoxes", () => {
  const overlap = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

  it.each([2, 3, 4, 5, 6])("draws %i slots on the shelf, none overlapping", (slots) => {
    const boxes = slotBoxes(slots);
    expect(boxes).toHaveLength(slots);
    for (const b of boxes) {
      expect(b.x).toBeGreaterThanOrEqual(26);
      expect(b.x + b.w).toBeLessThanOrEqual(260.001);
      expect(b.y).toBeGreaterThanOrEqual(26);
      expect(b.y + b.h).toBeLessThanOrEqual(176.001);
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j])).toBe(false);
    }
  });

  it("keeps the page of three as it was: two stacked beside the featured slot", () => {
    expect(slotBoxes(3)).toEqual([
      { x: 150, y: 26, w: 110, h: 150 },
      { x: 26, y: 26, w: 114, h: 70 },
      { x: 26, y: 106, w: 114, h: 70 },
    ]);
  });

  it("fills a page of five from the start (right) edge, row by row", () => {
    const [, second, third] = slotBoxes(5);
    expect(second.x).toBeGreaterThan(third.x);
    expect(second.y).toBe(third.y);
  });
});
