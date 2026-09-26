import { describe, expect, it } from "vitest";
import {
  formatCount,
  formatIls,
  formatPct,
  formatShortDate,
  timeUntil,
  whatsappShareUrl,
} from "./format";

describe("formatIls", () => {
  it("marks converted prices as approximate", () => {
    expect(formatIls(78.4, true)).toBe("≈₪78");
  });
  it("leaves native ILS prices exact", () => {
    expect(formatIls(78.6, false)).toBe("₪79");
  });
  it("groups thousands", () => {
    expect(formatIls(1249, true)).toBe("≈₪1,249");
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

describe("whatsappShareUrl", () => {
  it("encodes text and our page URL", () => {
    const url = whatsappShareUrl("מצאתי את זה", "https://example.com/p/1");
    expect(url.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(url.split("text=")[1])).toBe("מצאתי את זה\nhttps://example.com/p/1");
  });
});
