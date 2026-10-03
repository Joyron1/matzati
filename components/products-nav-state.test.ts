import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NAV_MENU_CLOSED, navMenuReducer, type NavMenuEvent } from "./products-nav-state";

const run = (...events: NavMenuEvent[]) => events.reduce(navMenuReducer, NAV_MENU_CLOSED);

describe("the header's categories disclosure", () => {
  it("opens on hover and closes when the mouse leaves", () => {
    expect(run("hover-enter")).toEqual({ open: true, pinned: false });
    expect(run("hover-enter", "hover-leave")).toEqual(NAV_MENU_CLOSED);
  });

  it("opens from the button (keyboard or click) and stays open when the mouse leaves", () => {
    expect(run("toggle")).toEqual({ open: true, pinned: true });
    expect(run("toggle", "hover-leave").open).toBe(true);
    expect(run("toggle", "toggle")).toEqual(NAV_MENU_CLOSED);
  });

  it("keeps a hover-opened panel open on a click (the pointer is still on the button)", () => {
    expect(run("hover-enter", "toggle")).toEqual({ open: true, pinned: true });
    expect(run("hover-enter", "toggle", "hover-leave").open).toBe(true);
  });

  it("closes on Escape, a click outside, focus leaving and a navigation", () => {
    for (const event of ["escape", "outside", "focus-out", "navigate"] as const) {
      expect(run("toggle", event)).toEqual(NAV_MENU_CLOSED);
      expect(run("hover-enter", event)).toEqual(NAV_MENU_CLOSED);
      // Closed stays closed (the same object: no re-render).
      expect(navMenuReducer(NAV_MENU_CLOSED, event)).toBe(NAV_MENU_CLOSED);
    }
  });
});

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

describe("ProductsNav in the server HTML (before and without JavaScript)", () => {
  it("is a plain link to /products, with the panel closed and the chevron's state", async () => {
    const { ProductsNav } = await import("./products-nav");
    const html = renderToStaticMarkup(
      createElement(ProductsNav, null, createElement("a", { href: "/products/x" }, "x")),
    );
    // Phones: the 44px item is a link until hydrated.
    expect(html).toMatch(
      /<a [^>]*aria-label="כל המוצרים"[^>]*href="\/products"|<a [^>]*href="\/products"[^>]*aria-label="כל המוצרים"/,
    );
    // From lg: the labelled link and the chevron button, collapsed and naming its panel.
    expect(html).toContain(">כל המוצרים</a>");
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"/);
    expect(html).toMatch(/<div id="[^"]+" hidden=""/);
    expect(html).toContain('href="/products/x"');
  });
});
