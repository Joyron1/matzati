import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CookieSettingsButton } from "./cookie-consent/cookie-settings-button";
import { snapItemFor } from "./focus-scroll-list";
import { InPageLink } from "./in-page-link";

describe("InPageLink in the server HTML", () => {
  it("is a plain anchor to the target, so it works before (and without) JavaScript", () => {
    const html = renderToStaticMarkup(
      createElement(InPageLink, { targetId: "main", className: "sr-only" }, "דלגו לתוכן"),
    );
    expect(html).toBe('<a class="sr-only" href="#main">דלגו לתוכן</a>');
  });
});

describe("CookieSettingsButton", () => {
  it("carries an id only where one is given (the footer's copy), so the id stays unique", () => {
    const footer = renderToStaticMarkup(
      createElement(CookieSettingsButton, { id: "cookie-settings" }),
    );
    const other = renderToStaticMarkup(createElement(CookieSettingsButton, {}));
    expect(footer).toContain('id="cookie-settings"');
    expect(other).not.toContain("id=");
  });
});

// A row 400px wide with 16px scroll-padding on both sides and 120px items 12px apart, scrolled
// `offset` px towards its end. In RTL the row starts at the right edge.
function row(direction: "rtl" | "ltr", offset: number, count = 6) {
  vi.stubGlobal("getComputedStyle", () => ({
    direction,
    scrollPaddingInlineStart: "16px",
    scrollPaddingInlineEnd: "16px",
  }));
  const items = Array.from({ length: count }, (_, i) => {
    const start = 16 + i * 132 - offset; // logical offset from the row's start edge
    const rect =
      direction === "rtl"
        ? { left: 400 - start - 120, right: 400 - start }
        : { left: start, right: start + 120 };
    return { getBoundingClientRect: () => rect } as unknown as HTMLElement;
  });
  const list = {
    clientWidth: 400,
    children: items,
    getBoundingClientRect: () => ({ left: 0, right: 400 }),
  } as unknown as HTMLElement;
  return { list, items };
}

describe("snapItemFor (which card to snap to so the focused one shows whole)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each(["rtl", "ltr"] as const)("%s: a card that shows whole needs no scrolling", (dir) => {
    const { list, items } = row(dir, 0);
    expect(snapItemFor(list, items[0])).toBeNull();
    expect(snapItemFor(list, items[1])).toBeNull();
  });

  it.each(["rtl", "ltr"] as const)(
    "%s: a card cut at the end snaps the row to the first card that leaves it whole",
    (dir) => {
      const { list, items } = row(dir, 0);
      // Card 2 ends at 400 > 384: aligning card 1 at the start shows it whole, card 0 does not.
      expect(snapItemFor(list, items[2])).toBe(items[1]);
      // Card 4 (start 544) is fully out of view: aligning card 3 shows it whole.
      expect(snapItemFor(list, items[4])).toBe(items[3]);
    },
  );

  it.each(["rtl", "ltr"] as const)("%s: a card cut at the start is aligned at the start", (dir) => {
    const { list, items } = row(dir, 200);
    expect(snapItemFor(list, items[1])).toBe(items[1]);
  });
});
