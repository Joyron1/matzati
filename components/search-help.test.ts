import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { searchHelp } from "@/lib/search/help-tips";
import type { FilterChip } from "@/lib/types";
import { fewResultsTitle, SearchHelpBox } from "./search-help";

const CHIPS: FilterChip[] = [
  { id: "product", kind: "keywords", label_he: "בלונים ליום הולדת", removable: false },
  { id: "req:sonic", kind: "must_have", label_he: "סוניק", removable: true },
  { id: "max", kind: "max_price", label_he: "עד ₪50", removable: true },
];

const render = (help: ReturnType<typeof searchHelp>, heading = fewResultsTitle(3)) =>
  renderToStaticMarkup(
    createElement(SearchHelpBox, { help, heading, q: "בלונים של סוניק", without: [] }),
  ).replace(/<!-- -->/g, "");

describe("SearchHelpBox", () => {
  it("names the box, counts only what the blockers counted, and links each removal", () => {
    const out = render(
      searchHelp(CHIPS, [{ chip_id: "req:sonic", would_pass: 7, title_matches: 2 }]),
    );
    expect(out).toMatch(/<section aria-labelledby="search-help-title"/);
    expect(out).toContain('<h2 id="search-help-title"');
    expect(out).toContain("מצאנו רק 3 מוצרים שעברו את הסינון");
    expect(out).toContain('בלי ״סוניק״ היו עוברים <bdi dir="ltr">7</bdi> מהמוצרים שכבר בדקנו.');
    expect(out).toContain("נסו תקציב רחב יותר, או חפשו בלי הגבלת מחיר.");
    expect(out).toContain("without=req%3Asonic");
    expect(out).toContain("without=max");
    expect(out).toContain('href="/products"');
    expect(out).toContain('href="/#ideas-title"');
    expect(out).toContain("בדקו את האיות");
  });

  it("says one product in the singular, and gives no number without blockers", () => {
    expect(fewResultsTitle(1)).toBe("מצאנו רק מוצר אחד שעבר את הסינון");
    const out = render(searchHelp(CHIPS, undefined));
    expect(out).toContain("נסו לחפש בלי ״סוניק״.");
    expect(out).not.toContain("<bdi");
  });
});
