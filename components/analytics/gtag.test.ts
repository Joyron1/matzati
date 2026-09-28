// The consent-gated Google Analytics loader: nothing before consent, Consent Mode defaults denied
// then analytics granted, one page view per route with no visitor text, and a withdrawal that stops
// sending and deletes the cookies. The browser is a fake (createGtag takes its environment).
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GoogleAnalytics } from "./google-analytics";
import {
  analyticsLocation,
  analyticsReferrer,
  analyticsTitle,
  cookieDeletions,
  createGtag,
  gaCookieNames,
  gaDisableKey,
  GA_COOKIE_SECONDS,
  isTrackedPath,
  type AnalyticsPage,
  type GtagEnv,
} from "./gtag";

const ID = "G-AB12CD34EF";
const ORIGIN = "https://matzati-il.vercel.app";

function fakeBrowser(cookies = "") {
  const win: Record<string, unknown> = {};
  const scripts: string[] = [];
  const cookieWrites: string[] = [];
  const env: GtagEnv = {
    win,
    appendScript: (src) => scripts.push(src),
    readCookies: () => cookies,
    writeCookie: (cookie) => cookieWrites.push(cookie),
    hostname: () => "matzati-il.vercel.app",
  };
  /** The gtag commands so far, as plain arrays. */
  const commands = () => ((win.dataLayer as IArguments[] | undefined) ?? []).map((a) => [...a]);
  return { env, win, scripts, cookieWrites, commands };
}

const page = (path: string, title = "מצאתי"): AnalyticsPage => ({
  page_location: `${ORIGIN}${path}`,
  page_title: title,
});

describe("before consent", () => {
  it("a controller that was never granted loads nothing and sends nothing", () => {
    const b = fakeBrowser();
    const gtag = createGtag(ID, b.env);
    expect(gtag.pageView("/", page("/"))).toBe(false);
    gtag.pause();
    expect(b.scripts).toEqual([]);
    expect(b.win).toEqual({});
    expect(gtag.state).toBe("idle");
  });

  it("the loader renders nothing on the server: consent is unknown until the browser reads it", () => {
    const html = renderToStaticMarkup(createElement(GoogleAnalytics, { measurementId: ID }));
    expect(html).toBe("");
  });
});

describe("grant", () => {
  it("sets Consent Mode defaults to denied before anything else, then grants analytics only", () => {
    const b = fakeBrowser();
    createGtag(ID, b.env).grant(page("/hot?cat=7"));
    const commands = b.commands();
    expect(commands[0]).toEqual([
      "consent",
      "default",
      {
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        analytics_storage: "denied",
      },
    ]);
    expect(commands[1]).toEqual(["set", "ads_data_redaction", true]);
    expect(commands[2]).toEqual(["consent", "update", { analytics_storage: "granted" }]);
    expect(commands[3][0]).toBe("js");
    expect(commands[4]).toEqual([
      "config",
      ID,
      {
        send_page_view: false,
        anonymize_ip: true,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
        cookie_domain: "none",
        cookie_expires: GA_COOKIE_SECONDS,
        page_location: `${ORIGIN}/hot?cat=7`,
        page_title: "מצאתי",
      },
    ]);
    // Nothing ever grants an ad type.
    expect(JSON.stringify(commands)).not.toMatch(/"ad_[a-z_]+":"granted"/);
    expect(b.win[gaDisableKey(ID)]).toBe(false);
  });

  it("pushes Arguments objects, as Google's snippet does (gtag.js ignores arrays)", () => {
    const b = fakeBrowser();
    createGtag(ID, b.env).grant(page("/"));
    for (const entry of b.win.dataLayer as unknown[]) {
      expect(Object.prototype.toString.call(entry)).toBe("[object Arguments]");
    }
  });

  it("adds gtag.js once, for the id", () => {
    const b = fakeBrowser();
    const gtag = createGtag(ID, b.env);
    gtag.grant(page("/"));
    gtag.grant(page("/"));
    gtag.pause();
    gtag.grant(page("/"));
    gtag.revoke();
    gtag.grant(page("/"));
    expect(b.scripts).toEqual([`https://www.googletagmanager.com/gtag/js?id=${ID}`]);
  });
});

