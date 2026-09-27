import { describe, expect, it } from "vitest";
import {
  formatCount,
  formatDateTime,
  formatHourAgo,
  formatIls,
  formatPct,
  formatShortDate,
  formatTimeAgo,
  formatWait,
  keepPricesTogether,
  timeUntil,
  whatsappShareUrl,
} from "./format";

describe("formatIls", () => {
  it("marks converted prices as approximate, in whole shekels", () => {
    expect(formatIls(78.4, true)).toBe("≈₪78");
    expect(formatIls(1249.5, true)).toBe("≈₪1,250");
  });
  it("keeps agorot on exact ILS prices", () => {
    expect(formatIls(13.37, false)).toBe("₪13.37");
    expect(formatIls(78.6, false)).toBe("₪78.60");
    expect(formatIls(1249.5, false)).toBe("₪1,249.50");
  });
  it("drops the decimals when an exact price is whole", () => {
    expect(formatIls(100, false)).toBe("₪100");
    expect(formatIls(99.999, false)).toBe("₪100");
  });
});

describe("formatCount", () => {
  it("groups thousands", () => {
    expect(formatCount(3412)).toBe("3,412");
    expect(formatCount(87)).toBe("87");
  });
});

describe("formatPct", () => {
  it("keeps one decimal only when needed", () => {
    expect(formatPct(96.8)).toBe("96.8%");
    expect(formatPct(97)).toBe("97%");
    expect(formatPct(92.46)).toBe("92.5%");
  });
});

describe("formatWait", () => {
  it("rounds up to whole minutes, at least one", () => {
    expect(formatWait(0)).toBe("דקה");
    expect(formatWait(60)).toBe("דקה");
    expect(formatWait(61)).toBe("2 דקות");
    expect(formatWait(59 * 60)).toBe("59 דקות");
  });
  it("switches to hours past an hour", () => {
    expect(formatWait(3600)).toBe("שעה");
    expect(formatWait(3601)).toBe("שעתיים");
    expect(formatWait(5 * 3600)).toBe("5 שעות");
  });
});

describe("timeUntil", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  it("splits the gap into days, hours and minutes", () => {
    expect(timeUntil(new Date("2026-09-28T15:30:59Z"), now)).toEqual({
      days: 2,
      hours: 3,
      minutes: 30,
    });
  });
  it("returns null once the target has passed", () => {
    expect(timeUntil(new Date("2026-09-26T11:59:00Z"), now)).toBeNull();
    expect(timeUntil(now, now)).toBeNull();
  });
});

describe("formatShortDate", () => {
  it("formats day.month in Israel time", () => {
    expect(formatShortDate("2026-11-11T00:00:00+02:00")).toBe("11.11");
    // 23:30 UTC on Oct 5 is already Oct 6 in Israel.
    expect(formatShortDate("2026-10-05T23:30:00Z")).toBe("6.10");
  });
});

describe("formatDateTime", () => {
  it("formats date and 24h time in Israel time", () => {
    expect(formatDateTime("2026-09-27T11:05:00Z")).toBe("27.9 בשעה 14:05");
    expect(formatDateTime("2026-10-05T23:30:00Z")).toBe("6.10 בשעה 02:30");
  });
});

