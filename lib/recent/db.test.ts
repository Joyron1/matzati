import { describe, expect, it } from "vitest";
import {
  ADMIN_LIMIT,
  deleteHiddenSearch,
  HIDDEN_LIMIT,
  HIDDEN_TABLE,
  insertHiddenSearch,
  OTHER_LABEL_HE,
  queryNormSchema,
  RecentSearchesError,
  selectCategoryCounts,
  selectHiddenSearches,
  selectLatestRecentSearches,
  selectRecentSearchList,
  toCategoryCounts,
  toParsedQuery,
  toRecentQuery,
  toRecentSearch,
  toRecentSearches,
  type RecentClient,
} from "./db";
import { OTHER_CATEGORY, RECENT_MAX_PAGES, RECENT_PAGE_SIZE } from "./types";

type Result = { data: unknown; error: { message: string; code?: string } | null };
type Call = [method: string, ...args: unknown[]];

/** Records the PostgREST builder chain and answers with a canned result. */
class FakeQuery implements PromiseLike<Result> {
  calls: Call[] = [];
  constructor(
    readonly table: string,
    private readonly result: Result,
  ) {}
  private add(method: string, args: unknown[]) {
    this.calls.push([method, ...args]);
    return this;
  }
  upsert(...a: unknown[]) {
    return this.add("upsert", a);
  }
  delete(...a: unknown[]) {
    return this.add("delete", a);
  }
  eq(...a: unknown[]) {
    return this.add("eq", a);
  }
  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

/** rpc(fn) answers with rpc[fn] (default: no rows); from() answers with `table`. */
function fakeDb(rpc: Record<string, Result> = {}, table: Result = { data: null, error: null }) {
  const rpcCalls: [fn: string, args: unknown][] = [];
  const queries: FakeQuery[] = [];
  const db = {
    rpc(fn: string, args?: unknown) {
      rpcCalls.push([fn, args]);
      return Promise.resolve(rpc[fn] ?? { data: [], error: null });
    },
    from(name: string) {
      const q = new FakeQuery(name, table);
      queries.push(q);
      return q;
    },
  } as unknown as RecentClient;
  return { db, rpcCalls, queries };
}

const ok = (data: unknown): Result => ({ data, error: null });

const IMG = "https://ae-pic-a1.aliexpress-media.com/kf/S1.jpg";

const PARSED = {
  keywords_en: "running earbuds",
  product_terms: ["earbuds", "earphones"],
  product_he: "אוזניות לריצה",
  requirements: [{ en: "waterproof", alt: ["ipx"], he: "עמידות למים" }],
  max_price_ils: 100,
  sort_preference: "best_value",
  category_hint: "earphones",
};

const ROW = {
  query_norm: "אוזניות לריצה עמידות למים עד ₪100",
  query: "אוזניות לריצה, עמידות למים, עד 100 ש״ח",
  parsed: PARSED,
  category_id: "44",
  results_count: 3,
  searched_at: "2026-09-27T11:59:27.877913+00:00",
  images: [
    { src: IMG, alt: "אוזניות ספורט" },
    { src: "https://ae-pic-a1.aliexpress-media.com/kf/S2.jpg", alt: null },
    { src: "https://ae-pic-a1.aliexpress-media.com/kf/S3.jpg", alt: "  " },
  ],
};

const CARD = {
  queryNorm: ROW.query_norm,
  query: ROW.query,
  chips: [
    { id: "product", kind: "keywords", label_he: "אוזניות לריצה", removable: false },
    { id: "req:waterproof", kind: "must_have", label_he: "עמידות למים", removable: true },
    { id: "max", kind: "max_price", label_he: "עד ₪100", removable: true },
  ],
  categoryId: "44",
  categoryHe: "מוצרי אלקטרוניקה",
  images: [
    { src: IMG, alt: "אוזניות ספורט" },
    { src: "https://ae-pic-a1.aliexpress-media.com/kf/S2.jpg", alt: "אוזניות לריצה" },
    { src: "https://ae-pic-a1.aliexpress-media.com/kf/S3.jpg", alt: "אוזניות לריצה" },
  ],
  resultsCount: 3,
  // Rounded down to the hour.
  searchedAt: "2026-09-27T11:00:00.000Z",
};

/** A card row for query `n`, newest first when n grows. */
const row = (n: number, extra: Partial<typeof ROW> = {}) => ({
  ...ROW,
  query_norm: `חיפוש ${n}`,
  query: `חיפוש ${n}`,
  ...extra,
});

describe("toParsedQuery", () => {
  it("keeps the stored parse and leaves out absent or null price bounds", () => {
    const parsed = toParsedQuery({ ...PARSED, min_price_ils: null });
    expect(parsed).toEqual(PARSED);
    expect(parsed && "min_price_ils" in parsed).toBe(false);
    expect(toParsedQuery({ ...PARSED, category_hint: null })).not.toHaveProperty("category_hint");
  });

  it("rejects a parse without a product label or with a malformed field", () => {
    expect(toParsedQuery({ ...PARSED, product_he: " " })).toBe(null);
    expect(toParsedQuery({ ...PARSED, requirements: [{ en: "x", he: "y" }] })).toBe(null);
    expect(toParsedQuery({ ...PARSED, requirements: [{ en: "x", alt: [], he: "" }] })).toBe(null);
    expect(toParsedQuery({ ...PARSED, max_price_ils: "100" })).toBe(null);
    expect(toParsedQuery({ ...PARSED, max_price_ils: -5 })).toBe(null);
    expect(toParsedQuery({ ...PARSED, sort_preference: "random" })).toBe(null);
    expect(toParsedQuery(null)).toBe(null);
    expect(toParsedQuery("{}")).toBe(null);
  });
});

describe("toRecentSearch", () => {
  it("maps a row to a card: chips from the parse, Hebrew category, photos, ISO time", () => {
    expect(toRecentSearch(ROW)).toEqual(CARD);
  });

  it("never gives the exact time: it is rounded down to the hour", () => {
    const at = (searched_at: string) => toRecentSearch({ ...ROW, searched_at })?.searchedAt;
    expect(at("2026-09-27T14:59:59.999+03:00")).toBe("2026-09-27T11:00:00.000Z");
    expect(at("2026-09-27T12:00:00Z")).toBe("2026-09-27T12:00:00.000Z");
  });

  it("builds a minimum price chip too", () => {
    const card = toRecentSearch({
      ...ROW,
      parsed: { ...PARSED, requirements: [], min_price_ils: 50, max_price_ils: 200 },
    });
    expect(card?.chips.map((c) => c.label_he)).toEqual(["אוזניות לריצה", "מ־₪50", "עד ₪200"]);
  });

  it("skips a row whose query fails the privacy check at read time", () => {
    expect(toRecentSearch({ ...ROW, query: "מטען 0501234567" })).toBe(null);
    expect(toRecentSearch({ ...ROW, query: "@dani" })).toBe(null);
    expect(toRecentSearch({ ...ROW, query: "shop.co.il" })).toBe(null);
    expect(toRecentSearch({ ...ROW, query: " " })).toBe(null);
  });

  it("skips a row with an invalid parse, no results or the wrong shape", () => {
    expect(toRecentSearch({ ...ROW, parsed: { product_he: "x" } })).toBe(null);
    expect(toRecentSearch({ ...ROW, parsed: null })).toBe(null);
    expect(toRecentSearch({ ...ROW, results_count: 0 })).toBe(null);
    expect(toRecentSearch({ ...ROW, query_norm: "" })).toBe(null);
    expect(toRecentSearch({ ...ROW, searched_at: "yesterday" })).toBe(null);
    expect(toRecentSearch({ ...ROW, category_id: 44 })).toBe(null);
    expect(toRecentSearch(null)).toBe(null);
  });

  it("caps results at 3 and reads a count sent as a string", () => {
    expect(toRecentSearch({ ...ROW, results_count: 7 })?.resultsCount).toBe(3);
    expect(toRecentSearch({ ...ROW, results_count: "2" })?.resultsCount).toBe(2);
  });

  it("has no Hebrew category for an unknown, unnamed or malformed id", () => {
    const unknown = toRecentSearch({ ...ROW, category_id: null });
    expect([unknown?.categoryId, unknown?.categoryHe]).toEqual([null, null]);
    const unnamed = toRecentSearch({ ...ROW, category_id: "987654" });
    expect([unnamed?.categoryId, unnamed?.categoryHe]).toEqual(["987654", null]);
    const malformed = toRecentSearch({ ...ROW, category_id: "44; drop" });
    expect([malformed?.categoryId, malformed?.categoryHe]).toEqual([null, null]);
  });

  it("keeps only photos next/image can load, one per URL, at most 3", () => {
    const card = toRecentSearch({
      ...ROW,
      images: [
        { src: "http://ae-pic-a1.aliexpress-media.com/kf/insecure.jpg", alt: "a" },
        { src: "https://evil.example/kf/S1.jpg", alt: "b" },
        { src: "not a url", alt: "c" },
        { src: IMG, alt: "d" },
        { src: IMG, alt: "duplicate" },
        { alt: "no src" },
        { src: "https://ae-pic-a1.aliexpress-media.com/kf/S5.jpg", alt: "e" },
        { src: "https://ae-pic-a1.aliexpress-media.com/kf/S6.jpg", alt: "f" },
        { src: "https://ae-pic-a1.aliexpress-media.com/kf/S7.jpg", alt: "g" },
      ],
    });
    expect(card?.images.map((i) => i.alt)).toEqual(["d", "e", "f"]);
  });

  it("shows a card without photos when images are missing", () => {
    expect(toRecentSearch({ ...ROW, images: null })?.images).toEqual([]);
    expect(toRecentSearch({ ...ROW, images: "[]" })?.images).toEqual([]);
  });
});

describe("toRecentSearches", () => {
  it("keeps row order, drops bad rows and keeps one card per normalized query", () => {
    const cards = toRecentSearches([
      row(3),
      { ...row(2), parsed: null },
      row(1),
      { ...row(3), query: "חיפוש 3 ישן" },
    ]);
    expect(cards.map((c) => c.query)).toEqual(["חיפוש 3", "חיפוש 1"]);
  });
});

describe("toCategoryCounts", () => {
  it("names known categories and folds unnamed and unknown ones into one bucket", () => {
    const { categories, otherIds } = toCategoryCounts([
      { category_id: "44", cards: 5 },
      { category_id: "987654", cards: 2 },
      { category_id: null, cards: 2 },
      { category_id: "26", cards: 3 },
      { category_id: "not-an-id", cards: 1 },
      { category_id: "18", cards: 0 },
      { cards: 9 },
    ]);
    expect(categories).toEqual([
      { id: "44", labelHe: "מוצרי אלקטרוניקה", count: 5 },
      { id: OTHER_CATEGORY, labelHe: OTHER_LABEL_HE, count: 5 },
      { id: "26", labelHe: "צעצועים ומוצרי תחביב", count: 3 },
    ]);
    // A malformed id is still sent with "אחר", so that filter finds every card the bucket counts.
    expect(otherIds).toEqual(["987654", "not-an-id"]);
  });

  it("puts the other bucket after named categories with the same count", () => {
    const { categories } = toCategoryCounts([
      { category_id: null, cards: 2 },
      { category_id: "44", cards: 2 },
      { category_id: "26", cards: "2" },
    ]);
    expect(categories.map((c) => c.id)).toEqual(["44", "26", OTHER_CATEGORY]);
  });

  it("orders named categories with the same count by their Hebrew name", () => {
    const { categories } = toCategoryCounts([
      { category_id: "44", cards: 1 }, // מוצרי אלקטרוניקה
      { category_id: "1511", cards: 1 }, // שעונים
      { category_id: "322", cards: 1 }, // נעליים
    ]);
    expect(categories.map((c) => c.labelHe)).toEqual(["מוצרי אלקטרוניקה", "נעליים", "שעונים"]);
  });

  it("has no other bucket when every category is named", () => {
    expect(toCategoryCounts([{ category_id: "44", cards: 1 }]).categories).toHaveLength(1);
    expect(toCategoryCounts([])).toEqual({ categories: [], otherIds: [] });
  });
});

describe("toRecentQuery", () => {
  it("keeps a named category and the other bucket", () => {
    expect(toRecentQuery({ category: "44", page: 1 })).toEqual({
      category: "44",
      text: null,
      page: 1,
    });
    expect(toRecentQuery({ category: OTHER_CATEGORY, page: 2 }).category).toBe(OTHER_CATEGORY);
  });

  it("files an unnamed id under other and drops a malformed one", () => {
    expect(toRecentQuery({ category: "987654", page: 1 }).category).toBe(OTHER_CATEGORY);
    expect(toRecentQuery({ category: "abc", page: 1 }).category).toBe(null);
    expect(toRecentQuery({ category: "", page: 1 }).category).toBe(null);
  });

  it("normalizes the text like the search cache does, so equivalent filters share a key", () => {
    const a = toRecentQuery({ text: "  אוזניות,   עד 100 ש״ח ", page: 1 });
    const b = toRecentQuery({ text: "אוזניות עד ₪100", page: 1 });
    expect(a).toEqual({ category: null, text: "אוזניות עד ₪100", page: 1 });
    expect(b).toEqual(a);
    expect(toRecentQuery({ text: " ?! ", page: 1 }).text).toBe(null);
  });

  it("clamps the page", () => {
    expect(toRecentQuery({ page: 0 }).page).toBe(1);
    expect(toRecentQuery({ page: 2.5 }).page).toBe(1);
    expect(toRecentQuery({ page: 999 }).page).toBe(RECENT_MAX_PAGES);
  });
});

describe("selectRecentSearchList", () => {
  const CATEGORIES = ok([
    { category_id: "44", cards: 3 },
    { category_id: "987654", cards: 1 },
    { category_id: "555", cards: 1 },
    { category_id: null, cards: 1 },
  ]);

  it("reads categories, then one more card than the page shows", async () => {
    const { db, rpcCalls } = fakeDb({
      recent_search_categories: CATEGORIES,
      recent_searches: ok([row(2), row(1)]),
    });
    const list = await selectRecentSearchList(db, { category: null, text: null, page: 1 });
    expect(list.items.map((c) => c.query)).toEqual(["חיפוש 2", "חיפוש 1"]);
    expect(list.hasMore).toBe(false);
    expect(list.categories.map((c) => [c.id, c.count])).toEqual([
      ["44", 3],
      [OTHER_CATEGORY, 3],
    ]);
    expect(rpcCalls).toEqual([
      ["recent_search_categories", undefined],
      [
        "recent_searches",
        {
          p_limit: RECENT_PAGE_SIZE + 1,
          p_category_ids: null,
          p_include_unknown: false,
          p_text: null,
        },
      ],
    ]);
  });

  it("uses category counts it is given instead of reading them", async () => {
    const { db, rpcCalls } = fakeDb({ recent_searches: ok([row(1)]) });
    const counts = Promise.resolve({
      categories: [{ id: "44", labelHe: "מוצרי אלקטרוניקה", count: 1 }],
      otherIds: ["987654"],
    });
    const list = await selectRecentSearchList(
      db,
      { category: OTHER_CATEGORY, text: null, page: 1 },
      counts,
    );
    expect(list.categories.map((c) => c.id)).toEqual(["44"]);
    expect(rpcCalls.map(([fn]) => fn)).toEqual(["recent_searches"]);
    expect(rpcCalls[0][1]).toMatchObject({ p_category_ids: ["987654"], p_include_unknown: true });
  });

  it("filters by one named category and passes the normalized text", async () => {
    const { db, rpcCalls } = fakeDb({ recent_search_categories: CATEGORIES });
    await selectRecentSearchList(db, { category: "44", text: "אוזניות", page: 2 });
    expect(rpcCalls[1][1]).toEqual({
      p_limit: 2 * RECENT_PAGE_SIZE + 1,
      p_category_ids: ["44"],
      p_include_unknown: false,
      p_text: "אוזניות",
    });
  });

  it("asks for the unnamed ids plus unknown ones for the other bucket", async () => {
    const { db, rpcCalls } = fakeDb({ recent_search_categories: CATEGORIES });
    await selectRecentSearchList(db, { category: OTHER_CATEGORY, text: null, page: 1 });
    expect(rpcCalls[1][1]).toMatchObject({
      p_category_ids: ["987654", "555"],
      p_include_unknown: true,
    });
  });

  it("reports more cards while under the last page, and never on it", async () => {
    const full = (n: number) => ok(Array.from({ length: n }, (_, i) => row(n - i)));

    const first = fakeDb({ recent_searches: full(RECENT_PAGE_SIZE + 1) });
    const page1 = await selectRecentSearchList(first.db, { category: null, text: null, page: 1 });
    expect(page1.items).toHaveLength(RECENT_PAGE_SIZE);
    expect(page1.hasMore).toBe(true);

    const exact = fakeDb({ recent_searches: full(RECENT_PAGE_SIZE) });
    const onlyPage = await selectRecentSearchList(exact.db, {
      category: null,
      text: null,
      page: 1,
    });
    expect(onlyPage.hasMore).toBe(false);

    const shown = RECENT_MAX_PAGES * RECENT_PAGE_SIZE;
    const last = fakeDb({ recent_searches: full(shown + 1) });
    const lastPage = await selectRecentSearchList(last.db, {
      category: null,
      text: null,
      page: RECENT_MAX_PAGES,
    });
    expect(lastPage.items).toHaveLength(shown);
    expect(lastPage.hasMore).toBe(false);
  });

  it("decides hasMore from the rows the database sent, even when some are skipped", async () => {
    const rows = Array.from({ length: RECENT_PAGE_SIZE + 1 }, (_, i) =>
      i === 0 ? { ...row(99), parsed: null } : row(RECENT_PAGE_SIZE - i),
    );
    const { db } = fakeDb({ recent_searches: ok(rows) });
    const list = await selectRecentSearchList(db, { category: null, text: null, page: 1 });
    expect(list.items).toHaveLength(RECENT_PAGE_SIZE - 1);
    expect(list.hasMore).toBe(true);
  });

  it("throws RecentSearchesError on a database error or an unexpected response", async () => {
    await expect(
      selectRecentSearchList(
        fakeDb({ recent_search_categories: { data: null, error: { message: "boom" } } }).db,
        { category: null, text: null, page: 1 },
      ),
    ).rejects.toBeInstanceOf(RecentSearchesError);
    await expect(
      selectRecentSearchList(fakeDb({ recent_searches: ok({ rows: [] }) }).db, {
        category: null,
        text: null,
        page: 1,
      }),
    ).rejects.toBeInstanceOf(RecentSearchesError);
  });

  it("reads a null response as no rows", async () => {
    const { db } = fakeDb({ recent_search_categories: ok(null), recent_searches: ok(null) });
    expect(await selectRecentSearchList(db, { category: null, text: null, page: 1 })).toEqual({
      items: [],
      hasMore: false,
      categories: [],
    });
  });
});

describe("selectCategoryCounts", () => {
  it("calls recent_search_categories", async () => {
    const { db, rpcCalls } = fakeDb({
      recent_search_categories: ok([{ category_id: "44", cards: 1 }]),
    });
    expect((await selectCategoryCounts(db)).categories).toHaveLength(1);
    expect(rpcCalls).toEqual([["recent_search_categories", undefined]]);
  });
});

describe("selectLatestRecentSearches", () => {
  it("asks for the newest cards without filters", async () => {
    const { db, rpcCalls } = fakeDb({ recent_searches: ok([row(2), row(1)]) });
    expect((await selectLatestRecentSearches(db, 6)).map((c) => c.query)).toEqual([
      "חיפוש 2",
      "חיפוש 1",
    ]);
    expect(rpcCalls).toEqual([
      [
        "recent_searches",
        { p_limit: 6, p_category_ids: null, p_include_unknown: false, p_text: null },
      ],
    ]);
  });

  it("passes a normalized text filter (the admin list)", async () => {
    const { db, rpcCalls } = fakeDb();
    await selectLatestRecentSearches(db, ADMIN_LIMIT, "אוזניות");
    expect(rpcCalls[0][1]).toEqual({
      p_limit: RECENT_MAX_PAGES * RECENT_PAGE_SIZE,
      p_category_ids: null,
      p_include_unknown: false,
      p_text: "אוזניות",
    });
  });

  it("throws on a database error", async () => {
    const { db } = fakeDb({ recent_searches: { data: null, error: { message: "down" } } });
    await expect(selectLatestRecentSearches(db, 6)).rejects.toBeInstanceOf(RecentSearchesError);
  });
});

describe("hidden searches (admin)", () => {
  it("lists hidden searches with their latest spelling, skipping bad rows", async () => {
    const { db, rpcCalls } = fakeDb({
      recent_searches_hidden: ok([
        { query_norm: "בובת סוניק", hidden_at: "2026-09-27T20:00:00+00:00", query: "בובת סוניק!" },
        { query_norm: "ישן", hidden_at: "2026-09-26T20:00:00+00:00", query: null },
        { query_norm: "", hidden_at: "2026-09-26T20:00:00+00:00", query: null },
      ]),
    });
    expect(await selectHiddenSearches(db)).toEqual([
      { queryNorm: "בובת סוניק", hiddenAt: "2026-09-27T20:00:00.000Z", query: "בובת סוניק!" },
      { queryNorm: "ישן", hiddenAt: "2026-09-26T20:00:00.000Z", query: null },
    ]);
    expect(rpcCalls).toEqual([["recent_searches_hidden", { p_limit: HIDDEN_LIMIT }]]);
    expect(HIDDEN_LIMIT).toBe(500); // the SQL clamp
  });

  it("hides by upsert, keeping the first hide time", async () => {
    const { db, queries } = fakeDb();
    await insertHiddenSearch(db, "בובת סוניק");
    expect(queries[0].table).toBe(HIDDEN_TABLE);
    expect(queries[0].calls).toEqual([
      [
        "upsert",
        { query_norm: "בובת סוניק" },
        { onConflict: "query_norm", ignoreDuplicates: true },
      ],
    ]);
  });

  it("restores by deleting the row", async () => {
    const { db, queries } = fakeDb();
    await deleteHiddenSearch(db, "בובת סוניק");
    expect(queries[0].calls).toEqual([["delete"], ["eq", "query_norm", "בובת סוניק"]]);
  });

  it("never writes a value that cannot be a normalized query", async () => {
    const { db, queries } = fakeDb();
    for (const bad of ["", " padded ", "x".repeat(401)]) {
      await insertHiddenSearch(db, bad);
      await deleteHiddenSearch(db, bad);
    }
    expect(queries).toHaveLength(0);
  });

  it("throws RecentSearchesError when a write fails", async () => {
    const { db } = fakeDb({}, { data: null, error: { message: "permission denied" } });
    await expect(insertHiddenSearch(db, "abc")).rejects.toBeInstanceOf(RecentSearchesError);
    await expect(deleteHiddenSearch(db, "abc")).rejects.toBeInstanceOf(RecentSearchesError);
  });
});

describe("queryNormSchema", () => {
  it("accepts normalized text and rejects empty, padded or oversized values", () => {
    expect(queryNormSchema.safeParse("אוזניות עד ₪100").success).toBe(true);
    expect(queryNormSchema.safeParse("").success).toBe(false);
    expect(queryNormSchema.safeParse(" x").success).toBe(false);
    expect(queryNormSchema.safeParse("x".repeat(401)).success).toBe(false);
    expect(queryNormSchema.safeParse(42).success).toBe(false);
  });
});
