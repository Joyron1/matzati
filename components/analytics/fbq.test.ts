// The Meta Pixel loader: which pages Meta may see (never visitor text), the referrer it may read,
// the settings before fbevents.js loads, one PageView per allowed route, and revoke with cookie
// deletion. The browser is a fake (createFbq takes its environment).
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buyClickScript,
  createFbq,
  META_ALLOWED_PARAMS,
  META_PIXEL_SRC,
  metaCookieDeletions,
  metaCookieNames,
  metaPageAllowed,
  metaReferrer,
  scriptLiteral,
  type FbqEnv,
} from "./fbq";
import { MetaPixel } from "./meta-pixel";

const ID = "1234567890123456";
const ORIGIN = "https://matzati.co.il";

function fakeBrowser(cookies = "") {
  const win: Record<string, unknown> = {};
  const scripts: string[] = [];
  const cookieWrites: string[] = [];
  let masked = 0;
  const env: FbqEnv = {
    win,
    appendScript: (src) => scripts.push(src),
    maskReferrer: () => {
      masked += 1;
    },
    readCookies: () => cookies,
    writeCookie: (cookie) => cookieWrites.push(cookie),
    hostname: () => "matzati.co.il",
  };
  /** The fbq calls so far (fbevents.js has not run, so they wait in the queue). */
  const calls = () => ((win.fbq as { queue?: unknown[][] })?.queue ?? []) as unknown[][];
  const flags = () => win.fbq as Record<string, unknown>;
  return { env, win, scripts, cookieWrites, calls, flags, masked: () => masked };
}

describe("metaPageAllowed", () => {
  it("allows plain pages and the listed parameters", () => {
    expect(metaPageAllowed("/", "")).toBe(true);
    expect(metaPageAllowed("/p/1005001234567890", "")).toBe(true);
    expect(metaPageAllowed("/products/44", "?page=2&sort=cheapest")).toBe(true);
    expect(metaPageAllowed("/", "utm_source=facebook&utm_medium=paid&fbclid=IwAR0abc")).toBe(true);
    expect(metaPageAllowed("/search", "cat=44")).toBe(true);
    for (const key of META_ALLOWED_PARAMS) expect(metaPageAllowed("/", `${key}=x`)).toBe(true);
  });

  it("never a page whose address holds the search text or any other parameter", () => {
    expect(metaPageAllowed("/search", "q=%D7%90%D7%95%D7%96%D7%A0%D7%99%D7%95%D7%AA")).toBe(false);
    expect(metaPageAllowed("/search", "?cat=44&q=usb")).toBe(false);
    expect(metaPageAllowed("/p/1005001234567890", "q=usb+cable")).toBe(false);
    expect(metaPageAllowed("/", "q=")).toBe(false);
    expect(metaPageAllowed("/", "email=a%40b.c")).toBe(false);
    expect(metaPageAllowed("/coupons", "code=SAVE5")).toBe(false);
  });

  it("never /admin, /dev or /go", () => {
    for (const path of ["/admin", "/admin/settings", "/dev/preview/home", "/go/1005", "/dev"]) {
      expect(metaPageAllowed(path, "")).toBe(false);
    }
    expect(metaPageAllowed("/administrator-tips", "")).toBe(true);
    expect(metaPageAllowed("/good", "")).toBe(true);
  });
});

describe("metaReferrer", () => {
  it("keeps an allowed page of this site, and only the path of one with a search", () => {
    expect(metaReferrer(`${ORIGIN}/products/44?page=2`, ORIGIN)).toBe(
      `${ORIGIN}/products/44?page=2`,
    );
    expect(metaReferrer(`${ORIGIN}/search?q=secret`, ORIGIN)).toBe(`${ORIGIN}/search`);
    expect(metaReferrer(`${ORIGIN}/p/1?q=secret#x`, ORIGIN)).toBe(`${ORIGIN}/p/1`);
  });

  it("reduces another site's address to origin and path, and nothing to nothing", () => {
    expect(metaReferrer("https://www.google.com/search?q=secret", ORIGIN)).toBe(
      "https://www.google.com/search",
    );
    expect(metaReferrer("", ORIGIN)).toBe("");
    expect(metaReferrer("not a url", ORIGIN)).toBe("");
  });
});

