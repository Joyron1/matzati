// /go's answer: the 302 of before unless a pixel id is set and the request's consent cookie grants
// marketing under the current notice; then the buy-click page with the event and the link, every
// value escaped.
import { describe, expect, it } from "vitest";
import {
  ANALYTICS_MARKETING_NOTICE,
  ANALYTICS_NOTICE,
  CONSENT_COOKIE,
  consentCookie,
  makeConsent,
  MARKETING_NOTICE,
  type ConsentChoice,
} from "@/lib/consent/consent";
import { buyClickEventAllowed, escapeHtml, goResponse, type GoSettings } from "./respond";

const NOW = Date.UTC(2026, 9, 4, 12);
const LINK = "https://s.click.aliexpress.com/e/_abc123?bz=1&x=2";
const PIXEL = "1234567890123456";
const PRODUCT = "1005001234567890";

/** The Cookie header of a visitor who chose `choice` under notice `version`. */
const cookieHeader = (choice: ConsentChoice, version: number) =>
  `theme=dark; ${consentCookie(makeConsent(choice, NOW - 1000, version), { secure: true }).split(";")[0]}`;
const ALL = { analytics: true, marketing: true };
const STATS_ONLY = { analytics: true, marketing: false };

const withPixel: GoSettings = { measurementId: null, metaPixelId: PIXEL };
const withBoth: GoSettings = { measurementId: "G-AB12CD34EF", metaPixelId: PIXEL };
const noPixel: GoSettings = { measurementId: "G-AB12CD34EF", metaPixelId: null };

const respond = (settings: GoSettings, cookies: string | null) =>
  goResponse({ link: LINK, productId: PRODUCT, settings, cookieHeader: cookies, now: NOW });

function expectRedirect(response: Response) {
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe(LINK);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(response.body).toBeNull();
}

describe("buyClickEventAllowed", () => {
  it("needs a pixel id", () => {
    expect(buyClickEventAllowed(noPixel, cookieHeader(ALL, ANALYTICS_NOTICE.version), NOW)).toBe(
      false,
    );
  });

  it("needs marketing consent under the notice the site shows now", () => {
    expect(buyClickEventAllowed(withPixel, null, NOW)).toBe(false);
    expect(buyClickEventAllowed(withPixel, "", NOW)).toBe(false);
    expect(buyClickEventAllowed(withPixel, cookieHeader(ALL, MARKETING_NOTICE.version), NOW)).toBe(
      true,
    );
    expect(
      buyClickEventAllowed(withBoth, cookieHeader(ALL, ANALYTICS_MARKETING_NOTICE.version), NOW),
    ).toBe(true);
    // A yes given under another notice (before the pixel, or without Google Analytics) is not one.
    expect(buyClickEventAllowed(withBoth, cookieHeader(ALL, ANALYTICS_NOTICE.version), NOW)).toBe(
      false,
    );
    expect(buyClickEventAllowed(withBoth, cookieHeader(ALL, MARKETING_NOTICE.version), NOW)).toBe(
      false,
    );
    expect(
      buyClickEventAllowed(
        withBoth,
        cookieHeader(STATS_ONLY, ANALYTICS_MARKETING_NOTICE.version),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("goResponse", () => {
  it("pixel unset: the 302 of before, whatever the cookie", () => {
    expectRedirect(respond(noPixel, cookieHeader(ALL, ANALYTICS_MARKETING_NOTICE.version)));
    expectRedirect(respond({ measurementId: null, metaPixelId: null }, null));
  });

  it("no consent: the 302 of before", () => {
    expectRedirect(respond(withPixel, null));
    expectRedirect(respond(withPixel, cookieHeader(STATS_ONLY, MARKETING_NOTICE.version)));
    expectRedirect(respond(withPixel, `${CONSENT_COOKIE}=garbage`));
  });

  it("consent: a 200 page that sends the event with the product id and moves on to the link", async () => {
    const response = respond(withBoth, cookieHeader(ALL, ANALYTICS_MARKETING_NOTICE.version));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
    expect(response.headers.get("Location")).toBeNull();
    const html = await response.text();
    expect(html).toContain('<meta name="robots" content="noindex, nofollow">');
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
    expect(html).toContain(`<meta http-equiv="refresh" content="2;url=${escapeHtml(LINK)}">`);
    expect(html).toContain("מעבירים אתכם לאלי אקספרס…");
    expect(html).toContain(`<a href="${escapeHtml(LINK)}" rel="sponsored nofollow"`);
    expect(html).toContain(
      'n("track","InitiateCheckout",{content_ids:[pid],content_type:"product"})',
    );
    expect(html).toContain(`pid=${JSON.stringify(PRODUCT)}`);
    expect(html).toContain(`id=${JSON.stringify(PIXEL)}`);
    expect(html).toContain(`var url=${JSON.stringify(LINK).replace(/&/g, "\\u0026")}`);
    expect(html).toContain('n("set","autoConfig",false,id);n("init",id);');
    expect(html).toContain("n.disablePushState=true;n.allowDuplicatePageViews=true;");
    expect(html).toContain("location.replace(url)");
    expect(html).toContain("setTimeout(go,800)");
    expect(html).toContain("https://connect.facebook.net/en_US/fbevents.js");
    // No advanced matching, no page view.
    expect(html).not.toMatch(/"PageView"|em:|ph:/);
  });

  it("never builds the page for a link that is not https AliExpress", () => {
    const response = goResponse({
      link: 'https://evil.example/"><script>alert(1)</script>',
      productId: PRODUCT,
      settings: withPixel,
      cookieHeader: cookieHeader(ALL, MARKETING_NOTICE.version),
      now: NOW,
    });
    expect(response.status).toBe(302);
  });

  it("escapes what it writes into the HTML and the script", async () => {
    const link = "https://s.click.aliexpress.com/e/x?a=1&b=</script><b>'\"";
    const response = goResponse({
      link,
      productId: PRODUCT,
      settings: withPixel,
      cookieHeader: cookieHeader(ALL, MARKETING_NOTICE.version),
      now: NOW,
    });
    const html = await response.text();
    expect(html.match(/<\/script>/g)).toHaveLength(1);
    expect(html).not.toContain("<b>");
    expect(escapeHtml(`<a href="x" title='y'>&`)).toBe(
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;",
    );
  });
});