describe("page views", () => {
  it("sends one per route change, the route before as the referrer", () => {
    const b = fakeBrowser();
    const gtag = createGtag(ID, b.env);
    gtag.grant(page("/"));
    expect(gtag.pageView("/", { ...page("/"), page_referrer: "https://www.google.com/" })).toBe(
      true,
    );
    // A re-render or a second effect run on the same route sends nothing.
    expect(gtag.pageView("/", page("/"))).toBe(false);
    expect(gtag.pageView("/hot", page("/hot"))).toBe(true);
    // Two searches have the same reduced address but are two route changes.
    expect(gtag.pageView("/search?q=a", page("/search"))).toBe(true);
    expect(gtag.pageView("/search?q=b", page("/search"))).toBe(true);
    const views = b.commands().filter((c) => c[0] === "event" && c[1] === "page_view");
    expect(views.map((c) => c[2])).toEqual([
      {
        page_location: `${ORIGIN}/`,
        page_title: "מצאתי",
        page_referrer: "https://www.google.com/",
      },
      { page_location: `${ORIGIN}/hot`, page_title: "מצאתי", page_referrer: `${ORIGIN}/` },
      { page_location: `${ORIGIN}/search`, page_title: "מצאתי", page_referrer: `${ORIGIN}/hot` },
      { page_location: `${ORIGIN}/search`, page_title: "מצאתי" },
    ]);
    // Each page view first sets the same values for the page's later events.
    const sets = b.commands().filter((c) => c[0] === "set" && typeof c[1] === "object");
    expect(sets).toHaveLength(4);
  });

  it("sends nothing while paused (/admin) and resumes after", () => {
    const b = fakeBrowser();
    const gtag = createGtag(ID, b.env);
    gtag.grant(page("/"));
    gtag.pause();
    expect(b.win[gaDisableKey(ID)]).toBe(true);
    expect(gtag.pageView("/admin", page("/admin"))).toBe(false);
    gtag.grant(page("/"));
    expect(b.win[gaDisableKey(ID)]).toBe(false);
    expect(gtag.pageView("/", page("/"))).toBe(true);
  });
});

describe("withdrawal", () => {
  it("denies analytics storage, stops sending and deletes the _ga cookies", () => {
    const b = fakeBrowser("matzati_consent=x; _ga=GA1.1.1; _ga_AB12CD34EF=GS1.1.1; theme=dark");
    const gtag = createGtag(ID, b.env);
    gtag.grant(page("/"));
    gtag.pageView("/", page("/"));
    gtag.revoke();
    expect(b.commands().at(-1)).toEqual(["consent", "update", { analytics_storage: "denied" }]);
    expect(b.win[gaDisableKey(ID)]).toBe(true);
    expect(gtag.pageView("/hot", page("/hot"))).toBe(false);
    expect(b.cookieWrites).toEqual([
      "_ga=; Max-Age=0; Path=/",
      "_ga=; Max-Age=0; Path=/; Domain=matzati-il.vercel.app",
      "_ga=; Max-Age=0; Path=/; Domain=vercel.app",
      "_ga_AB12CD34EF=; Max-Age=0; Path=/",
      "_ga_AB12CD34EF=; Max-Age=0; Path=/; Domain=matzati-il.vercel.app",
      "_ga_AB12CD34EF=; Max-Age=0; Path=/; Domain=vercel.app",
    ]);
  });

  it("a new consent on the same page grants again and counts the page again", () => {
    const b = fakeBrowser();
    const gtag = createGtag(ID, b.env);
    gtag.grant(page("/"));
    gtag.pageView("/", page("/"));
    gtag.revoke();
    gtag.grant(page("/"));
    expect(b.commands().at(-1)).toEqual(["consent", "update", { analytics_storage: "granted" }]);
    expect(b.win[gaDisableKey(ID)]).toBe(false);
    expect(gtag.pageView("/", page("/"))).toBe(true);
  });

  it("without a load it only deletes leftover cookies", () => {
    const b = fakeBrowser("_ga=GA1.1.1");
    const gtag = createGtag(ID, b.env);
    gtag.revoke();
    expect(b.win).toEqual({});
    expect(b.cookieWrites[0]).toBe("_ga=; Max-Age=0; Path=/");
    expect(gtag.state).toBe("idle");
  });
});

