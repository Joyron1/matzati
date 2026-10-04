import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  ANALYTICS_MARKETING_NOTICE,
  ANALYTICS_NOTICE,
  MARKETING_NOTICE,
} from "@/lib/consent/consent";
import { ConsentGate } from "./consent-gate";
import { ConsentManager } from "./consent-manager";
import { CookieBanner } from "./cookie-banner";

const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("ConsentGate in the server HTML", () => {
  it.each(["analytics", "marketing"] as const)(
    "renders nothing for %s: consent is unknown until the browser reads the cookie",
    (category) => {
      const tag = createElement("script", { src: "https://example.com/tag.js" });
      const html = renderToStaticMarkup(createElement(ConsentGate, { category }, tag));
      expect(html).toBe("");
      for (const notice of [ANALYTICS_NOTICE, MARKETING_NOTICE, ANALYTICS_MARKETING_NOTICE]) {
        const underNotice = createElement(ConsentGate, { category, notice }, tag);
        expect(renderToStaticMarkup(underNotice)).toBe("");
      }
    },
  );
});

describe("ConsentManager in the server HTML", () => {
  it.each([
    [false, false],
    [true, false],
    [false, true],
    [true, true],
  ])(
    "renders only an empty polite live region (no banner, so no flash; analytics %s, marketing %s)",
    (analyticsInUse, marketingInUse) => {
      const html = renderToStaticMarkup(
        createElement(ConsentManager, { analyticsInUse, marketingInUse }),
      );
      expect(html).toContain('role="status"');
      expect(text(html)).toBe("");
      expect(html).not.toContain('role="region"');
      // The dialog element is there, closed and empty until opened.
      expect(html).toMatch(/<dialog[^>]*><\/dialog>/);
      expect(html).not.toMatch(/<dialog[^>]*\sopen/);
    },
  );
});

describe("the banner's text", () => {
  const banner = (analyticsInUse: boolean, marketingInUse = false) =>
    text(
      renderToStaticMarkup(
        createElement(CookieBanner, {
          analyticsInUse,
          marketingInUse,
          onChoose() {},
          onOpenSettings() {},
        }),
      ),
    );

  it("says statistics are not in use while Google Analytics is not configured", () => {
    expect(banner(false)).toContain("עוגיות סטטיסטיקה ושיווק לא בשימוש");
    expect(banner(false)).not.toContain("Google Analytics");
  });

  it("says Google Analytics counts without cookies and sets its cookies only with consent", () => {
    expect(banner(true)).toContain("Google Analytics סופר ביקורים בלי עוגיות ובלי מזהה קבוע");
    expect(banner(true)).toContain("את עוגיות הסטטיסטיקה שלו נשמור רק אם תאשרו");
    expect(banner(true)).not.toContain("סטטיסטיקה ושיווק לא בשימוש");
    expect(banner(true)).toContain("עוגיות שיווק לא בשימוש");
  });

  it("names the Meta Pixel, only with marketing consent, while it is configured", () => {
    for (const analytics of [false, true]) {
      const shown = banner(analytics, true);
      expect(shown).toContain("את Meta Pixel, למדידה ולפרסום בפייסבוק ובאינסטגרם");
      expect(shown).toContain("נפעיל רק אם תאשרו עוגיות שיווק");
      expect(shown).not.toContain("שיווק לא בשימוש");
      expect(shown.includes("Google Analytics")).toBe(analytics);
    }
    expect(banner(false, true)).toContain("עוגיות סטטיסטיקה לא בשימוש");
    expect(banner(false)).not.toContain("Meta");
    expect(banner(true)).not.toContain("Meta");
  });
});
