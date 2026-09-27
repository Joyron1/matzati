import { describe, expect, it } from "vitest";
import { hasEnded, hasStarted, isCurrent, isoToIsraelLocal, israelLocalToIso } from "./time";

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
