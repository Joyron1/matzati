import { describe, expect, it } from "vitest";
import { STALE_RESULTS_HOURS } from "@/lib/config/site";
import { staleFetchedAt } from "./freshness";

const FETCHED = "2026-09-27T10:00:00.000Z";
const at = (hours: number) => new Date(Date.parse(FETCHED) + hours * 3_600_000);

describe("staleFetchedAt", () => {
  it("returns the fetch time only once the results are older than STALE_RESULTS_HOURS", () => {
    expect(STALE_RESULTS_HOURS).toBe(24);
    expect(staleFetchedAt(FETCHED, at(0))).toBeNull();
    expect(staleFetchedAt(FETCHED, at(24))).toBeNull();
    expect(staleFetchedAt(FETCHED, at(24 + 1 / 60))).toBe(FETCHED);
    expect(staleFetchedAt(FETCHED, at(13 * 24))).toBe(FETCHED);
  });

  it("shows nothing for a missing, invalid or future time", () => {
    expect(staleFetchedAt(undefined, at(48))).toBeNull();
    expect(staleFetchedAt("", at(48))).toBeNull();
    expect(staleFetchedAt("not a date", at(48))).toBeNull();
    expect(staleFetchedAt(FETCHED, at(-48))).toBeNull();
  });
});
