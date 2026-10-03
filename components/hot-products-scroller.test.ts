// The home carousel's timing (owner request 2026-10-03): /accessibility states these numbers.
import { describe, expect, it } from "vitest";
import { AUTO_ADVANCE_MS, RESUME_AFTER_MS } from "./hot-products-scroller";

describe("HotProductsScroller timing", () => {
  it("moves on every 3 seconds, and waits longer after an interaction", () => {
    expect(AUTO_ADVANCE_MS).toBe(3_000);
    expect(RESUME_AFTER_MS).toBe(5_000);
    expect(RESUME_AFTER_MS).toBeGreaterThanOrEqual(AUTO_ADVANCE_MS);
  });
});
