import { describe, expect, it } from "vitest";
import {
  CARDS_PER_CYCLE,
  CARD_AT_LENS,
  CARD_LANDS,
  CARD_LEAVES,
  LENS_SWOOP_S,
  sceneTiming,
} from "./scene-timing";
import { WAIT_STEPS, type WaitStepId } from "./schedule";

const t = sceneTiming();
/** Seconds from the start of the stream (the "scan" step) to the start of step `id`. */
const fromStream = (id: WaitStepId) => {
  const at = (s: WaitStepId) => (WAIT_STEPS.find((w) => w.id === s)?.startsAtMs ?? 0) / 1000;
  return at(id) - at("scan");
};
/** Every time from the start of the stream at which the card with `delay` reaches `share`. */
const times = (delay: number, share: number, once: boolean, until = 60) => {
  const first = delay + share * t.cycleS;
  if (once) return [first];
  const out: number[] = [];
  for (let s = first; s <= until; s += t.cycleS) out.push(s);
  return out;
};

describe("sceneTiming", () => {
  it("lands the two picks, and fills their slots, as the schedule reaches filter and rank", () => {
    const [a, b] = t.cards;
    expect(a.slot).toBe("a");
    expect(b.slot).toBe("b");
    expect(a.once && b.once).toBe(true);
    expect(a.delayS + CARD_LANDS * t.cycleS).toBeCloseTo(fromStream("filter"));
    expect(b.delayS + CARD_LANDS * t.cycleS).toBeCloseTo(fromStream("rank"));
    expect(t.fillAtS.a).toBeCloseTo(fromStream("filter"));
    expect(t.fillAtS.b).toBeCloseTo(fromStream("rank"));
  });

  it("brings the first card under the magnifier only after it has swooped down", () => {
    const first = Math.min(...t.cards.map((c) => c.delayS + CARD_AT_LENS * t.cycleS));
    expect(first).toBeGreaterThanOrEqual(LENS_SWOOP_S);
    expect(t.glintAtS).toBeGreaterThan(first);
    expect(t.glintAtS).toBeLessThan(first + (CARD_LEAVES - CARD_AT_LENS) * t.cycleS);
  });

  it("sends one card under the magnifier per gap, and it is clear before the next arrives", () => {
    const arrivals = t.cards
      .flatMap((c) => times(c.delayS, CARD_AT_LENS, c.once))
      .filter((s) => s <= 40)
      .sort((x, y) => x - y);
    for (let i = 1; i < arrivals.length; i++) {
      expect(arrivals[i] - arrivals[i - 1]).toBeCloseTo(t.gapS);
    }
    expect((CARD_LEAVES - CARD_AT_LENS) * t.cycleS).toBeLessThan(t.gapS);
    expect(t.cycleS).toBeCloseTo(t.gapS * CARDS_PER_CYCLE);
  });

  it("never sends a check into a filled slot; later checks go to the third, shown from prepare on", () => {
    const later = t.cards.slice(2);
    expect(later.every((c) => !c.once && (c.slot === null || c.slot === "c"))).toBe(true);
    expect(later.some((c) => c.slot === "c")).toBe(true);
    expect(later.some((c) => c.slot === null)).toBe(true);
    for (const c of later.filter((x) => x.slot === "c")) {
      expect(c.delayS + CARD_LANDS * t.cycleS).toBeGreaterThanOrEqual(fromStream("prepare"));
    }
  });

  it("moves the belt as fast as a card riding it", () => {
    // Cards ride 280 user units in 30% of a cycle; the ticks move 40 units per loop.
    expect(40 / t.beltTickS).toBeCloseTo(280 / (0.3 * t.cycleS));
  });
});
