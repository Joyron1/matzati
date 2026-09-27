import { describe, expect, it } from "vitest";
import {
  formatCount,
  formatDateTime,
  formatIls,
  formatPct,
  formatShortDate,
  formatWait,
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

describe("whatsappShareUrl", () => {
  it("encodes text and our page URL", () => {
    const url = whatsappShareUrl("מצאתי את זה", "https://example.com/p/1");
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1])).toBe("מצאתי את זה\nhttps://example.com/p/1");
  });
});
