import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FilterChip } from "@/lib/types";
import { BlockerHint, BlockerList, chipBlockers } from "./filter-blockers";

const CHIPS: FilterChip[] = [
  { id: "product", kind: "keywords", label_he: "מטען מהיר 65W", removable: false },
  { id: "req:65w", kind: "must_have", label_he: "65W", removable: true },
  { id: "req:multi-device", kind: "must_have", label_he: "לטלפון ולמחשב נייד", removable: true },
  { id: "max", kind: "max_price", label_he: "עד ₪100", removable: true },
];

const link = { q: "מטען מהיר 65W לטלפון ולמחשב נייד", without: ["req:65w"] };
const text = (html: string) => html.replace(/<[^>]+>/g, "");

describe("chipBlockers", () => {
  it("keeps the blockers a removable chip on the page still removes, in their order", () => {
    const blockers = chipBlockers(
      [
        { chip_id: "req:multi-device", would_pass: 8, title_matches: 0 },
        { chip_id: "product", would_pass: 50, title_matches: null },
        { chip_id: "req:gone", would_pass: 5, title_matches: 0 },
        { chip_id: "max", would_pass: 2, title_matches: null },
      ],
      CHIPS,
    );
    expect(blockers.map((b) => b.chip.id)).toEqual(["req:multi-device", "max"]);
    expect(chipBlockers(undefined, CHIPS)).toEqual([]);
  });
});

describe("BlockerList (no results)", () => {
  it("says what each filter did, how many pass without it, and links to the search without it", () => {
    const blockers = chipBlockers(
      [
        { chip_id: "req:multi-device", would_pass: 8, title_matches: 0 },
        { chip_id: "max", would_pass: 1, title_matches: null },
      ],
      CHIPS,
    );
    const html = renderToStaticMarkup(createElement(BlockerList, { blockers, ...link }));
    expect(text(html)).toContain(
      "אף מוצר שבדקנו לא מציין בכותרת ״לטלפון ולמחשב נייד״. בלי הסינון הזה היו עוברים 8 מהמוצרים שכבר בדקנו.",
    );
    expect(text(html)).toContain(
      "אף מוצר שעבר את שאר הסינונים לא נמצא בטווח המחיר ״עד ₪100״. בלי הסינון הזה היה עובר מוצר אחד מהמוצרים שכבר בדקנו.",
    );
    expect(text(html)).toContain("הסרת הסינון: לטלפון ולמחשב נייד");
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => decodeURIComponent(m[1]));
    expect(hrefs).toEqual([
      expect.stringContaining("without=req:65w,req:multi-device"),
      expect.stringContaining("without=req:65w,max"),
    ]);
  });

  it("says 'none that passed the rest' when some checked titles do mention the requirement", () => {
    const [b] = chipBlockers(
      [{ chip_id: "req:multi-device", would_pass: 8, title_matches: 2 }],
      CHIPS,
    );
    const html = renderToStaticMarkup(createElement(BlockerList, { blockers: [b], ...link }));
    expect(text(html)).toContain(
      "אף מוצר שעבר את שאר הסינונים לא מציין בכותרת ״לטלפון ולמחשב נייד״.",
    );
  });

  it("names the size cap of a small search instead of claiming no title mentions it", () => {
    // A "small" power bank search: a 20000mAh title mentions 10000mAh-or-more, yet fails the cap.
    const chips: FilterChip[] = [
      { id: "req:10000mah", kind: "must_have", label_he: "10000 מיליאמפר", removable: true },
    ];
    const [b] = chipBlockers(
      [{ chip_id: "req:10000mah", would_pass: 4, title_matches: 12, size_cap: true }],
      chips,
    );
    const html = renderToStaticMarkup(createElement(BlockerList, { blockers: [b], ...link }));
    expect(text(html)).toContain(
      "אף מוצר שעבר את שאר הסינונים לא מציין בכותרת ״10000 מיליאמפר״ או עד פי 1.5 ממנו (ביקשתם מוצר קטן).",
    );
  });
});

describe("BlockerHint (1-2 results)", () => {
  it("names the filter and the count, with a labelled remove link", () => {
    const [b] = chipBlockers(
      [{ chip_id: "req:multi-device", would_pass: 9, title_matches: 2 }],
      CHIPS,
    );
    const html = renderToStaticMarkup(createElement(BlockerHint, { blocker: b, ...link }));
    expect(text(html)).toContain(
      "בלי הסינון ״לטלפון ולמחשב נייד״ היו עוברים 9 מהמוצרים שכבר בדקנו.",
    );
    expect(html).toContain('aria-label="הסרת הסינון: לטלפון ולמחשב נייד"');
  });
});
