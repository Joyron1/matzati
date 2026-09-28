// The first page of results streams its lines (plan item 15): rendered on the server with the
// lines still being written, the cards come in the first chunk with AliExpress's title, a "being
// written" placeholder and room kept for the lines; the lines follow in a later chunk, in place.
import { createElement } from "react";
import { renderToReadableStream } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { LoggedResult } from "@/lib/search-url";
import { WRITING_LINE } from "./card-lines";
import {
  finishedAnnouncement,
  LINES_ARRIVED,
  linesArrived,
  ORDER_CHANGED,
  ResultCards,
} from "./result-cards";

const result = (i: number): LoggedResult => ({
  product_id: `100500${i}`,
  title_he: `USB C Cable ${i}00W Fast Charging`,
  title_en: `USB C Cable ${i}00W Fast Charging`,
  why_he: `98% משוב חיובי ו־${i},000 נמכרו ב־30 הימים האחרונים.`,
  price_ils: 10 + i,
  original_price_ils: null,
  price_is_approx: false,
  discount_pct: null,
  positive_feedback_pct: 98,
  units_sold: i * 1000,
  passed_tier: "standard",
  image_urls: [],
  category_id: "44",
  search_uid: "0b7e6f55-2f0c-4a53-9d7c-3f7c1d1e2a10",
});

const INITIAL = [1, 2, 3].map(result);
const WRITTEN = [
  "כבל טעינה מהיר שעבר את כל הסינונים שלנו.",
  "כבל שנמכר הרבה בחודש האחרון, עם משוב טוב.",
  "כבל שימושי לטעינה יומיומית, עם קונים מרוצים.",
];
const DONE = INITIAL.map((r, i) => ({ ...r, title_he: `כבל טעינה ${i + 1}`, why_he: WRITTEN[i] }));

/** Hebrew text as React writes it into HTML (no entities for these letters). */
const text = (html: string) => html.replace(/<!-- -->/g, "");

/** Reads a stream in two parts: what it has now, and the rest once it ends. */
function chunks(stream: ReadableStream<Uint8Array>) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  // A read that did not finish in time is kept for the next call, so no chunk is lost.
  let pending: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;
  const read = () => (pending ??= reader.read());
  return {
    /** Every chunk the stream has now, without waiting for the ones that need more data. */
    async available(): Promise<string> {
      let out = "";
      for (;;) {
        const next = await Promise.race([
          read(),
          new Promise<null>((resolve) => setTimeout(() => resolve(null), 50)),
        ]);
        if (next === null) return out;
        pending = null;
        if (next.done) return out;
        out += decoder.decode(next.value, { stream: true });
      }
    },
    async rest(): Promise<string> {
      let out = "";
      for (;;) {
        const { value, done } = await read();
        pending = null;
        if (done) return out;
        out += decoder.decode(value, { stream: true });
      }
    },
  };
}

describe("ResultCards", () => {
  it("renders the products before their lines are written, then streams the lines in", async () => {
    let finish!: (done: LoggedResult[] | null) => void;
    const final = new Promise<LoggedResult[] | null>((resolve) => (finish = resolve));
    const stream = await renderToReadableStream(
      createElement(ResultCards, { initial: INITIAL, final, q: "כבל USB" }),
    );
    const read = chunks(stream);

    const first = text(await read.available());
    for (const r of INITIAL) {
      // The card, its buy button and /go link, and AliExpress's title, left to right and in
      // English, so a two-line clamp cuts it at its own end.
      expect(first).toContain(
        `<span dir="ltr" lang="en" class="text-end line-clamp-2">${r.title_en}`,
      );
      expect(first).toContain(`/go/${r.product_id}`);
      // Where its line will be, that it is being written: not the numbers the card shows anyway.
      expect(first).not.toContain(r.why_he);
    }
    expect(first.split(WRITING_LINE)).toHaveLength(INITIAL.length + 1);
    for (const line of WRITTEN) expect(first).not.toContain(line);
    // Room kept for the lines, so they replace the first ones without moving the page: two title
    // lines; on phones four line lines in the featured box and three in a compact card (four under
    // 340 px), two from sm.
    expect(first).toContain("min-h-[2lh]");
    expect(first).toContain("min-h-[calc(4lh_+_1.5rem)] sm:min-h-[calc(2lh_+_1.5rem)]");
    expect(first).toContain("min-h-[4lh] min-[340px]:min-h-[3lh] sm:min-h-[2lh]");

    finish(DONE);
    const later = text(await read.rest());
    for (const [i, line] of WRITTEN.entries()) {
      expect(later).toContain(line);
      expect(later).toContain(`כבל טעינה ${i + 1}`);
    }
  });

  it("shows the lines from the data when the lines cannot be finished", async () => {
    const stream = await renderToReadableStream(
      createElement(ResultCards, { initial: INITIAL, final: Promise.resolve(null), q: "כבל USB" }),
    );
    const html = text(await chunks(stream).rest());
    for (const r of INITIAL) expect(html).toContain(r.why_he);
  });

  it("renders a page whose lines are all written at once, without room kept for them", async () => {
    const stream = await renderToReadableStream(
      createElement(ResultCards, { initial: DONE, q: "כבל USB" }),
    );
    const html = text(await chunks(stream).rest());
    for (const line of WRITTEN) expect(html).toContain(line);
    expect(html).not.toContain("min-h-[3lh]");
  });
});

describe("linesArrived (said once, politely, when the lines come)", () => {
  it("is true only when the finished results say something new", () => {
    expect(linesArrived(INITIAL, DONE)).toBe(true);
    // The explain call failed: the lines from the data stay, and nothing is announced.
    expect(linesArrived(INITIAL, INITIAL)).toBe(false);
    expect(LINES_ARRIVED).toBe("הוספנו לכל מוצר משפט קצר על הסיבה שבחרנו בו.");
  });

  it("also says when the safety net changed the order", () => {
    expect(finishedAnnouncement(INITIAL, DONE)).toBe(LINES_ARRIVED);
    expect(finishedAnnouncement(INITIAL, INITIAL)).toBe("");
    const moved = [DONE[1], DONE[2], { ...result(4), why_he: "95% משוב חיובי." }];
    expect(finishedAnnouncement(INITIAL, moved)).toBe(`${LINES_ARRIVED} ${ORDER_CHANGED}`);
  });
});