describe("the pixel controller", () => {
  it("loads nothing and sends nothing on a page that is not allowed", () => {
    const b = fakeBrowser();
    const fbq = createFbq(ID, b.env);
    expect(fbq.pageView("/search?q=secret", false)).toBe(false);
    expect(b.scripts).toEqual([]);
    expect(b.win).toEqual({});
    expect(fbq.state).toBe("idle");
  });

  it("sets its flags, no autoConfig and init without matching data before fbevents.js, then one PageView", () => {
    const b = fakeBrowser();
    const fbq = createFbq(ID, b.env);
    expect(fbq.pageView("/", true)).toBe(true);
    expect(b.flags().disablePushState).toBe(true);
    expect(b.flags().allowDuplicatePageViews).toBe(true);
    expect(b.masked()).toBe(1);
    expect(b.calls()).toEqual([
      ["set", "autoConfig", false, ID],
      ["init", ID],
      ["track", "PageView"],
    ]);
    expect(b.scripts).toEqual([META_PIXEL_SRC]);
  });

  it("loads on the first allowed page after a page that was not", () => {
    const b = fakeBrowser();
    const fbq = createFbq(ID, b.env);
    fbq.pageView("/search?q=secret", false);
    expect(b.scripts).toEqual([]);
    expect(fbq.pageView("/products", true)).toBe(true);
    expect(b.scripts).toHaveLength(1);
  });

  it("sends once per route, nothing on a page that is not allowed, and loads once", () => {
    const b = fakeBrowser();
    const fbq = createFbq(ID, b.env);
    fbq.pageView("/", true);
    expect(fbq.pageView("/", true)).toBe(false);
    expect(fbq.pageView("/search?q=x", false)).toBe(false);
    expect(fbq.pageView("/products", true)).toBe(true);
    expect(b.calls().filter((c) => c[0] === "track")).toHaveLength(2);
    expect(b.scripts).toHaveLength(1);
  });

  it("revoke stops the page views and deletes the Meta cookies; a new consent grants again", () => {
    const b = fakeBrowser("_fbp=fb.1.1.2; theme=dark; _fbc=fb.1.1.IwAR");
    const fbq = createFbq(ID, b.env);
    fbq.pageView("/", true);
    fbq.revoke();
    expect(fbq.state).toBe("revoked");
    expect(b.calls().at(-1)).toEqual(["consent", "revoke"]);
    expect(b.cookieWrites).toEqual(metaCookieDeletions("_fbp=1; _fbc=2", "matzati.co.il"));
    expect(b.cookieWrites).toContain("_fbp=; Max-Age=0; Path=/; Domain=co.il");
    expect(fbq.pageView("/products", true)).toBe(true);
    expect(b.calls().slice(-2)).toEqual([
      ["consent", "grant"],
      ["track", "PageView"],
    ]);
    expect(b.scripts).toHaveLength(1);
  });

  it("finds only its own cookies", () => {
    expect(metaCookieNames("_fbp=1; _fbpx=2; x_fbc=3; _fbc=4; _ga=5")).toEqual(["_fbp", "_fbc"]);
    expect(metaCookieDeletions("theme=dark", "matzati.co.il")).toEqual([]);
  });
});

describe("the buy-click script", () => {
  it("escapes its values for an inline script", () => {
    expect(scriptLiteral("</script><!--\u2028")).toBe('"\\u003c/script\\u003e\\u003c!--\\u2028"');
    const script = buyClickScript({
      pixelId: ID,
      productId: "1005",
      affiliateUrl: "https://s.click.aliexpress.com/e/x?a=</script>",
    });
    expect(script).not.toContain("</script>");
    expect(script).toContain('Object.defineProperty(document,"referrer"');
  });
});

describe("the component", () => {
  it("renders nothing on the server: consent is unknown until the browser reads it", () => {
    for (const analyticsInUse of [false, true]) {
      expect(renderToStaticMarkup(createElement(MetaPixel, { pixelId: ID, analyticsInUse }))).toBe(
        "",
      );
    }
  });

  it("the pixel renders only inside ConsentGate category marketing", () => {
    const source = readFileSync(new URL("./meta-pixel.tsx", import.meta.url), "utf8");
    expect(source).toMatch(
      /<ConsentGate category="marketing"[^>]*>\s*(\{\/\*[^]*?\*\/\}\s*)?<Suspense/,
    );
    expect(source.match(/<PixelTracker\b/g)).toHaveLength(1);
  });

  it("the root layout mounts it only while a pixel id is set", () => {
    const layout = readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8");
    expect(layout.match(/<MetaPixel\b/g)).toHaveLength(1);
    expect(layout).toMatch(/\{metaPixelId && \(\s*<MetaPixel pixelId=\{metaPixelId\}/);
  });
});
