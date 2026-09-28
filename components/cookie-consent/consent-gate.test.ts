import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConsentGate } from "./consent-gate";
import { ConsentManager } from "./consent-manager";

const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("ConsentGate in the server HTML", () => {
  it.each(["analytics", "marketing"] as const)(
    "renders nothing for %s: consent is unknown until the browser reads the cookie",
    (category) => {
      const tag = createElement("script", { src: "https://example.com/tag.js" });
      const html = renderToStaticMarkup(createElement(ConsentGate, { category }, tag));
      expect(html).toBe("");
    },
  );
});

describe("ConsentManager in the server HTML", () => {
  it("renders only an empty polite live region (no banner, so no flash for returning visitors)", () => {
    const html = renderToStaticMarkup(createElement(ConsentManager));
    expect(html).toContain('role="status"');
    expect(text(html)).toBe("");
    expect(html).not.toContain('role="region"');
    // The dialog element is there, closed and empty until opened.
    expect(html).toMatch(/<dialog[^>]*><\/dialog>/);
    expect(html).not.toMatch(/<dialog[^>]*\sopen/);
  });
});
