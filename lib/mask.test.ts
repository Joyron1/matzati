import { describe, expect, it } from "vitest";
import { maskSecret, redact } from "./mask";

describe("maskSecret", () => {
  it("keeps only two characters at each end", () => {
    expect(maskSecret("abcdefghijklmnop")).toBe("ab************op");
    expect(maskSecret("abcdefgh")).toBe("ab****gh");
  });
  it("fully masks short values and reports empty ones", () => {
    expect(maskSecret("abc")).toBe("***");
    expect(maskSecret("")).toBe("<empty>");
    expect(maskSecret(undefined)).toBe("<empty>");
  });
});

describe("redact", () => {
  it("removes every occurrence of each secret", () => {
    expect(redact("key=SECRET1&x=SECRET1&y=TOKEN", ["SECRET1", "TOKEN"])).toBe(
      "key=<redacted>&x=<redacted>&y=<redacted>",
    );
  });
  it("ignores empty and very short secrets", () => {
    expect(redact("abc", ["", undefined, "a"])).toBe("abc");
  });
});
