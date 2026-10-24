import { describe, expect, it } from "vitest";
import { productIdIn } from "./sticker-link";

describe("productIdIn", () => {
  it("reads the id from AliExpress links, our product page or a bare id", () => {
    expect(productIdIn("https://he.aliexpress.com/item/1005007636277321.html?spm=a2g0o")).toBe(
      "1005007636277321",
    );
    expect(productIdIn("https://www.aliexpress.com/item/1005007636277321.html")).toBe(
      "1005007636277321",
    );
    expect(productIdIn("https://www.matzati-il.com/p/1005007636277321?from=hot")).toBe(
      "1005007636277321",
    );
    expect(productIdIn(" 1005007636277321 ")).toBe("1005007636277321");
  });

  it("finds nothing in short links or other sites", () => {
    expect(productIdIn("https://a.aliexpress.com/_mKx1abc")).toBeNull();
    expect(productIdIn("https://example.com/item/1005007636277321.html")).toBeNull();
  });
});
