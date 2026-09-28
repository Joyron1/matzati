import { describe, expect, it } from "vitest";
import {
  insertSeoPage,
  isMissingColumnError,
  removeSeoPage,
  SEO_COLUMNS,
  SEO_TABLE,
  SeoDbError,
  SeoPageNotFoundError,
  SeoSlugTakenError,
  selectAllSeoPages,
  selectPublishedSeoPage,
  selectPublishedSeoPages,
  selectPublishedSnapshot,
  selectSeoPage,
  selectSnapshotStatuses,
  SNAPSHOT_COLUMNS,
  supabaseSnapshotStore,
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
  is(...a: unknown[]) {
    return this.add("is", a);
  }
  or(...a: unknown[]) {
    return this.add("or", a);
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

describe("stored results (snapshots)", () => {
  const SLUG = "אוזניות-לריצה";
  // As PostgREST returns a timestamptz: kept exactly, for the write's compare-and-set.
  const RAW_AT = "2026-09-28T10:00:00.123456+00:00";
  const RESULTS = { query: "אוזניות לריצה", results: [{ product_id: "1" }] };

  it("reads a published page's results and results_at (anon), results_at as stored", async () => {
    const { db, queries } = fakeDb({ data: { results: RESULTS, results_at: RAW_AT }, error: null });
    expect(await selectPublishedSnapshot(db, SLUG)).toEqual({
      results: RESULTS,
      resultsAt: RAW_AT,
    });
    expect(queries[0].calls).toEqual([
      ["select", SNAPSHOT_COLUMNS],
      ["eq", "slug", SLUG],
      ["eq", "published", true],
      ["maybeSingle"],
    ]);
    expect(SNAPSHOT_COLUMNS).not.toContain("refresh_");
  });

  it("reads nothing stored as null, and never queries a slug that cannot exist", async () => {
    expect(await selectPublishedSnapshot(fakeDb({ data: null, error: null }).db, SLUG)).toBe(null);
    const nothing = fakeDb({ data: { results: null, results_at: null }, error: null });
    expect(await selectPublishedSnapshot(nothing.db, SLUG)).toEqual({
      results: null,
      resultsAt: null,
    });
    const { db, queries } = fakeDb();
    expect(await selectPublishedSnapshot(db, "../x")).toBe(null);
    expect(queries).toHaveLength(0);
  });

  it("tells a missing column (migration not applied) from other failures", async () => {
    const missing = fakeDb({ data: null, error: { message: "no column", code: "42703" } });
    const err = await selectPublishedSnapshot(missing.db, SLUG).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SeoDbError);
    expect(isMissingColumnError(err)).toBe(true);
    expect(isMissingColumnError(new SeoDbError("x", "PGRST204"))).toBe(true);
    expect(isMissingColumnError(new SeoDbError("timeout"))).toBe(false);
    expect(isMissingColumnError(new Error("42703"))).toBe(false);
  });

  it("lists every page's status for the admin, times as ISO", async () => {
    const { db, queries } = fakeDb({
      data: [
        {
          slug: SLUG,
          results: RESULTS,
          results_at: RAW_AT,
          refresh_attempted_at: "2026-09-29T01:00:00+00:00",
          refresh_error: "smaller",
        },
        {
          slug: "b",
          results: null,
          results_at: null,
          refresh_attempted_at: null,
          refresh_error: " ",
        },
        { nonsense: true },
      ],
      error: null,
    });
    const statuses = await selectSnapshotStatuses(db);
    expect([...statuses.keys()]).toEqual([SLUG, "b"]);
    expect(statuses.get(SLUG)).toEqual({
      results: RESULTS,
      resultsAt: "2026-09-28T10:00:00.123Z",
      attemptedAt: "2026-09-29T01:00:00.000Z",
      note: "smaller",
    });
    expect(statuses.get("b")).toEqual({
      results: null,
      resultsAt: null,
      attemptedAt: null,
      note: null,
    });
    expect(queries[0].calls[0]).toEqual([
      "select",
      "slug, results, results_at, refresh_attempted_at, refresh_error",
    ]);
  });
});

describe("supabaseSnapshotStore", () => {
  const SLUG = "אוזניות-לריצה";
  const AT = new Date("2026-09-29T01:00:00.000Z");

  it("reads a page's state with results_at exactly as stored", async () => {
    const raw = "2026-09-28T10:00:00.123456+00:00";
    const { db, queries } = fakeDb({
      data: { slug: SLUG, query: "אוזניות לריצה", published: true, results: null, results_at: raw },
      error: null,
    });
    expect(await supabaseSnapshotStore(db).readState(SLUG)).toEqual({
      slug: SLUG,
      query: "אוזניות לריצה",
      published: true,
      results: null,
      resultsAt: raw,
    });
    expect(queries[0].calls).toEqual([
      ["select", "slug, query, published, results, results_at"],
      ["eq", "slug", SLUG],
      ["maybeSingle"],
    ]);
  });

  it("claims a published page only when no refresh started within the window", async () => {
    const { db, queries } = fakeDb({ data: [{ slug: SLUG }], error: null });
    expect(await supabaseSnapshotStore(db).claim(SLUG, AT, 120_000)).toBe(true);
    expect(queries[0].calls).toEqual([
      ["update", { refresh_attempted_at: "2026-09-29T01:00:00.000Z" }],
      ["eq", "slug", SLUG],
      ["eq", "published", true],
      ["or", "refresh_attempted_at.is.null,refresh_attempted_at.lt.2026-09-29T00:58:00.000Z"],
      ["select", "slug"],
    ]);
    const taken = fakeDb({ data: [], error: null });
    expect(await supabaseSnapshotStore(taken.db).claim(SLUG, AT, 120_000)).toBe(false);
  });

  it("stores only onto the state it decided against (same query, same results_at)", async () => {
    const response = { query: "q" } as never;
    const write = {
      slug: SLUG,
      query: "אוזניות לריצה",
      response,
      resultsAt: AT.toISOString(),
      note: null,
    };
    const first = fakeDb({ data: [{ slug: SLUG }], error: null });
    expect(await supabaseSnapshotStore(first.db).store({ ...write, expectedResultsAt: null })).toBe(
      true,
    );
    expect(first.queries[0].calls).toEqual([
      ["update", { results: response, results_at: AT.toISOString(), refresh_error: null }],
      ["eq", "slug", SLUG],
      ["eq", "query", "אוזניות לריצה"],
      ["is", "results_at", null],
      ["select", "slug"],
    ]);
    const raced = fakeDb({ data: [], error: null });
    const raw = "2026-09-20T01:00:00+00:00";
    expect(await supabaseSnapshotStore(raced.db).store({ ...write, expectedResultsAt: raw })).toBe(
      false,
    );
    expect(raced.queries[0].calls[3]).toEqual(["eq", "results_at", raw]);
  });

  it("records a note while the page keeps the query", async () => {
    const { db, queries } = fakeDb({ data: null, error: null });
    await supabaseSnapshotStore(db).recordNote(SLUG, "אוזניות לריצה", "upstream");
    expect(queries[0].calls).toEqual([
      ["update", { refresh_error: "upstream" }],
      ["eq", "slug", SLUG],
      ["eq", "query", "אוזניות לריצה"],
    ]);
  });

  it("lists the published pages for the cron, skipping bad rows", async () => {
    const { db, queries } = fakeDb({
      data: [
        {
          slug: SLUG,
          published: true,
          results_at: "2026-09-20T01:00:00+00:00",
          refresh_attempted_at: null,
          refresh_error: null,
        },
        { slug: "Bad Slug", published: true, results_at: null, refresh_attempted_at: null },
      ],
      error: null,
    });
    expect(await supabaseSnapshotStore(db).refreshRows()).toEqual([
      {
        slug: SLUG,
        published: true,
        resultsAt: "2026-09-20T01:00:00.000Z",
        attemptedAt: null,
        error: null,
      },
    ]);
    expect(queries[0].calls).toEqual([
      ["select", "slug, published, results_at, refresh_attempted_at, refresh_error"],
      ["eq", "published", true],
      ["limit", 1000],
    ]);
  });

  it("throws SeoDbError when the database fails", async () => {
    const { db } = fakeDb({ data: null, error: { message: "boom" } });
    await expect(supabaseSnapshotStore(db).refreshRows()).rejects.toBeInstanceOf(SeoDbError);
    await expect(supabaseSnapshotStore(db).claim(SLUG, AT, 1)).rejects.toBeInstanceOf(SeoDbError);
  });
});
