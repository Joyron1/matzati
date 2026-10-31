import { describe, expect, it } from "vitest";
import {
  addDays,
  orderWindows,
  parseRange,
  rangeDays,
  rangeHref,
  rangeInstants,
  rangePresets,
} from "./range";

// 2026-10-29 08:00 in Israel (UTC+2 after the clock change on 2026-10-25).
const NOW = new Date("2026-10-29T06:00:00Z");

describe("parseRange", () => {
  it("defaults to the last 30 days, today included", () => {
    expect(parseRange({}, NOW)).toEqual({ from: "2026-09-30", to: "2026-10-29" });
  });

  it("reads the address, swaps reversed ends and keeps the future out", () => {
    expect(parseRange({ from: "2026-10-01", to: "2026-10-10" }, NOW)).toEqual({
      from: "2026-10-01",
      to: "2026-10-10",
    });
    expect(parseRange({ from: "2026-10-10", to: "2026-10-01" }, NOW)).toEqual({
      from: "2026-10-01",
      to: "2026-10-10",
    });
    expect(parseRange({ from: "2026-10-20", to: "2027-01-01" }, NOW)).toEqual({
      from: "2026-10-20",
      to: "2026-10-29",
    });
  });

  it("ignores broken dates and caps the range at 90 days", () => {
    expect(parseRange({ from: "2026-02-30", to: "x" }, NOW)).toEqual({
      from: "2026-09-30",
      to: "2026-10-29",
    });
    const long = parseRange({ from: "2026-01-01", to: "2026-10-29" }, NOW);
    expect(long).toEqual({ from: "2026-08-01", to: "2026-10-29" });
    expect(rangeDays(long)).toBe(90);
  });

  it("takes the first of repeated params", () => {
    expect(parseRange({ from: ["2026-10-05", "2026-10-06"], to: "2026-10-07" }, NOW).from).toBe(
      "2026-10-05",
    );
  });
});

describe("rangeInstants and orderWindows", () => {
  it("covers Israel midnight to the next midnight, or now", () => {
    expect(rangeInstants({ from: "2026-10-01", to: "2026-10-02" }, NOW)).toEqual({
      start: new Date("2026-09-30T21:00:00Z"),
      end: new Date("2026-10-02T21:00:00Z"),
    });
    expect(rangeInstants({ from: "2026-10-29", to: "2026-10-29" }, NOW).end).toEqual(NOW);
  });

  it("cuts a range into windows of 30 days at most", () => {
    const start = new Date("2026-08-01T00:00:00Z");
    const end = new Date("2026-10-15T00:00:00Z");
    const w = orderWindows(start, end);
    expect(w).toHaveLength(3);
    expect(w[0].start).toEqual(start);
    expect(w[2].end).toEqual(end);
    expect(w[1].start).toEqual(w[0].end);
  });
});

describe("presets", () => {
  it("has the months right", () => {
    const byLabel = Object.fromEntries(rangePresets(NOW).map((p) => [p.label, p.range]));
    expect(byLabel["החודש"]).toEqual({ from: "2026-10-01", to: "2026-10-29" });
    expect(byLabel["החודש הקודם"]).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(byLabel["7 ימים"]).toEqual({ from: "2026-10-23", to: "2026-10-29" });
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(rangeHref(byLabel["היום"])).toBe("/admin/revenue?from=2026-10-29&to=2026-10-29");
  });
});
