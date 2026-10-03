// The Google Analytics loader in Consent Mode "advanced": every consent type denied before the tag,
// cookieless page views for everyone, analytics_storage granted only with consent and denied again
// on withdrawal (which deletes the cookies), one page view per route with no visitor text, and
// nothing on /admin or /dev. The browser is a fake (createGtag takes its environment).
import { readFileSync } from "node:fs";
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

describe("before the page is measured", () => {
  it("a controller that was never started loads nothing and sends nothing", () => {
    const b = fakeBrowser();
    const gtag = createGtag(ID, b.env);
    expect(gtag.pageView("/", page("/"))).toBe(false);
    gtag.pause();
    gtag.consent(true);
    expect(b.scripts).toEqual([]);
    expect(b.win).toEqual({});
    expect(gtag.state).toBe("idle");
  });

  it("the loader renders nothing on the server: consent is unknown until the browser reads it", () => {
    const html = renderToStaticMarkup(createElement(GoogleAnalytics, { measurementId: ID }));
    expect(html).toBe("");
  });
});

describe("start (Consent Mode advanced)", () => {
  it("without consent: every type denied before anything else, no update, then config and the tag", () => {
    const b = fakeBrowser();
    const gtag = createGtag(ID, b.env);
    gtag.consent(false);
    gtag.start(page("/hot?cat=7"));
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
    expect(commands[2]?.[0]).toBe("js");
    expect(commands[3]).toEqual([
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
    expect(commands).toHaveLength(4);
    // Nothing grants storage: gtag.js then reads and writes no cookies (cookieless pings).
    expect(JSON.stringify(commands)).not.toContain("granted");
    // The tag is added after the defaults are in the data layer.
    expect(b.scripts).toEqual([`https://www.googletagmanager.com/gtag/js?id=${ID}`]);
    expect(b.win[gaDisableKey(ID)]).toBe(false);
    expect(gtag.granted).toBe(false);
  });

  it("with consent: the defaults first, then analytics_storage granted before config", () => {
    const b = fakeBrowser();
    const gtag = createGtag(ID, b.env);
    gtag.consent(true);
    gtag.start(page("/"));
    const commands = b.commands();
    expect(commands[0]?.slice(0, 2)).toEqual(["consent", "default"]);
    expect((commands[0]?.[2] as Record<string, string>).analytics_storage).toBe("denied");
    expect(commands[2]).toEqual(["consent", "update", { analytics_storage: "granted" }]);
    expect(commands.findIndex((c) => c[0] === "config")).toBeGreaterThan(2);
    // Only analytics storage is ever granted: no ad type, ever.
    expect(JSON.stringify(commands)).not.toMatch(/"ad_[a-z_]+":"granted"/);
    expect(gtag.granted).toBe(true);
  });

  it("pushes Arguments objects, as Google's snippet does (gtag.js ignores arrays)", () => {
    const b = fakeBrowser();
    createGtag(ID, b.env).start(page("/"));
    for (const entry of b.win.dataLayer as unknown[]) {
      expect(Object.prototype.toString.call(entry)).toBe("[object Arguments]");
    }
  });

  it("adds gtag.js once, for the id, whatever the consent does", () => {
    const b = fakeBrowser();
    const gtag = createGtag(ID, b.env);
    gtag.start(page("/"));
    gtag.start(page("/"));
    gtag.consent(true);
    gtag.pause();
    gtag.start(page("/"));
    gtag.consent(false);
    gtag.start(page("/"));
    expect(b.scripts).toEqual([`https://www.googletagmanager.com/gtag/js?id=${ID}`]);
  });

  it("writes no cookie before consent: the only cookie writes are deletions", () => {
    const b = fakeBrowser("matzati_consent=x; theme=dark");
    const gtag = createGtag(ID, b.env);
    gtag.consent(false);
    gtag.start(page("/"));
    gtag.pageView("/", page("/"));
    expect(b.cookieWrites).toEqual([]);
    // gtag.js itself writes cookies only under a granted analytics_storage, which nothing set.
    expect(JSON.stringify(b.commands())).not.toContain("granted");
  });
});

describe("consent changes on the page", () => {
  it("accepting updates analytics_storage to granted, once, and sends no extra page view", () => {
    const b = fakeBrowser();
    const gtag = createGtag(ID, b.env);
    gtag.consent(false);
    gtag.start(page("/"));
    gtag.pageView("/", page("/"));
    const before = b.commands().length;
    gtag.consent(true);
    gtag.consent(true);
    const added = b.commands().slice(before);
    expect(added).toEqual([["consent", "update", { analytics_storage: "granted" }]]);
    expect(gtag.pageView("/", page("/"))).toBe(false);
  });

  it("withdrawing updates analytics_storage to denied, keeps measuring and deletes the _ga cookies", () => {
    const b = fakeBrowser("matzati_consent=x; _ga=GA1.1.1; _ga_AB12CD34EF=GS1.1.1; theme=dark");
    const gtag = createGtag(ID, b.env);
    gtag.consent(true);
    gtag.start(page("/"));
    gtag.pageView("/", page("/"));
    expect(b.cookieWrites).toEqual([]);
    gtag.consent(false);
    expect(b.commands().at(-1)).toEqual(["consent", "update", { analytics_storage: "denied" }]);
    // Advanced mode: cookieless pings go on, so Google's opt-out flag is not set.
    expect(b.win[gaDisableKey(ID)]).toBe(false);
    expect(gtag.pageView("/hot", page("/hot"))).toBe(true);
    expect(b.cookieWrites).toEqual([
      "_ga=; Max-Age=0; Path=/",
      "_ga=; Max-Age=0; Path=/; Domain=matzati-il.vercel.app",
      "_ga=; Max-Age=0; Path=/; Domain=vercel.app",
      "_ga_AB12CD34EF=; Max-Age=0; Path=/",
      "_ga_AB12CD34EF=; Max-Age=0; Path=/; Domain=matzati-il.vercel.app",
      "_ga_AB12CD34EF=; Max-Age=0; Path=/; Domain=vercel.app",
    ]);
  });

  it("without consent, deletes _ga cookies left from an earlier one, before anything loads", () => {
    const b = fakeBrowser("_ga=GA1.1.1");
    const gtag = createGtag(ID, b.env);
    gtag.consent(false);
    expect(b.win).toEqual({});
    expect(b.cookieWrites[0]).toBe("_ga=; Max-Age=0; Path=/");
    expect(gtag.state).toBe("idle");
  });
});

describe("page views", () => {
  /** The page_view events sent so far. */
  const views = (b: ReturnType<typeof fakeBrowser>) =>
    b.commands().filter((c) => c[0] === "event" && c[1] === "page_view");

  it("sends one per route change, the route before as the referrer", () => {
    const b = fakeBrowser();
    const gtag = createGtag(ID, b.env);
    gtag.start(page("/"));
    expect(gtag.pageView("/", { ...page("/"), page_referrer: "https://www.google.com/" })).toBe(
      true,
    );
    // A re-render or a second effect run on the same route sends nothing.
    expect(gtag.pageView("/", page("/"))).toBe(false);
    expect(gtag.pageView("/hot", page("/hot"))).toBe(true);
    // Two searches have the same reduced address but are two route changes.
    expect(gtag.pageView("/search?q=a", page("/search"))).toBe(true);
    expect(gtag.pageView("/search?q=b", page("/search"))).toBe(true);
    expect(views(b).map((c) => c[2])).toEqual([
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

  it("drops the search text before and after consent alike", () => {
    const href = `${ORIGIN}/search?q=טלפון+של+דנה&sort=cheapest`;
    const searchPage: AnalyticsPage = {
      page_location: analyticsLocation(href) ?? "",
      page_title: analyticsTitle(href, "חיפוש: טלפון של דנה | מצאתי", "מצאתי"),
    };
    const b = fakeBrowser();
    const gtag = createGtag(ID, b.env);
    gtag.consent(false);
    gtag.start(searchPage);
    gtag.pageView("/search?q=a", searchPage);
    gtag.consent(true);
    gtag.pageView("/search?q=b", searchPage);
    expect(views(b)).toHaveLength(2);
    for (const view of views(b)) {
      expect(view[2]).toMatchObject({
        page_location: `${ORIGIN}/search?sort=cheapest`,
        page_title: "חיפוש | מצאתי",
      });
    }
    const all = JSON.stringify(b.commands());
    expect(all).not.toContain("דנה");
    expect(all).not.toContain("q=");
  });

  it("a first page on /admin or /dev only pauses: no tag, no command, whatever the consent", () => {
    // What GtagTracker does on a path isTrackedPath refuses: consent(), then pause(), never start().
    for (const path of ["/admin/settings", "/dev/preview/footer"]) {
      expect(isTrackedPath(path)).toBe(false);
      const b = fakeBrowser();
      const gtag = createGtag(ID, b.env);
      gtag.consent(true);
      gtag.pause();
      expect(gtag.pageView(path, page(path))).toBe(false);
      expect(b.scripts).toEqual([]);
      expect(b.win).toEqual({});
    }
  });

  it("sends nothing while paused (/admin, /dev) and resumes after", () => {
    const b = fakeBrowser();
    const gtag = createGtag(ID, b.env);
    gtag.start(page("/"));
    gtag.pause();
    expect(b.win[gaDisableKey(ID)]).toBe(true);
    expect(gtag.pageView("/admin", page("/admin"))).toBe(false);
    gtag.start(page("/"));
    expect(b.win[gaDisableKey(ID)]).toBe(false);
    expect(gtag.pageView("/", page("/"))).toBe(true);
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

describe("no Google Analytics without an id", () => {
  it("the root layout mounts the loader only while a measurement id is set", () => {
    const layout = readFileSync(new URL("../../app/layout.tsx", import.meta.url), "utf8");
    const mounts = layout.match(/<GoogleAnalytics\b[^>]*>/g) ?? [];
    expect(mounts).toHaveLength(1);
    expect(layout).toContain(
      "{measurementId && <GoogleAnalytics measurementId={measurementId} />}",
    );
  });
});
