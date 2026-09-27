import { describe, expect, it } from "vitest";
import { buildSalesCalendar, israelDay, saleSpan, shortDay, spanLabel } from "./calendar";

// 2026-09-28 11:00 in Israel (IDT, +03).
const NOW = new Date("2026-09-28T08:00:00.000Z");

const sale = (id: string, starts_at: string | null, ends_at: string | null = null) => ({
  id,
  title: `מבצע ${id}`,
  starts_at,
  ends_at,
});

describe("israelDay and shortDay", () => {
  it("uses the Israel calendar day, not the UTC one", () => {
    expect(israelDay("2026-11-10T22:00:00.000Z")).toBe("2026-11-11");
    expect(israelDay("2026-11-10T21:59:59.000Z")).toBe("2026-11-10");
    expect(israelDay(new Date("2026-07-01T21:00:00.000Z"))).toBe("2026-07-02");
  });

  it("formats a day as the site's short date", () => {
    expect(shortDay("2026-11-11")).toBe("11.11");
    expect(shortDay("2027-01-05")).toBe("5.1");
  });
});

describe("saleSpan", () => {
  it("runs from the start day to the day of the last minute", () => {
    // 11.11 00:00 to 13.11 23:59 Israel time (+02 in November).
    expect(saleSpan(sale("a", "2026-11-10T22:00:00Z", "2026-11-13T21:59:00Z"))).toEqual({
      id: "a",
      title: "מבצע a",
      startDay: "2026-11-11",
      endDay: "2026-11-13",
    });
    // Ending exactly at midnight does not cover the next day.
    expect(saleSpan(sale("b", "2026-11-10T22:00:00Z", "2026-11-12T22:00:00Z"))?.endDay).toBe(
      "2026-11-12",
    );
  });

  it("marks only the start day without an end, and nothing without a start", () => {
    expect(saleSpan(sale("c", "2026-11-27T08:00:00Z"))).toMatchObject({
      startDay: "2026-11-27",
      endDay: "2026-11-27",
    });
    expect(saleSpan(sale("d", "2026-11-27T08:00:00Z", "2026-11-27T08:00:00Z"))?.endDay).toBe(
      "2026-11-27",
    );
    expect(saleSpan(sale("e", null))).toBeNull();
    expect(saleSpan(sale("f", "someday"))).toBeNull();
  });

  it("labels one day or a range", () => {
    expect(spanLabel({ startDay: "2026-11-11", endDay: "2026-11-11" })).toBe("11.11");
    expect(spanLabel({ startDay: "2026-11-11", endDay: "2026-11-13" })).toBe("11.11 עד 13.11");
  });
});

describe("buildSalesCalendar", () => {
  const sales = [
    sale("running", "2026-09-20T07:00:00Z", "2026-09-29T20:59:00Z"),
    sale("singles", "2026-11-10T22:00:00Z", "2026-11-13T21:59:00Z"),
    sale("new-year", "2026-12-30T22:00:00Z", "2027-01-02T21:59:00Z"),
  ];
  const months = buildSalesCalendar(sales, NOW);

  it("covers 12 months from the current Israel month, across the new year", () => {
    expect(months).toHaveLength(12);
    expect(months.map((m) => m.key)).toEqual([
      "2026-09",
      "2026-10",
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
      "2027-03",
      "2027-04",
      "2027-05",
      "2027-06",
      "2027-07",
      "2027-08",
    ]);
    expect(months[2].label).toBe("נובמבר 2026");
  });

  it("lays out Sunday-first weeks padded with null", () => {
    // 1.9.2026 is a Tuesday: two blanks, then 30 days, then blanks to fill the last week.
    const september = months[0];
    expect(september.weeks[0].slice(0, 3).map((d) => d?.day ?? null)).toEqual([null, null, 1]);
    expect(september.weeks.every((w) => w.length === 7)).toBe(true);
    const days = september.weeks.flat().filter((d) => d !== null);
    expect(days).toHaveLength(30);
    expect(days.at(-1)?.key).toBe("2026-09-30");
    // February 2027 starts on a Monday and has 28 days.
    const february = months[5];
    expect(february.weeks[0][0]).toBeNull();
    expect(february.weeks[0][1]?.key).toBe("2027-02-01");
    expect(february.weeks.flat().filter((d) => d !== null)).toHaveLength(28);
  });

  it("marks today, past days and every day of each sale", () => {
    const days = months[0].weeks.flat().filter((d) => d !== null);
    const byKey = (key: string) => days.find((d) => d.key === key);
    expect(byKey("2026-09-28")).toMatchObject({ isToday: true, isPast: false });
    expect(byKey("2026-09-27")).toMatchObject({ isToday: false, isPast: true });
    expect(byKey("2026-09-19")?.sales).toEqual([]);
    expect(byKey("2026-09-20")?.sales).toEqual([{ id: "running", title: "מבצע running" }]);
    expect(byKey("2026-09-29")?.sales.map((s) => s.id)).toEqual(["running"]);
    expect(byKey("2026-09-30")?.sales).toEqual([]);

    const november = months[2].weeks.flat().filter((d) => d !== null);
    expect(november.filter((d) => d.sales.length > 0).map((d) => d.day)).toEqual([11, 12, 13]);
  });

  it("lists a sale under every month it touches", () => {
    expect(months.map((m) => m.sales.map((s) => s.id))).toEqual([
      ["running"],
      [],
      ["singles"],
      ["new-year"],
      ["new-year"],
      [],
      [],
      [],
      [],
      [],
      [],
      [],
    ]);
  });

  it("skips sales without a start", () => {
    const only = buildSalesCalendar([sale("x", null)], NOW, 1);
    expect(only[0].sales).toEqual([]);
  });
});
