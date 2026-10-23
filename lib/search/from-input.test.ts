import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  aliexpressItemId,
  fetchableUrl,
  fetchPage,
  isAliexpressShortLink,
  productFromHtml,
  wordsFromUrl,
} = await import("./from-input");

describe("fetchableUrl", () => {
  it("keeps public http(s) addresses", () => {
    expect(fetchableUrl("https://www.amazon.com/dp/B0ABC")?.hostname).toBe("www.amazon.com");
    expect(fetchableUrl("  http://shein.com/x  ")?.hostname).toBe("shein.com");
  });

  it("refuses internal, odd or unsafe addresses", () => {
    for (const raw of [
      "ftp://example.com/x",
      "javascript:alert(1)",
      "http://localhost/x",
      "http://127.0.0.1/x",
      "http://10.0.0.5/x",
      "http://[::1]/x",
      "http://intranet/x",
      "http://printer.local/x",
      "http://db.internal/x",
      "https://example.com:8443/x",
      "https://user:pw@example.com/x",
      "not a link",
    ]) {
      expect(fetchableUrl(raw), raw).toBeNull();
    }
  });
});

describe("aliexpressItemId", () => {
  it("reads the item id of an AliExpress product address", () => {
    expect(
      aliexpressItemId(new URL("https://he.aliexpress.com/item/1005006123456789.html?x=1")),
    ).toBe("1005006123456789");
    expect(aliexpressItemId(new URL("https://www.aliexpress.us/item/3256805123456789.html"))).toBe(
      "3256805123456789",
    );
  });

  it("is null for other stores and other AliExpress pages", () => {
    expect(
      aliexpressItemId(new URL("https://evil-aliexpress.com/item/1005006123456789.html")),
    ).toBeNull();
    expect(
      aliexpressItemId(new URL("https://www.aliexpress.com/w/wholesale-cable.html")),
    ).toBeNull();
  });
});

describe("isAliexpressShortLink", () => {
  it("knows the short link hosts", () => {
    expect(isAliexpressShortLink(new URL("https://s.click.aliexpress.com/e/_abc"))).toBe(true);
    expect(isAliexpressShortLink(new URL("https://a.aliexpress.com/_mK1"))).toBe(true);
    expect(isAliexpressShortLink(new URL("https://he.aliexpress.com/item/1.html"))).toBe(false);
  });
});

describe("productFromHtml", () => {
  it("prefers a JSON-LD Product with its brand", () => {
    const html = `<title>Store | Buy</title><script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"WebPage"},{"@type":"Product","name":"Wireless Earbuds &amp; Case","brand":{"@type":"Brand","name":"Soundcore"}}]}</script>`;
    expect(productFromHtml(html)).toEqual({ name: "Wireless Earbuds & Case", brand: "Soundcore" });
  });

  it("falls back to og:title, then <title>", () => {
    expect(productFromHtml(`<meta content="Kids Water Bottle" property="og:title">`).name).toBe(
      "Kids Water Bottle",
    );
    expect(productFromHtml(`<title>Smart Watch &#39;Pro&#39;</title>`).name).toBe(
      "Smart Watch 'Pro'",
    );
    expect(productFromHtml(`<p>nothing</p>`)).toEqual({ name: null, brand: null });
  });

  it("skips JSON-LD that does not parse", () => {
    const html = `<script type="application/ld+json">{oops</script><meta property="og:title" content="LED Lamp">`;
    expect(productFromHtml(html).name).toBe("LED Lamp");
  });
});

describe("wordsFromUrl", () => {
  it("reads the words of a product address", () => {
    expect(
      wordsFromUrl(
        new URL("https://www.amazon.com/Wireless-Earbuds-Bluetooth-Headphones/dp/B0ABC"),
      ),
    ).toBe("Wireless Earbuds Bluetooth Headphones B0ABC");
  });

  it("is null when the address says too little", () => {
    expect(wordsFromUrl(new URL("https://example.com/p/12345"))).toBeNull();
  });
});

describe("fetchPage", () => {
  const html = (body: string) =>
    new Response(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });

  it("follows a redirect and returns the final page", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 301,
          headers: { location: "https://he.aliexpress.com/item/1005001.html" },
        }),
      )
      .mockResolvedValueOnce(html("<title>x</title>"));
    const page = await fetchPage(new URL("https://s.click.aliexpress.com/e/_a"), fetchImpl);
    expect(page?.url.toString()).toBe("https://he.aliexpress.com/item/1005001.html");
    expect(page?.html).toContain("<title>x</title>");
  });

  it("never follows a redirect to an internal address", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }),
      );
    const page = await fetchPage(new URL("https://example.com/x"), fetchImpl);
    expect(page?.html).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("gives no HTML for a page that is not HTML or fails", async () => {
    const json = vi
      .fn()
      .mockResolvedValue(
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      );
    expect((await fetchPage(new URL("https://example.com/x"), json))?.html).toBeNull();
    const down = vi.fn().mockRejectedValue(new Error("network"));
    expect((await fetchPage(new URL("https://example.com/x"), down))?.html).toBeNull();
  });
});
