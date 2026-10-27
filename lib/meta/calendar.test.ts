import { describe, expect, it } from "vitest";
import {
  dayKeyOf,
  dayLabel,
  monthCells,
  monthOf,
  parseDay,
  parseMonth,
  shiftMonth,
} from "./calendar";

describe("meta calendar", () => {
  it("lays a month out in whole weeks from Sunday", () => {
    // 1.10.2026 is a Thursday: four empty cells first.
    const cells = monthCells({ year: 2026, month: 10 });
    expect(cells.length % 7).toBe(0);
    expect(cells.slice(0, 5)).toEqual([null, null, null, null, "2026-10-01"]);
    expect(cells.filter(Boolean)).toHaveLength(31);
    // 31.10 is a Saturday: the fifth week ends with it.
    expect(cells).toHaveLength(35);
    expect(cells.at(-1)).toBe("2026-10-31");
    // November starts on Sunday and ends on Monday: trailing empty cells.
    expect(monthCells({ year: 2026, month: 11 }).at(-1)).toBeNull();
    // February 2026 starts on Sunday and fills exactly four weeks.
    expect(monthCells({ year: 2026, month: 2 })).toHaveLength(28);
  });

  it("reads the Israel day and month of an instant", () => {
    // 22:30 UTC on 31.10 is already 1.11 in Israel (UTC+2).
    const at = new Date("2026-10-31T22:30:00Z");
    expect(dayKeyOf(at)).toBe("2026-11-01");
    expect(monthOf(at)).toEqual({ year: 2026, month: 11 });
  });

  it("parses only real months and days", () => {
    expect(parseMonth("2026-10")).toEqual({ year: 2026, month: 10 });
    expect(parseMonth("2026-13")).toBeNull();
    expect(parseMonth("x")).toBeNull();
    expect(parseDay("2026-02-28")).toBe("2026-02-28");
    expect(parseDay("2026-02-29")).toBeNull();
    expect(parseDay("2026-11-31")).toBeNull();
  });

  it("moves across years", () => {
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });

  it("names a day", () => {
    expect(dayLabel("2026-10-29")).toBe("יום חמישי 29.10");
  });
});
