import { describe, expect, it } from "vitest";
import { promoCodeValid } from "./promo";

const NOW = Date.parse("2026-10-04T12:00:00Z");
const code = (starts_at: string | null, ends_at: string | null) => ({
  code: "X",
  starts_at,
  ends_at,
});

describe("promoCodeValid", () => {
  it("is valid between its own dates, an open end included", () => {
    expect(promoCodeValid(code("2026-10-01T00:00:00Z", "2026-10-05T00:00:00Z"), NOW)).toBe(true);
    expect(promoCodeValid(code(null, null), NOW)).toBe(true);
  });

  it("is not valid before it starts, once it ended, or without a code", () => {
    expect(promoCodeValid(code("2026-10-05T00:00:00Z", null), NOW)).toBe(false);
    expect(promoCodeValid(code(null, "2026-10-04T12:00:00Z"), NOW)).toBe(false);
    expect(promoCodeValid(undefined, NOW)).toBe(false);
  });
});
