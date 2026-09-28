import { describe, expect, it } from "vitest";
import { isCronAuthorized } from "./cron-auth";

// A made-up value for the test only; never a real secret.
const SECRET = "test-cron-secret-0123456789";

describe("isCronAuthorized", () => {
  it("accepts exactly Vercel's Authorization header", () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
    expect(isCronAuthorized(`  Bearer ${SECRET} `, ` ${SECRET}\n`)).toBe(true);
  });

  it("refuses anything else", () => {
    expect(isCronAuthorized(null, SECRET)).toBe(false);
    expect(isCronAuthorized("", SECRET)).toBe(false);
    expect(isCronAuthorized(SECRET, SECRET)).toBe(false);
    expect(isCronAuthorized(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(isCronAuthorized(`Bearer ${SECRET}x`, SECRET)).toBe(false);
    expect(isCronAuthorized(`Bearer ${SECRET.slice(0, -1)}`, SECRET)).toBe(false);
  });

  it("refuses everyone while CRON_SECRET is not set", () => {
    expect(isCronAuthorized("Bearer ", undefined)).toBe(false);
    expect(isCronAuthorized("Bearer ", "")).toBe(false);
    expect(isCronAuthorized("Bearer undefined", undefined)).toBe(false);
    expect(isCronAuthorized("Bearer    ", "   ")).toBe(false);
  });
});
