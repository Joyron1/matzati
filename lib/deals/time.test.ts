import { describe, expect, it } from "vitest";
import { formatShortDate } from "@/lib/format";
import {
  convertLocal,
  formatTimeLeft,
  hasEnded,
  hasStarted,
  isCurrent,
  isoToIsraelLocal,
  isoToZonedLocal,
  israelLocalToIso,
  lastCoveredInstant,
  zonedLocalToIso,
} from "./time";

const NOW = new Date("2026-10-01T09:00:00.000Z");
const window = (starts_at: string | null, ends_at: string | null) => ({ starts_at, ends_at });

describe("deal date windows", () => {
  it("never ends without ends_at, and ends exactly at ends_at", () => {
    expect(hasEnded(window(null, null), NOW)).toBe(false);
    expect(hasEnded(window(null, "2026-10-01T09:00:00.001Z"), NOW)).toBe(false);
    expect(hasEnded(window(null, "2026-10-01T09:00:00.000Z"), NOW)).toBe(true);
    expect(hasEnded(window(null, "2026-09-30T23:59:00+03:00"), NOW)).toBe(true);
  });

  it("starts right away without starts_at, and exactly at starts_at", () => {
    expect(hasStarted(window(null, null), NOW)).toBe(true);
    expect(hasStarted(window("2026-10-01T09:00:00.000Z", null), NOW)).toBe(true);
    expect(hasStarted(window("2026-10-01T12:00:01+03:00", null), NOW)).toBe(false);
  });

  it("is current only between start and end", () => {
    expect(isCurrent(window(null, null), NOW)).toBe(true);
    expect(isCurrent(window("2026-09-01T00:00:00Z", "2026-10-02T00:00:00Z"), NOW)).toBe(true);
    expect(isCurrent(window("2026-11-11T00:00:00+02:00", null), NOW)).toBe(false);
    expect(isCurrent(window("2026-09-01T00:00:00Z", "2026-09-30T00:00:00Z"), NOW)).toBe(false);
  });
});

describe("israelLocalToIso", () => {
  it("reads datetime-local values as Israel time (winter +02, summer +03)", () => {
    expect(israelLocalToIso("2026-11-11T00:00")).toBe("2026-11-10T22:00:00.000Z");
    expect(israelLocalToIso("2026-07-01T12:30")).toBe("2026-07-01T09:30:00.000Z");
    expect(israelLocalToIso("2026-07-01T12:30:15")).toBe("2026-07-01T09:30:15.000Z");
  });

  it("uses the right offset on both sides of the clock changes", () => {
    // Israel moves to summer time on Friday 2026-03-27 at 02:00, back on Sunday 2026-10-25.
    expect(israelLocalToIso("2026-03-27T01:00")).toBe("2026-03-26T23:00:00.000Z");
    expect(israelLocalToIso("2026-03-27T04:00")).toBe("2026-03-27T01:00:00.000Z");
    expect(israelLocalToIso("2026-10-24T12:00")).toBe("2026-10-24T09:00:00.000Z");
    expect(israelLocalToIso("2026-10-25T12:00")).toBe("2026-10-25T10:00:00.000Z");
    // 02:30 does not exist on the spring-forward night; it lands an hour later (03:30 IDT).
    expect(israelLocalToIso("2026-03-27T02:30")).toBe("2026-03-27T00:30:00.000Z");
  });

  it("rejects values that are not a real date and time", () => {
    for (const bad of [
      "",
      "abc",
      "2026-02-30T10:00",
      "2026-11-11",
      "2026-11-11T24:00",
      "2026-13-01T00:00",
      "2026-11-11T10:60",
    ]) {
      expect(israelLocalToIso(bad), bad).toBeNull();
    }
  });
});

describe("isoToIsraelLocal", () => {
  it("formats an instant as an Israel datetime-local value", () => {
    expect(isoToIsraelLocal("2026-11-10T22:00:00.000Z")).toBe("2026-11-11T00:00");
    expect(isoToIsraelLocal("2026-07-01T09:30:00+00:00")).toBe("2026-07-01T12:30");
  });

  it("round-trips with israelLocalToIso", () => {
    for (const local of ["2026-01-05T08:15", "2026-06-30T23:59", "2026-10-25T00:00"]) {
      expect(isoToIsraelLocal(israelLocalToIso(local))).toBe(local);
    }
  });

  it("is empty for no date or a bad one", () => {
    expect(isoToIsraelLocal(null)).toBe("");
    expect(isoToIsraelLocal(undefined)).toBe("");
    expect(isoToIsraelLocal("not a date")).toBe("");
  });
});

const LA = "America/Los_Angeles";
const IL = "Asia/Jerusalem";

