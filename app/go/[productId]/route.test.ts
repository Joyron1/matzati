// /go never sends a crawler or script to the affiliate link, and logs no click for it.
import { beforeEach, describe, expect, it, vi } from "vitest";

const clickOut = vi.fn();
vi.mock("@/lib/search/server", () => ({
  clickOut: (...args: unknown[]) => clickOut(...args),
  clickRefFrom: () => ({ searchUid: null, position: null }),
}));
vi.mock("@/lib/settings/queries", () => ({
  publicSettings: async () => ({ measurementId: null, metaPixelId: null }),
}));

const { GET } = await import("./route");

function request(userAgent: string) {
  const url = new URL("https://www.matzati-il.com/go/1005001?src=seo");
  return {
    nextUrl: url,
    headers: new Headers({ "user-agent": userAgent }),
  } as unknown as Parameters<typeof GET>[0];
}
const ctx = { params: Promise.resolve({ productId: "1005001" }) } as Parameters<typeof GET>[1];

describe("GET /go/[productId]", () => {
  beforeEach(() => {
    clickOut.mockReset();
    clickOut.mockResolvedValue("https://s.click.aliexpress.com/e/_abc");
  });

  it("gives a crawler a page without the affiliate link, and logs no click", async () => {
    for (const ua of [
      "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
      "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2)",
      "python-requests/2.32",
      "",
    ]) {
      const res = await GET(request(ua), ctx);
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
      const html = await res.text();
      expect(html).not.toContain("aliexpress.com");
      expect(html).toContain('href="/p/1005001"');
      expect(res.headers.get("x-robots-tag")).toContain("noindex");
    }
    expect(clickOut).not.toHaveBeenCalled();
  });

  it("sends a browser to the affiliate link and logs the click", async () => {
    const res = await GET(
      request(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
      ),
      ctx,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://s.click.aliexpress.com/e/_abc");
    expect(clickOut).toHaveBeenCalledOnce();
  });
});
