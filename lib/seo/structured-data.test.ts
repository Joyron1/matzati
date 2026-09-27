import { describe, expect, it } from "vitest";
import {
  DESCRIPTION_MAX,
  itemListJsonLd,
  jsonLdScript,
  seoDescription,
  seoTitle,
  truncateAtWord,
} from "./structured-data";

describe("seoTitle", () => {
  it("adds the brand", () => {
    expect(seoTitle({ title_he: "אוזניות לריצה" })).toBe("אוזניות לריצה | מצאתי");
  });
});

describe("seoDescription", () => {
  it("uses the intro when there is one", () => {
    expect(seoDescription({ title_he: "כותרת", intro_he: "  פתיח  קצר " })).toBe("פתיח קצר");
  });

  it("falls back to a sentence without numbers", () => {
    const text = seoDescription({ title_he: "אוזניות לריצה", intro_he: null });
    expect(text.startsWith("אוזניות לריצה: ")).toBe(true);
    expect(text).not.toMatch(/\d/);
    expect(text.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
  });

  it("cuts a long intro at a word boundary", () => {
    const intro = "מילה ".repeat(60);
    const text = seoDescription({ title_he: "כותרת", intro_he: intro });
    expect(text.length).toBeLessThanOrEqual(DESCRIPTION_MAX);
    expect(text.endsWith("מילה…")).toBe(true);
  });
});

describe("truncateAtWord", () => {
  it("leaves short text alone", () => {
    expect(truncateAtWord("שלום עולם", 20)).toBe("שלום עולם");
  });

  it("cuts inside a very long word when there is no good boundary", () => {
    const text = truncateAtWord("א".repeat(50), 10);
    expect(text).toBe(`${"א".repeat(9)}…`);
  });

  it("does not end with punctuation before the ellipsis", () => {
    expect(truncateAtWord("אחת, שתיים, שלוש, ארבע, חמש", 18)).toBe("אחת, שתיים, שלוש…");
  });
});

describe("itemListJsonLd", () => {
  const products = [
    {
      product_id: "1005001",
      title_he: "אוזניות ספורט",
      image_urls: ["https://ae01.alicdn.com/a.jpg"],
    },
    { product_id: "1005002", title_he: "אוזניות <b>", image_urls: [] },
  ];

  it("lists the shown products in order, pointing to our product pages", () => {
    const data = itemListJsonLd({
      origin: "https://matzati-il.vercel.app",
      pageUrl: "https://matzati-il.vercel.app/s/abc",
      name: "אוזניות לריצה",
      products,
    });
    expect(data).toEqual({
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "אוזניות לריצה",
      url: "https://matzati-il.vercel.app/s/abc",
      numberOfItems: 2,
      itemListOrder: "https://schema.org/ItemListOrderAscending",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          url: "https://matzati-il.vercel.app/p/1005001",
          name: "אוזניות ספורט",
          image: "https://ae01.alicdn.com/a.jpg",
        },
        {
          "@type": "ListItem",
          position: 2,
          url: "https://matzati-il.vercel.app/p/1005002",
          name: "אוזניות <b>",
        },
      ],
    });
  });

  it("adds no ratings, offers or prices", () => {
    const text = JSON.stringify(
      itemListJsonLd({
        origin: "https://x.test",
        pageUrl: "https://x.test/s/a",
        name: "n",
        products,
      }),
    );
    for (const key of ["aggregateRating", "offers", "price", "review", "ratingValue"]) {
      expect(text).not.toContain(key);
    }
  });
});

describe("jsonLdScript", () => {
  it("escapes < so a value cannot close the script tag", () => {
    const text = jsonLdScript({ name: "</script><script>alert(1)</script>" });
    expect(text).not.toContain("<");
    expect(JSON.parse(text)).toEqual({ name: "</script><script>alert(1)</script>" });
  });
});
