import { describe, expect, it } from "vitest";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { FILL_TIER, FILTERS } from "@/lib/ranking/config";
import {
  LAST_STEP,
  PROGRESS_CAP,
  PROGRESS_EASE,
  PROGRESS_EASE_MS,
  REASSURANCE_TEXT,
  SCHEDULE_MARKS_MS,
  SLOWER_AFTER_MS,
  SLOW_AFTER_MS,
  WAIT_STEPS,
  echoQuery,
  nextTip,
  progressAt,
  reassuranceAt,
  startOffsetMs,
  stepAt,
  stepProgress,
  stepState,
  tipDurationMs,
} from "./schedule";
import { WAIT_TIPS } from "./tips";

const SECOND = 1_000;

describe("WAIT_STEPS", () => {
  it("starts at zero and moves forward", () => {
    expect(WAIT_STEPS[0].startsAtMs).toBe(0);
    for (let i = 1; i < WAIT_STEPS.length; i++) {
      expect(WAIT_STEPS[i].startsAtMs).toBeGreaterThan(WAIT_STEPS[i - 1].startsAtMs);
    }
  });

  it("reaches the last step inside a typical fresh search (7-15 s)", () => {
    const last = WAIT_STEPS[LAST_STEP].startsAtMs;
    expect(last).toBeGreaterThanOrEqual(7 * SECOND);
    expect(last).toBeLessThanOrEqual(15 * SECOND);
  });

  it("never states a count, only 'dozens'", () => {
    for (const s of WAIT_STEPS) expect(`${s.label} ${s.detail}`).not.toMatch(/\d{2,}(?!\s*הימים)/);
  });
});

describe("stepAt", () => {
  it("follows the schedule", () => {
    expect(stepAt(0)).toBe(0);
    expect(stepAt(1_999)).toBe(0);
    expect(stepAt(2_000)).toBe(1);
    expect(stepAt(5_500)).toBe(2);
    expect(stepAt(7_000)).toBe(3);
    expect(stepAt(10_999)).toBe(3);
    expect(stepAt(11_000)).toBe(4);
  });

  it("stays on the last step however long the wait", () => {
    expect(stepAt(60 * SECOND)).toBe(LAST_STEP);
    expect(stepAt(Number.POSITIVE_INFINITY)).toBe(LAST_STEP);
  });

  it("treats bad input as the start", () => {
    expect(stepAt(-5)).toBe(0);
    expect(stepAt(Number.NaN)).toBe(0);
  });
});

describe("stepState", () => {
  it("marks earlier steps past (never done), the current one current and later ones upcoming", () => {
    expect([0, 1, 2, 3, 4].map((i) => stepState(i, 2))).toEqual([
      "past",
      "past",
      "current",
      "upcoming",
      "upcoming",
    ]);
  });

  it("never moves past the last step, however long the wait", () => {
    for (const elapsed of [0, 5 * SECOND, 11 * SECOND, 30 * SECOND, 10 * 60 * SECOND]) {
      expect(stepState(LAST_STEP, stepAt(elapsed))).not.toBe("past");
    }
    expect(stepState(LAST_STEP, LAST_STEP + 3)).toBe("current");
  });
});

describe("progressAt", () => {
  it("starts empty", () => {
    expect(progressAt(0)).toBe(0);
    expect(progressAt(-1)).toBe(0);
    expect(progressAt(Number.NaN)).toBe(0);
  });

  it("rises all the time and eases toward the cap without reaching it", () => {
    let previous = 0;
    for (let t = 250; t <= 120 * SECOND; t += 250) {
      const p = progressAt(t);
      expect(p).toBeGreaterThan(previous);
      expect(p).toBeLessThan(PROGRESS_CAP);
      previous = p;
    }
    expect(progressAt(Number.MAX_SAFE_INTEGER)).toBeLessThanOrEqual(PROGRESS_CAP);
    expect(PROGRESS_CAP).toBeLessThan(1);
  });

  it("is about half way at 7 s and three quarters at 11 s", () => {
    expect(progressAt(7 * SECOND)).toBeGreaterThan(0.5);
    expect(progressAt(7 * SECOND)).toBeLessThan(0.65);
    expect(progressAt(11 * SECOND)).toBeGreaterThan(0.7);
    expect(progressAt(11 * SECOND)).toBeLessThan(0.8);
  });
});

/** A CSS cubic-bezier(x1, y1, x2, y2) at progress `x` in [0, 1]. */
function cubicBezier([x1, y1, x2, y2]: readonly number[], x: number): number {
  const at = (a: number, b: number, t: number) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (at(x1, x2, mid) < x) lo = mid;
    else hi = mid;
  }
  return at(y1, y2, (lo + hi) / 2);
}

