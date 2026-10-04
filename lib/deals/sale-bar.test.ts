import { describe, expect, it } from "vitest";
import {
  countdown,
  countdownText,
  pickBarSale,
  SALE_BAR_WINDOW_DAYS,
  type BarSale,
} from "./sale-bar";

const DAY = 86_400_000;
const NOW = Date.parse("2026-10-04T12:00:00Z");
const sale = (id: string, startDays: number, endDays: number | null): BarSale => ({
  id,
  title: `מבצע ${id}`,
  starts_at: new Date(NOW + startDays * DAY).toISOString(),
  ends_at: endDays === null ? null : new Date(NOW + endDays * DAY).toISOString(),
});

describe("pickBarSale", () => {
  it("shows the soonest sale that starts within the window", () => {
    const sales = [sale("b", 47, 55), sale("a", 38, 46)];
    expect(pickBarSale(sales, NOW)).toEqual({ sale: sales[1], running: false });
  });

  it("shows nothing when the next sale starts after the window, or every sale ended", () => {
    expect(pickBarSale([sale("far", SALE_BAR_WINDOW_DAYS + 1, 60)], NOW)).toBeNull();
    expect(pickBarSale([sale("past", -10, -1)], NOW)).toBeNull();
    expect(pickBarSale([], NOW)).toBeNull();
  });

  it("prefers a running sale, with or without an end date", () => {
    const sales = [sale("next", 3, 10), sale("now", -1, 2)];
    expect(pickBarSale(sales, NOW)).toEqual({ sale: sales[1], running: true });
    const open = sale("open", -1, null);
    expect(pickBarSale([open], NOW)).toEqual({ sale: open, running: true });
  });

  it("drops a sale the moment it ends", () => {
    const s = sale("x", -5, 1);
    expect(pickBarSale([s], NOW + DAY)).toBeNull();
    expect(pickBarSale([s], NOW + DAY - 1000)?.running).toBe(true);
  });
});

describe("countdown", () => {
  it("splits the time left into days, hours, minutes and seconds", () => {
    const target = NOW + 2 * DAY + 3 * 3_600_000 + 4 * 60_000 + 5_000;
    expect(countdown(target, NOW)).toEqual({ days: 2, hours: 3, minutes: 4, seconds: 5 });
    expect(countdown(NOW - 1000, NOW)).toEqual({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  });

  it("says it in Hebrew words without the seconds", () => {
    expect(countdownText({ days: 38, hours: 4, minutes: 20, seconds: 9 })).toBe(
      "38 ימים, 4 שעות ו־20 דקות",
    );
    expect(countdownText({ days: 1, hours: 0, minutes: 1, seconds: 0 })).toBe("יום אחד ודקה אחת");
    expect(countdownText({ days: 0, hours: 0, minutes: 5, seconds: 0 })).toBe("5 דקות");
  });
});