describe("formatTimeAgo", () => {
  // 15:00 in Israel (UTC+3).
  const now = new Date("2026-09-27T12:00:00Z");
  it("says now under a minute, and for a time slightly ahead of the clock", () => {
    expect(formatTimeAgo("2026-09-27T11:59:30Z", now)).toBe("עכשיו");
    expect(formatTimeAgo("2026-09-27T12:00:20Z", now)).toBe("עכשיו");
  });
  it("counts whole minutes under an hour", () => {
    expect(formatTimeAgo("2026-09-27T11:59:00Z", now)).toBe("לפני דקה");
    expect(formatTimeAgo("2026-09-27T11:55:00Z", now)).toBe("לפני 5 דקות");
    expect(formatTimeAgo("2026-09-27T11:00:01Z", now)).toBe("לפני 59 דקות");
  });
  it("counts whole hours under a day", () => {
    expect(formatTimeAgo("2026-09-27T11:00:00Z", now)).toBe("לפני שעה");
    expect(formatTimeAgo("2026-09-27T10:00:00Z", now)).toBe("לפני שעתיים");
    expect(formatTimeAgo("2026-09-27T09:00:00Z", now)).toBe("לפני 3 שעות");
    expect(formatTimeAgo("2026-09-26T12:00:01Z", now)).toBe("לפני 23 שעות");
  });
  it("counts calendar days in Israel past a day", () => {
    expect(formatTimeAgo("2026-09-26T12:00:00Z", now)).toBe("אתמול");
    // 01:30 on the 26th in Israel: 37.5 hours ago, still yesterday.
    expect(formatTimeAgo("2026-09-25T22:30:00Z", now)).toBe("אתמול");
    // 23:00 on the 25th in Israel: 40 hours ago, but two calendar days.
    expect(formatTimeAgo("2026-09-25T20:00:00Z", now)).toBe("לפני יומיים");
    expect(formatTimeAgo("2026-09-23T12:00:00Z", now)).toBe("לפני 4 ימים");
    expect(formatTimeAgo("2026-09-21T12:00:00Z", now)).toBe("לפני 6 ימים");
  });
  it("shows the date from a week back, with the year only when it differs", () => {
    expect(formatTimeAgo("2026-09-20T12:00:00Z", now)).toBe("20.9");
    // 01:30 on Jan 1 in Israel is already this year.
    expect(formatTimeAgo("2025-12-31T23:30:00Z", now)).toBe("1.1");
    expect(formatTimeAgo("2025-12-31T10:00:00Z", now)).toBe("31.12.2025");
  });
  it("returns an empty string for an invalid time", () => {
    expect(formatTimeAgo("not a date", now)).toBe("");
  });
});

describe("formatHourAgo", () => {
  const now = new Date("2026-09-27T12:40:00Z");
  it("says within the last hour instead of counting minutes from a rounded time", () => {
    expect(formatHourAgo("2026-09-27T12:00:00Z", now)).toBe("בשעה האחרונה");
    expect(formatHourAgo("2026-09-27T12:45:00Z", now)).toBe("בשעה האחרונה");
  });
  it("counts hours and days like formatTimeAgo past an hour", () => {
    expect(formatHourAgo("2026-09-27T11:00:00Z", now)).toBe("לפני שעה");
    expect(formatHourAgo("2026-09-27T09:00:00Z", now)).toBe("לפני 3 שעות");
    expect(formatHourAgo("2026-09-26T09:00:00Z", now)).toBe("אתמול");
  });
  it("returns an empty string for an invalid time", () => {
    expect(formatHourAgo("not a date", now)).toBe("");
  });
});

describe("keepPricesTogether", () => {
  it("glues a price to ש״ח and to עד/בין", () => {
    expect(keepPricesTogether("שעון חכם עד 150 ש״ח")).toBe("שעון חכם עד 150 ש״ח");
    expect(keepPricesTogether("בין 50 ל־150 ש״ח")).toBe("בין 50 ל־⁠150 ש״ח");
  });
  it("leaves text without a price, and עד inside a word, alone", () => {
    expect(keepPricesTogether("מארגנים למגירות במטבח")).toBe("מארגנים למגירות במטבח");
    expect(keepPricesTogether("מתנה לילדה בת 8")).toBe("מתנה לילדה בת 8");
    expect(keepPricesTogether("לעד 5")).toBe("לעד 5");
  });
});

describe("whatsappShareUrl", () => {
  it("encodes text and our page URL", () => {
    const url = whatsappShareUrl("מצאתי את זה", "https://example.com/p/1");
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1])).toBe("מצאתי את זה\nhttps://example.com/p/1");
  });
});
