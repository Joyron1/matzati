import { describe, expect, it } from "vitest";
import { parseSharedIds, productUrl, SHARED_MAX, sharedListUrl, whatsappHref } from "./shared";

describe("shared list links", () => {
  it("keeps product ids only, once each, in order", () => {
    expect(parseSharedIds("1005007636277321, 33023427983,abc,1005007636277321,<x>,12")).toEqual([
      "1005007636277321",
      "33023427983",
    ]);
    expect(parseSharedIds(undefined)).toEqual([]);
    expect(parseSharedIds(["1005007636277321", "33023427983"])).toEqual(["1005007636277321"]);
  });

  it("caps a list at SHARED_MAX", () => {
    const ids = Array.from({ length: SHARED_MAX + 10 }, (_, i) => String(1005000000000000 + i));
    expect(parseSharedIds(ids.join(","))).toHaveLength(SHARED_MAX);
    expect(sharedListUrl(ids).split("ids=")[1].split(",")).toHaveLength(SHARED_MAX);
  });

  it("builds our own absolute links and a WhatsApp link, never an affiliate link", () => {
    expect(sharedListUrl(["1", "2"])).toBe("https://www.matzati-il.com/shared?ids=1,2");
    expect(productUrl("1005007636277321")).toBe("https://www.matzati-il.com/p/1005007636277321");
    const href = whatsappHref(`שמרתי מוצר\n${productUrl("1")}`);
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(href)).not.toContain("s.click.aliexpress");
  });
});
