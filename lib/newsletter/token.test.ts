import { describe, expect, it } from "vitest";
import {
  isUnsubscribeToken,
  newUnsubscribeToken,
  UNSUBSCRIBE_TOKEN_BYTES,
  UNSUBSCRIBE_TOKEN_PATTERN,
  unsubscribePath,
  unsubscribeUrl,
} from "./token";

describe("newUnsubscribeToken", () => {
  it("is 32 random bytes as base64url: 43 URL-safe characters", () => {
    const token = newUnsubscribeToken();
    expect(token).toMatch(UNSUBSCRIBE_TOKEN_PATTERN);
    expect(token).toHaveLength(43);
    expect(Buffer.from(token, "base64url")).toHaveLength(UNSUBSCRIBE_TOKEN_BYTES);
  });

  it("never repeats", () => {
    const tokens = new Set(Array.from({ length: 2000 }, () => newUnsubscribeToken()));
    expect(tokens.size).toBe(2000);
  });

  it("encodes the bytes it is given, without padding", () => {
    const bytes = Buffer.alloc(32, 0xff);
    expect(newUnsubscribeToken(() => bytes)).toBe(`${"_".repeat(42)}8`);
    expect(newUnsubscribeToken(() => Buffer.alloc(32))).toBe("A".repeat(43));
  });

  it("refuses a random source that returns the wrong size", () => {
    expect(() => newUnsubscribeToken(() => Buffer.alloc(16))).toThrow();
  });

  it("matches the migration's check", () => {
    // supabase/migrations/20260929000000_newsletter.sql: unsubscribe_token ~ '^[A-Za-z0-9_-]{43}$'
    expect(UNSUBSCRIBE_TOKEN_PATTERN.source).toBe("^[A-Za-z0-9_-]{43}$");
  });
});

describe("isUnsubscribeToken", () => {
  it("accepts a token and nothing else", () => {
    expect(isUnsubscribeToken(newUnsubscribeToken())).toBe(true);
    for (const value of [
      null,
      undefined,
      42,
      "",
      "A".repeat(42),
      "A".repeat(44),
      `${"A".repeat(42)}=`,
      `${"A".repeat(42)}+`,
      `${"A".repeat(42)}/`,
      ` ${"A".repeat(43)}`,
      `${"A".repeat(43)}\n`,
    ]) {
      expect(isUnsubscribeToken(value)).toBe(false);
    }
  });
});

describe("unsubscribe links", () => {
  it("point at the confirm page with the token", () => {
    const token = "A".repeat(40) + "-_z";
    expect(unsubscribePath(token)).toBe(`/newsletter/unsubscribe?token=${token}`);
    expect(unsubscribeUrl(token)).toMatch(
      new RegExp(`^https://[^/]+/newsletter/unsubscribe\\?token=${token}$`),
    );
  });
});
