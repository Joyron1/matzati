import { describe, expect, it } from "vitest";
import {
  insertSeoPage,
  removeSeoPage,
  SEO_COLUMNS,
  SEO_TABLE,
  SeoDbError,
  SeoPageNotFoundError,
  SeoSlugTakenError,
  selectAllSeoPages,
  selectPublishedSeoPage,
  selectPublishedSeoPages,
  selectResultsFetchedAt,
  selectSeoPage,
  toSeoPage,
  updateSeoPage,
  type SeoClient,
  type SeoPageInput,
} from "./db";

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
  select(...a: unknown[]) {
    return this.add("select", a);
  }
  insert(...a: unknown[]) {
    return this.add("insert", a);
  }
  update(...a: unknown[]) {
    return this.add("update", a);
  }
  delete(...a: unknown[]) {
    return this.add("delete", a);
  }
  eq(...a: unknown[]) {
    return this.add("eq", a);
  }
  order(...a: unknown[]) {
    return this.add("order", a);
  }
  limit(...a: unknown[]) {
    return this.add("limit", a);
  }
  single() {
    return this.add("single", []);
  }
  maybeSingle() {
    return this.add("maybeSingle", []);
  }
  then<A = Result, B = never>(
    onfulfilled?: ((value: Result) => A | PromiseLike<A>) | null,
    onrejected?: ((reason: unknown) => B | PromiseLike<B>) | null,
  ): PromiseLike<A | B> {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function fakeDb(result: Result = { data: [], error: null }) {
  const queries: FakeQuery[] = [];
  const db = {
    from(table: string) {
      const q = new FakeQuery(table, result);
      queries.push(q);
      return q;
    },
  } as unknown as SeoClient;
  return { db, queries };
}

const ROW = {
  slug: "אוזניות-לריצה",
  query: "אוזניות לריצה",
  title_he: "אוזניות לריצה",
  intro_he: "פתיח",
  published: true,
  created_at: "2026-09-27T10:00:00+00:00",
  updated_at: "2026-09-27T12:30:00+00:00",
};

const PAGE = {
  ...ROW,
  created_at: "2026-09-27T10:00:00.000Z",
  updated_at: "2026-09-27T12:30:00.000Z",
};

const INPUT: SeoPageInput = {
  slug: "אוזניות-לריצה",
  query: "אוזניות לריצה",
  title_he: "אוזניות לריצה",
  intro_he: null,
  published: false,
};

describe("toSeoPage", () => {
  it("normalizes timestamps and keeps the fields", () => {
    expect(toSeoPage(ROW)).toEqual(PAGE);
  });

  it("turns a blank intro into null", () => {
    expect(toSeoPage({ ...ROW, intro_he: "  " })?.intro_he).toBe(null);
    expect(toSeoPage({ ...ROW, intro_he: null })?.intro_he).toBe(null);
  });

  it("skips rows with the wrong shape or an invalid slug", () => {
    expect(toSeoPage({ ...ROW, slug: "Bad Slug" })).toBe(null);
    expect(toSeoPage({ ...ROW, published: "yes" })).toBe(null);
    expect(toSeoPage({ ...ROW, updated_at: "not a date" })).toBe(null);
    expect(toSeoPage(null)).toBe(null);
  });
});

describe("public reads", () => {
  it("selects one published page by slug", async () => {
    const { db, queries } = fakeDb({ data: ROW, error: null });
    expect(await selectPublishedSeoPage(db, "אוזניות-לריצה")).toEqual(PAGE);
    expect(queries[0].table).toBe(SEO_TABLE);
    expect(queries[0].calls).toEqual([
      ["select", SEO_COLUMNS],
      ["eq", "slug", "אוזניות-לריצה"],
      ["eq", "published", true],
      ["maybeSingle"],
    ]);
  });

  it("never returns a draft, even if the database did", async () => {
    const { db } = fakeDb({ data: { ...ROW, published: false }, error: null });
    expect(await selectPublishedSeoPage(db, "אוזניות-לריצה")).toBe(null);
  });

  it("returns null for a missing page", async () => {
    const { db } = fakeDb({ data: null, error: null });
    expect(await selectPublishedSeoPage(db, "אוזניות-לריצה")).toBe(null);
  });

  it("does not query for a slug that cannot exist", async () => {
    const { db, queries } = fakeDb();
    expect(await selectPublishedSeoPage(db, "../admin")).toBe(null);
    expect(queries).toHaveLength(0);
  });

  it("throws on a database error (not a 404)", async () => {
    const { db } = fakeDb({ data: null, error: { message: "boom" } });
    await expect(selectPublishedSeoPage(db, "abc")).rejects.toBeInstanceOf(SeoDbError);
  });

  it("lists published pages newest first, with a limit, dropping drafts and bad rows", async () => {
    const { db, queries } = fakeDb({
      data: [ROW, { ...ROW, slug: "b", published: false }, { ...ROW, slug: "Bad Slug" }],
      error: null,
    });
    expect(await selectPublishedSeoPages(db, 8)).toEqual([PAGE]);
    expect(queries[0].calls).toEqual([
      ["select", SEO_COLUMNS],
      ["eq", "published", true],
      ["order", "created_at", { ascending: false }],
      ["limit", 8],
    ]);
  });
});

describe("admin", () => {
  it("lists every page, most recently updated first", async () => {
    const { db, queries } = fakeDb({
      data: [ROW, { ...ROW, slug: "b", published: false }],
      error: null,
    });
    const pages = await selectAllSeoPages(db);
    expect(pages.map((p) => p.slug)).toEqual(["אוזניות-לריצה", "b"]);
    expect(queries[0].calls[1]).toEqual(["order", "updated_at", { ascending: false }]);
  });

  it("gets one page by slug, drafts included", async () => {
    const { db, queries } = fakeDb({ data: { ...ROW, published: false }, error: null });
    expect((await selectSeoPage(db, "אוזניות-לריצה"))?.published).toBe(false);
    expect(queries[0].calls).toEqual([
      ["select", SEO_COLUMNS],
      ["eq", "slug", "אוזניות-לריצה"],
      ["maybeSingle"],
    ]);
  });

  it("inserts and returns the saved page", async () => {
    const { db, queries } = fakeDb({ data: ROW, error: null });
    expect(await insertSeoPage(db, INPUT)).toEqual(PAGE);
    expect(queries[0].calls).toEqual([["insert", INPUT], ["select", SEO_COLUMNS], ["single"]]);
  });

  it("maps a primary key clash to SeoSlugTakenError", async () => {
    const { db } = fakeDb({ data: null, error: { message: "duplicate key", code: "23505" } });
    await expect(insertSeoPage(db, INPUT)).rejects.toBeInstanceOf(SeoSlugTakenError);
  });

  it("updates by the original slug (which the input may rename)", async () => {
    const { db, queries } = fakeDb({ data: { ...ROW, slug: "חדש" }, error: null });
    const renamed = { ...INPUT, slug: "חדש" };
    expect((await updateSeoPage(db, "אוזניות-לריצה", renamed)).slug).toBe("חדש");
    expect(queries[0].calls).toEqual([
      ["update", renamed],
      ["eq", "slug", "אוזניות-לריצה"],
      ["select", SEO_COLUMNS],
      ["maybeSingle"],
    ]);
  });

  it("reports an update of a missing page and a rename onto a taken slug", async () => {
    await expect(
      updateSeoPage(fakeDb({ data: null, error: null }).db, "abc", INPUT),
    ).rejects.toBeInstanceOf(SeoPageNotFoundError);
    await expect(
      updateSeoPage(
        fakeDb({ data: null, error: { message: "dup", code: "23505" } }).db,
        "abc",
        INPUT,
      ),
    ).rejects.toBeInstanceOf(SeoSlugTakenError);
    await expect(updateSeoPage(fakeDb().db, "not a slug", INPUT)).rejects.toBeInstanceOf(
      SeoPageNotFoundError,
    );
  });

  it("other database errors stay SeoDbError", async () => {
    const { db } = fakeDb({ data: null, error: { message: "check violation", code: "23514" } });
    await expect(insertSeoPage(db, INPUT)).rejects.toBeInstanceOf(SeoDbError);
  });

  it("deletes by slug and ignores slugs that cannot exist", async () => {
    const { db, queries } = fakeDb({ data: null, error: null });
    await removeSeoPage(db, "abc");
    expect(queries[0].calls).toEqual([["delete"], ["eq", "slug", "abc"]]);
    await removeSeoPage(db, "a b");
    expect(queries).toHaveLength(1);
  });
});

describe("selectResultsFetchedAt", () => {
  const KEY = "a".repeat(64);

  it("reads created_at of the cached results", async () => {
    const { db, queries } = fakeDb({
      data: { created_at: "2026-09-27T09:00:00+00:00" },
      error: null,
    });
    expect(await selectResultsFetchedAt(db, KEY)).toBe("2026-09-27T09:00:00.000Z");
    expect(queries[0].table).toBe("search_cache");
    expect(queries[0].calls).toEqual([
      ["select", "created_at"],
      ["eq", "filters_key", KEY],
      ["maybeSingle"],
    ]);
  });

  it("returns null for a missing row or a key that is not a filters key", async () => {
    expect(await selectResultsFetchedAt(fakeDb({ data: null, error: null }).db, KEY)).toBe(null);
    const { db, queries } = fakeDb();
    expect(await selectResultsFetchedAt(db, "nope")).toBe(null);
    expect(queries).toHaveLength(0);
  });
});
