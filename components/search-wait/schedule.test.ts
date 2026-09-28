import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { FILL_TIER, FILTERS } from "@/lib/ranking/config";
import {
  FILTER_AFTER_MS,
  LAST_STEP,
  NO_SIGNALS,
  PROGRESS_CAP,
  PROGRESS_EASE,
  PROGRESS_EASE_MS,
  REASSURANCE_TEXT,
  SLOWER_AFTER_MS,
  SLOW_AFTER_MS,
  WAIT_STEPS,
  currentStep,
  doneSteps,
  echoQuery,
  nextMarkMs,
  nextTip,
  progressAt,
  progressFloor,
  reassuranceAt,
  stepProgress,
  stepStates,
  tipDurationMs,
  WAIT_ENTER_DELAY_MS,
  type WaitSignals,
} from "./schedule";
import { WAIT_TIPS } from "./tips";

const SECOND = 1_000;

describe("WAIT_ENTER_DELAY_MS", () => {
  it("is the delay of the wait's entrance in the CSS", () => {
    const css = readFileSync("components/search-wait/search-wait.module.css", "utf8");
    const enter =
      /\.enter\s*\{\s*animation:\s*wait-enter\s+[\d.]+s\s+\S+\([^)]*\)\s+([\d.]+)s/.exec(css);
    expect(enter).not.toBeNull();
    expect(Number(enter![1]) * 1_000).toBe(WAIT_ENTER_DELAY_MS);
  });
});

describe("WAIT_STEPS", () => {
  it("names the steps of the search, writing the lines last", () => {
    expect(WAIT_STEPS.map((s) => s.id)).toEqual(["read", "scan", "filter", "rank", "write"]);
    expect(WAIT_STEPS[LAST_STEP].label).toBe("כותבים לכם למה בחרנו");
  });

  it("never states a count, only 'dozens'", () => {
    for (const s of WAIT_STEPS) expect(`${s.label} ${s.detail}`).not.toMatch(/\d{2,}(?!\s*הימים)/);
  });
});

const understood = (at: number): WaitSignals => ({ ...NO_SIGNALS, understoodAtMs: at });
const ranked = (writing: boolean): WaitSignals => ({
  understoodAtMs: 1_500,
  ranked: true,
  writing,
});

describe("stepStates", () => {
  it("reads the query until it is understood, however long that takes", () => {
    for (const t of [0, 2_000, 9_000, 60_000]) {
      expect(stepStates(t, NO_SIGNALS)).toEqual([
        "current",
        "upcoming",
        "upcoming",
        "upcoming",
        "upcoming",
      ]);
    }
  });

  it("marks understanding done with the chips, then scans, then filters on the schedule", () => {
    const s = understood(1_200);
    expect(stepStates(1_200, s)).toEqual(["done", "current", "upcoming", "upcoming", "upcoming"]);
    expect(stepStates(1_200 + FILTER_AFTER_MS - 1, s)[1]).toBe("current");
    // A step the schedule moved past is past, never done: nothing proved it over.
    expect(stepStates(1_200 + FILTER_AFTER_MS, s)).toEqual([
      "done",
      "past",
      "current",
      "upcoming",
      "upcoming",
    ]);
  });

  it("never claims ranking or writing before the products are ranked", () => {
    const s = understood(800);
    for (let t = 0; t <= 120_000; t += 250) {
      const states = stepStates(t, s);
      expect(states[3]).toBe("upcoming");
      expect(states[4]).toBe("upcoming");
    }
  });

  it("marks everything before writing done once ranked, and writes only when lines are due", () => {
    expect(stepStates(4_000, ranked(true))).toEqual(["done", "done", "done", "done", "current"]);
    // Every line was known already: nothing is written, and the page shows at once.
    expect(stepStates(4_000, ranked(false))).toEqual(["done", "done", "done", "done", "upcoming"]);
    expect(currentStep(4_000, ranked(false))).toBe(-1);
    expect(doneSteps(ranked(true))).toBe(LAST_STEP);
  });
});

describe("nextMarkMs", () => {
  it("wakes the screen when filtering becomes current and when a reassurance is due", () => {
    expect(nextMarkMs(0, NO_SIGNALS)).toBe(SLOW_AFTER_MS);
    expect(nextMarkMs(1_000, understood(1_000))).toBe(1_000 + FILTER_AFTER_MS);
    expect(nextMarkMs(1_000 + FILTER_AFTER_MS, understood(1_000))).toBe(SLOW_AFTER_MS);
    expect(nextMarkMs(SLOW_AFTER_MS, ranked(true))).toBe(SLOWER_AFTER_MS);
    expect(nextMarkMs(SLOWER_AFTER_MS, ranked(true))).toBeNull();
  });

  it("holds every moment the steps or the reassurance change, so nothing is missed between them", () => {
    for (const s of [NO_SIGNALS, understood(700), understood(4_000), ranked(true)]) {
      let last = { states: stepStates(0, s).join(), reassurance: reassuranceAt(0) };
      let t = 0;
      while (true) {
        const next = nextMarkMs(t, s);
        // Nothing changes strictly between two marks.
        const until = next ?? 40_000;
        for (let u = t + 50; u < until; u += 50) {
          expect(stepStates(u, s).join()).toBe(last.states);
          expect(reassuranceAt(u)).toBe(last.reassurance);
        }
        if (next === null) break;
        t = next;
        last = { states: stepStates(t, s).join(), reassurance: reassuranceAt(t) };
      }
    }
  });
});

describe("progressFloor", () => {
  it("raises the bar with each real moment, and stays under the cap", () => {
    expect(progressFloor(NO_SIGNALS)).toBe(0);
    expect(progressFloor(understood(500))).toBeGreaterThan(0);
    expect(progressFloor(ranked(true))).toBeGreaterThan(progressFloor(understood(500)));
    expect(progressFloor(ranked(true))).toBeLessThan(PROGRESS_CAP);
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
