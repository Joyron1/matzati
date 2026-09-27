import { describe, expect, it } from "vitest";
import { extractProductId } from "./product-id";

const ID = "1005006123456789";

describe("extractProductId", () => {
  it("accepts a bare product id", () => {
    expect(extractProductId(ID)).toEqual({ ok: true, id: ID });
    expect(extractProductId(`  ${ID}\n`)).toEqual({ ok: true, id: ID });
  });

  it("reads the id from AliExpress item URLs", () => {
    const urls = [
      `https://www.aliexpress.com/item/${ID}.html`,
      `https://he.aliexpress.com/item/${ID}.html?spm=a2g0o.productlist.main.1&gatewayAdapt=glo2isr`,
      `https://m.aliexpress.com/item/${ID}.html#nav`,
      `https://www.aliexpress.us/item/${ID}.html`,
      `https://aliexpress.ru/item/${ID}.html`,
      `https://www.aliexpress.com/i/${ID}.html`,
      `http://www.aliexpress.com/item/${ID}`,
      `www.aliexpress.com/item/${ID}.html`,
      `https://www.aliexpress.com/store/product/usb-cable/1234567_${ID}.html`,
      `https://m.aliexpress.com/app/web/detail.html?productId=${ID}`,
      `https://star.aliexpress.com/share/share.htm?productIds=${ID},1005000000000001`,
    ];
    for (const url of urls) expect(extractProductId(url), url).toEqual({ ok: true, id: ID });
  });

  it("finds the link inside share text from the app", () => {
    const text = `מצאתי את זה באלי אקספרס: ₪42.10 | Cable https://he.aliexpress.com/item/${ID}.html?x=1`;
    expect(extractProductId(text)).toEqual({ ok: true, id: ID });
  });

  it("reports short links, which only reveal the id after a redirect", () => {
    expect(extractProductId("https://a.aliexpress.com/_mKfF3aB")).toEqual({
      ok: false,
      error: "short_link",
    });
    expect(extractProductId("https://s.click.aliexpress.com/e/_DdwF1ab")).toEqual({
      ok: false,
      error: "short_link",
    });
  });

  it("refuses links from other sites, including look-alike hosts", () => {
    for (const url of [
      `https://www.amazon.com/item/${ID}.html`,
      `https://aliexpress.com.evil.example/item/${ID}.html`,
      `https://notaliexpress.com/item/${ID}.html`,
    ]) {
      expect(extractProductId(url), url).toEqual({ ok: false, error: "not_aliexpress" });
    }
  });

  it("reports AliExpress pages that are not a single product", () => {
    expect(
      extractProductId("https://www.aliexpress.com/category/44/consumer-electronics.html"),
    ).toEqual({
      ok: false,
      error: "no_id",
    });
    expect(extractProductId("https://www.aliexpress.com/item/abc.html")).toEqual({
      ok: false,
      error: "no_id",
    });
  });

  it("rejects text that is neither an id nor a link", () => {
    for (const bad of ["", "   ", "1".repeat(21), "hello world", "12ab", "אוזניות"]) {
      expect(extractProductId(bad), bad).toEqual({ ok: false, error: "invalid" });
    }
  });
});