describe("what is sent", () => {
  it("keeps the path and the parameters without free text, never the search or its id", () => {
    expect(
      analyticsLocation(`${ORIGIN}/search?q=טלפון+של+דנה&sort=cheapest&without=r1&from=example`),
    ).toBe(`${ORIGIN}/search?sort=cheapest&from=example`);
    expect(analyticsLocation(`${ORIGIN}/p/100?q=secret&from=hot&cat=7#reviews`)).toBe(
      `${ORIGIN}/p/100?from=hot&cat=7`,
    );
    expect(analyticsLocation(`${ORIGIN}/go/1?s=uid&pos=2&gclid=abc&utm_source=fb`)).toBe(
      `${ORIGIN}/go/1?utm_source=fb`,
    );
    expect(analyticsLocation(`${ORIGIN}/searches?q=0501234567&page=2`)).toBe(
      `${ORIGIN}/searches?page=2`,
    );
    expect(analyticsLocation("not a url")).toBeNull();
  });

  it("replaces a title that holds what the visitor typed", () => {
    expect(analyticsTitle(`${ORIGIN}/search?q=אוזניות`, "חיפוש: אוזניות | מצאתי", "מצאתי")).toBe(
      "חיפוש | מצאתי",
    );
    expect(analyticsTitle(`${ORIGIN}/searches?q=כבל`, "כבל | מצאתי", "מצאתי")).toBe(
      "/searches | מצאתי",
    );
    expect(analyticsTitle(`${ORIGIN}/hot?cat=7`, "מוצרים חמים | מצאתי", "מצאתי")).toBe(
      "מוצרים חמים | מצאתי",
    );
    // Between two pages' metadata the document has no title yet.
    expect(analyticsTitle(`${ORIGIN}/terms`, "", "מצאתי")).toBe("/terms | מצאתי");
  });

  it("reduces the referrer: this site's through the same rule, another site's to origin and path", () => {
    expect(analyticsReferrer(`${ORIGIN}/search?q=abc`, ORIGIN)).toBe(`${ORIGIN}/search`);
    expect(analyticsReferrer("https://www.google.com/search?q=matzati", ORIGIN)).toBe(
      "https://www.google.com/search",
    );
    expect(analyticsReferrer("", ORIGIN)).toBeUndefined();
    expect(analyticsReferrer("::", ORIGIN)).toBeUndefined();
  });

  it("measures no owner or development page", () => {
    expect(isTrackedPath("/")).toBe(true);
    expect(isTrackedPath("/p/1")).toBe(true);
    expect(isTrackedPath("/administrator")).toBe(true);
    expect(isTrackedPath("/admin")).toBe(false);
    expect(isTrackedPath("/admin/settings")).toBe(false);
    expect(isTrackedPath("/dev/preview/footer")).toBe(false);
  });
});

describe("cookies", () => {
  it("finds only the GA cookies", () => {
    expect(gaCookieNames("_ga=1; _gat=2; _ga_ABC=3; x_ga=4; _ga=5")).toEqual(["_ga", "_ga_ABC"]);
    expect(gaCookieNames("")).toEqual([]);
  });

  it("deletes host-only, and on parent domains only where there are any", () => {
    expect(cookieDeletions("_ga", "localhost")).toEqual(["_ga=; Max-Age=0; Path=/"]);
    expect(cookieDeletions("_ga", "127.0.0.1")).toEqual(["_ga=; Max-Age=0; Path=/"]);
    expect(cookieDeletions("_ga", "a.b.c")).toEqual([
      "_ga=; Max-Age=0; Path=/",
      "_ga=; Max-Age=0; Path=/; Domain=a.b.c",
      "_ga=; Max-Age=0; Path=/; Domain=b.c",
    ]);
  });
});
