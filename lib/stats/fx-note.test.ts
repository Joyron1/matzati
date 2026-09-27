// The exchange-rate footnote on /admin/stats. BoI's lastUpdate is only checked to be a string, so
// an unparsable date must drop the "published" part instead of throwing and taking the page down.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FxNote } from "@/app/admin/stats/sections";

const render = (fx: Parameters<typeof FxNote>[0]["fx"]) =>
  renderToStaticMarkup(createElement(FxNote, { fx }));

describe("FxNote", () => {
  it("names the Bank of Israel rate and when it was published (Israel time)", () => {
    const html = render({
      rate: 3.7123,
      publishedAt: "2026-09-25T09:23:04.8179672Z",
      source: "boi",
    });
    expect(html).toContain("בנק ישראל");
    expect(html).toContain("₪3.712");
    expect(html).toContain("(פורסם 25.9 בשעה 12:23)");
  });

  it("leaves out an unparsable publish date instead of throwing", () => {
    const html = render({ rate: 3.7, publishedAt: "not a date", source: "boi" });
    expect(html).toContain("₪3.700 לדולר.");
    expect(html).not.toContain("פורסם");
  });

  it("says when the configured fallback rate was used", () => {
    const html = render({ rate: 3.7, publishedAt: new Date(0).toISOString(), source: "fallback" });
    expect(html).toContain("USD_ILS_FALLBACK");
    expect(html).not.toContain("פורסם");
  });
});