describe("zonedLocalToIso", () => {
  it("reads Pacific time as AliExpress announces it, in both input formats", () => {
    expect(zonedLocalToIso("2026-12-31 23:59:59", LA)).toBe("2027-01-01T07:59:59.000Z");
    expect(zonedLocalToIso("2026-12-31T23:59:59", LA)).toBe("2027-01-01T07:59:59.000Z");
    expect(zonedLocalToIso("2026-11-11T00:00", LA)).toBe("2026-11-11T08:00:00.000Z");
    expect(zonedLocalToIso("2026-07-04T12:00", LA)).toBe("2026-07-04T19:00:00.000Z");
  });

  it("reads Israel time like israelLocalToIso", () => {
    expect(zonedLocalToIso("2026-11-11 00:00:00", IL)).toBe("2026-11-10T22:00:00.000Z");
    expect(zonedLocalToIso("2026-07-01T12:30", IL)).toBe("2026-07-01T09:30:00.000Z");
    for (const local of ["2026-03-27T01:00", "2026-03-27T02:30", "2026-10-25T12:00"]) {
      expect(zonedLocalToIso(local, IL), local).toBe(israelLocalToIso(local));
    }
  });

  it("handles the US clock changes (2026-03-08 and 2026-11-01)", () => {
    expect(zonedLocalToIso("2026-03-08T01:59", LA)).toBe("2026-03-08T09:59:00.000Z");
    expect(zonedLocalToIso("2026-03-08T03:00", LA)).toBe("2026-03-08T10:00:00.000Z");
    // 02:30 is skipped on the spring-forward night; it lands an hour later (03:30 PDT).
    expect(zonedLocalToIso("2026-03-08T02:30", LA)).toBe("2026-03-08T10:30:00.000Z");
    // 01:30 happens twice on the fall-back night; the first one (PDT) is meant.
    expect(zonedLocalToIso("2026-11-01T01:30", LA)).toBe("2026-11-01T08:30:00.000Z");
    expect(zonedLocalToIso("2026-11-01T02:00", LA)).toBe("2026-11-01T10:00:00.000Z");
  });

  it("takes the first 01:30 of Israel's fall-back night too", () => {
    expect(zonedLocalToIso("2026-10-25T01:30", IL)).toBe("2026-10-24T22:30:00.000Z");
    expect(zonedLocalToIso("2026-10-25T00:59", IL)).toBe("2026-10-24T21:59:00.000Z");
    expect(zonedLocalToIso("2026-10-25T02:00", IL)).toBe("2026-10-25T00:00:00.000Z");
  });

  it("rejects impossible dates and unknown zones", () => {
    for (const bad of [
      "",
      "2026-02-29 10:00:00",
      "2027-02-29T00:00",
      "2026-04-31T12:00",
      "2026-12-31 24:00:00",
      "2026-12-31 23:59:60",
      "2026-12-31",
      "2026-12-31T23",
      "31/12/2026 23:59",
    ]) {
      expect(zonedLocalToIso(bad, LA), bad).toBeNull();
    }
    expect(zonedLocalToIso("2028-02-29T00:00", LA)).toBe("2028-02-29T08:00:00.000Z");
    expect(zonedLocalToIso("2026-11-11T00:00", "Mars/Olympus")).toBeNull();
    expect(zonedLocalToIso("2026-11-11T00:00", "")).toBeNull();
  });
});

describe("isoToZonedLocal and convertLocal", () => {
  it("formats an instant in any zone", () => {
    expect(isoToZonedLocal("2027-01-01T07:59:59.000Z", LA)).toBe("2026-12-31T23:59");
    expect(isoToZonedLocal("2026-11-10T22:00:00.000Z", IL)).toBe("2026-11-11T00:00");
    expect(isoToZonedLocal("2026-11-10T22:00:00.000Z", "Mars/Olympus")).toBe("");
    expect(isoToZonedLocal(null, LA)).toBe("");
  });

  it("moves a datetime-local value between Pacific and Israel time", () => {
    expect(convertLocal("2026-11-11T00:00", LA, IL)).toBe("2026-11-11T10:00");
    expect(convertLocal("2026-11-11T10:00", IL, LA)).toBe("2026-11-11T00:00");
    // Between the two clock changes the gap is 9 hours, not 10.
    expect(convertLocal("2026-10-28T00:00", LA, IL)).toBe("2026-10-28T09:00");
    expect(convertLocal("2026-02-30T00:00", LA, IL)).toBe("");
    expect(convertLocal("", IL, LA)).toBe("");
  });
});

describe("lastCoveredInstant", () => {
  it("prints an end at Israel midnight as the day before, like the /sales calendar", () => {
    // 12.11 00:00 in Israel: the last day covered is 11.11.
    expect(formatShortDate(lastCoveredInstant("2026-11-11T22:00:00.000Z"))).toBe("11.11");
    expect(formatShortDate(lastCoveredInstant("2026-11-11T22:00:00.500Z"))).toBe("11.11");
    // Summer time: 5.7 00:00 is 21:00Z the day before.
    expect(formatShortDate(lastCoveredInstant("2026-07-04T21:00:00Z"))).toBe("4.7");
  });

  it("leaves any other end time alone", () => {
    expect(lastCoveredInstant("2026-11-12T08:00:00.000Z")).toBe("2026-11-12T08:00:00.000Z");
    expect(lastCoveredInstant("2026-11-11T22:01:00.000Z")).toBe("2026-11-11T22:01:00.000Z");
    expect(lastCoveredInstant("not a date")).toBe("not a date");
  });
});

describe("formatTimeLeft", () => {
  it("uses the two largest units with Hebrew duals and joiners", () => {
    expect(formatTimeLeft({ days: 12, hours: 4, minutes: 30 })).toBe("12 ימים ו־4 שעות");
    expect(formatTimeLeft({ days: 1, hours: 1, minutes: 0 })).toBe("יום ושעה");
    expect(formatTimeLeft({ days: 2, hours: 0, minutes: 5 })).toBe("יומיים");
    expect(formatTimeLeft({ days: 3, hours: 2, minutes: 0 })).toBe("3 ימים ושעתיים");
    expect(formatTimeLeft({ days: 0, hours: 5, minutes: 20 })).toBe("5 שעות ו־20 דקות");
    expect(formatTimeLeft({ days: 0, hours: 1, minutes: 1 })).toBe("שעה ודקה");
    expect(formatTimeLeft({ days: 0, hours: 2, minutes: 0 })).toBe("שעתיים");
    expect(formatTimeLeft({ days: 0, hours: 0, minutes: 2 })).toBe("שתי דקות");
    expect(formatTimeLeft({ days: 0, hours: 0, minutes: 45 })).toBe("45 דקות");
    expect(formatTimeLeft({ days: 0, hours: 0, minutes: 0 })).toBe("פחות מדקה");
  });
});
