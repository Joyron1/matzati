import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ShareLink } from "./share-link";

describe("ShareLink", () => {
  it("shares the page it names, never the browser's address (owner report 2026-10-21)", () => {
    const html = renderToStaticMarkup(
      createElement(ShareLink, { text: "מטען לאייפון", path: "/p/1005001" }),
    );
    const href = /href="([^"]+)"/.exec(html)![1].replace(/&amp;/g, "&");
    const text = new URL(href).searchParams.get("text");
    expect(new URL(href).host).toBe("wa.me");
    expect(text).toBe("מטען לאייפון\nhttps://www.matzati-il.com/p/1005001");
  });
});