describe("PROGRESS_EASE", () => {
  it("draws progressAt as one CSS animation to the cap, within half a percent", () => {
    const cssBar = (ms: number) =>
      PROGRESS_CAP * cubicBezier(PROGRESS_EASE, Math.min(ms / PROGRESS_EASE_MS, 1));
    for (let t = 0; t <= 60 * SECOND; t += 250) {
      expect(Math.abs(cssBar(t) - progressAt(t))).toBeLessThan(0.005);
      expect(cssBar(t)).toBeLessThanOrEqual(PROGRESS_CAP);
    }
  });

  it("continues from the start offset of a search that reuses the parse", () => {
    const offset = startOffsetMs(true);
    for (let t = 0; t <= 20 * SECOND; t += 250) {
      // The bar is the same animation with a negative delay of the offset.
      const x = Math.min((t + offset) / PROGRESS_EASE_MS, 1);
      expect(
        Math.abs(PROGRESS_CAP * cubicBezier(PROGRESS_EASE, x) - progressAt(t + offset)),
      ).toBeLessThan(0.005);
    }
  });
});

describe("SCHEDULE_MARKS_MS", () => {
  it("holds every moment the step or the reassurance changes, so nothing is missed between them", () => {
    let last = { step: stepAt(0), reassurance: reassuranceAt(0) };
    for (let t = 50; t <= 40 * SECOND; t += 50) {
      const now = { step: stepAt(t), reassurance: reassuranceAt(t) };
      if (now.step !== last.step || now.reassurance !== last.reassurance) {
        expect(SCHEDULE_MARKS_MS).toContain(t);
      }
      last = now;
    }
    expect([...SCHEDULE_MARKS_MS].sort((a, b) => a - b)).toEqual(SCHEDULE_MARKS_MS);
  });
});

describe("tipDurationMs", () => {
  it("gives longer tips more time, 5 to 9 seconds", () => {
    expect(tipDurationMs("קצר")).toBe(5_000);
    expect(tipDurationMs("א".repeat(80))).toBe(6_800);
    expect(tipDurationMs("א".repeat(500))).toBe(9_000);
    for (const tip of WAIT_TIPS) {
      expect(tipDurationMs(tip)).toBeGreaterThanOrEqual(5_000);
      expect(tipDurationMs(tip)).toBeLessThanOrEqual(9_000);
    }
  });
});

describe("stepProgress", () => {
  it("gives one fixed width per step and stops at the cap", () => {
    const widths = WAIT_STEPS.map((_, i) => stepProgress(i));
    for (let i = 1; i < widths.length; i++) expect(widths[i]).toBeGreaterThan(widths[i - 1]);
    expect(stepProgress(LAST_STEP)).toBeCloseTo(PROGRESS_CAP);
    expect(stepProgress(LAST_STEP + 5)).toBeCloseTo(PROGRESS_CAP);
    expect(stepProgress(-2)).toBe(stepProgress(0));
  });
});

describe("reassuranceAt", () => {
  it("says nothing during a typical search, then why, then that we are still on it", () => {
    expect(reassuranceAt(0)).toBe("none");
    expect(reassuranceAt(SLOW_AFTER_MS - 1)).toBe("none");
    expect(reassuranceAt(SLOW_AFTER_MS)).toBe("slow");
    expect(reassuranceAt(SLOWER_AFTER_MS - 1)).toBe("slow");
    expect(reassuranceAt(SLOWER_AFTER_MS)).toBe("slower");
  });

  it("mentions the cache only as recent searches returning at once", () => {
    expect(REASSURANCE_TEXT.slow).toContain("חיפוש שכבר נעשה לאחרונה חוזר מיד");
  });
});

describe("startOffsetMs", () => {
  it("starts a search that reuses the cached parse at the AliExpress step", () => {
    expect(startOffsetMs(false)).toBe(0);
    expect(stepAt(startOffsetMs(true))).toBe(1);
  });
});

describe("nextTip", () => {
  it("wraps around", () => {
    expect(nextTip(0, 5)).toBe(1);
    expect(nextTip(4, 5)).toBe(0);
    expect(nextTip(7, 5)).toBe(3);
    expect(nextTip(0, 0)).toBe(0);
  });
});

describe("echoQuery", () => {
  it("trims, joins spaces and caps at the search's own limit", () => {
    expect(echoQuery("  אוזניות   לריצה \n עד 100 ש״ח ")).toBe("אוזניות לריצה עד 100 ש״ח");
    expect(echoQuery(null)).toBe("");
    expect(echoQuery(undefined)).toBe("");
    expect(echoQuery("א".repeat(500))).toHaveLength(200);
  });
});

describe("WAIT_TIPS", () => {
  it("has 3-5 short tips without emoji", () => {
    expect(WAIT_TIPS.length).toBeGreaterThanOrEqual(3);
    expect(WAIT_TIPS.length).toBeLessThanOrEqual(5);
    for (const tip of WAIT_TIPS) {
      expect(tip.length).toBeLessThanOrEqual(130);
      expect(tip).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it("states the thresholds and page size the search really uses", () => {
    const all = WAIT_TIPS.join(" ");
    for (const t of [FILTERS, FILL_TIER]) {
      expect(all).toContain(`${t.minPositiveFeedbackPct}%`);
      expect(all).toContain(`ו־${t.minUnitsSold} מכירות`);
    }
    expect(all).toContain(`מציגים ${RESULTS_PER_PAGE} מוצרים`);
  });
});
