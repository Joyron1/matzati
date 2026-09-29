// The admin's SEO actions (app/admin/seo/actions.ts) with fakes: publishing a page (or changing its
// query) refreshes its stored results after the response, and "רענון עכשיו" runs the same
// refresh. No database, AliExpress or LLM.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { refreshSeoPageAction, saveSeoPageAction } from "@/app/admin/seo/actions";
import type { SeoPage } from "./db";
import { ADMIN_CLAIM_WINDOW_MS, type RefreshOutcome } from "./refresh";

const m = vi.hoisted(() => ({
  afterCallbacks: [] as (() => Promise<void>)[],
  revalidatePath: vi.fn<(path: string) => void>(),
  getSeoPage: vi.fn<(slug: string) => Promise<unknown>>(),
  saveSeoPage: vi.fn<(input: unknown, originalSlug?: string) => Promise<unknown>>(),
  refresh: vi.fn<(slug: string, opts: unknown) => Promise<RefreshOutcome>>(),
  writesAllowed: vi.fn(() => true),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: m.revalidatePath, updateTag: vi.fn() }));
vi.mock("next/server", () => ({
  after: (callback: () => Promise<void>) => m.afterCallbacks.push(callback),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("@/lib/admin/auth", () => ({ requireAdmin: async () => ({ email: "owner@example.com" }) }));
vi.mock("@/lib/seo/queries", async () => {
  const db = await import("./db");
  return {
    SEO_TAG: "seo-pages",
    SeoPageNotFoundError: db.SeoPageNotFoundError,
    SeoSlugTakenError: db.SeoSlugTakenError,
    SeoValidationError: class extends Error {},
    getSeoPage: m.getSeoPage,
    saveSeoPage: m.saveSeoPage,
    deleteSeoPage: vi.fn(),
  };
});
vi.mock("@/lib/seo/refresh-server", () => ({
  seoRefresher: { refresh: m.refresh },
  snapshotWritesAllowed: m.writesAllowed,
}));

const SLUG = "אוזניות-אלחוטיות";
const Q = "אוזניות אלחוטיות";

const page = (over: Partial<SeoPage> = {}): SeoPage => ({
  slug: SLUG,
  query: Q,
  title_he: "אוזניות אלחוטיות",
  intro_he: null,
  published: true,
  created_at: "2026-09-28T10:00:00.000Z",
  updated_at: "2026-09-28T10:00:00.000Z",
  ...over,
});

function form(values: { query: string; published: boolean }) {
  const data = new FormData();
  data.set("query", values.query);
  data.set("title_he", "אוזניות אלחוטיות");
  data.set("intro_he", "");
  data.set("slug", SLUG);
  if (values.published) data.set("published", "on");
  return data;
}

const EMPTY_FORM = {
  values: { query: "", title_he: "", intro_he: "", slug: "", published: false },
  errors: {},
};

/** Runs the save action and returns the URL it redirected to. */
async function save(originalSlug: string | null, values: { query: string; published: boolean }) {
  const err = await saveSeoPageAction(originalSlug, EMPTY_FORM, form(values)).catch(
    (e: unknown) => e,
  );
  return (err as { url?: string }).url;
}

const stored = (shown: number, total = shown): RefreshOutcome => ({
  status: "stored",
  shown,
  total,
  pending: Math.ceil((total - shown) / 5),
  resultsAt: "2026-09-29T01:00:00.000Z",
  note: null,
  results: {} as never,
});

beforeEach(() => {
  m.afterCallbacks.length = 0;
  m.writesAllowed.mockReturnValue(true);
  m.refresh.mockResolvedValue(stored(5));
  m.saveSeoPage.mockImplementation(async (input) => page(input as Partial<SeoPage>));
  m.getSeoPage.mockResolvedValue(page());
});

afterEach(() => {
  vi.resetAllMocks();
});

describe("saveSeoPageAction", () => {
  it("refreshes a newly published page after the response, then revalidates it", async () => {
    expect(await save(null, { query: Q, published: true })).toBe(
      "/admin/seo?status=created-refreshing",
    );
    expect(m.refresh).not.toHaveBeenCalled();
    expect(m.afterCallbacks).toHaveLength(1);
    m.revalidatePath.mockClear();
    await m.afterCallbacks[0]();
    expect(m.refresh).toHaveBeenCalledWith(SLUG, {
      claimWindowMs: ADMIN_CLAIM_WINDOW_MS,
      deadline: expect.any(Number),
    });
    expect(m.revalidatePath).toHaveBeenCalledWith(`/s/${SLUG}`);
    expect(m.revalidatePath).toHaveBeenCalledWith("/admin/seo");
  });

  it("refreshes when a draft is published or the query changes", async () => {
    m.getSeoPage.mockResolvedValueOnce(page({ published: false }));
    expect(await save(SLUG, { query: Q, published: true })).toBe(
      "/admin/seo?status=updated-refreshing",
    );
    m.getSeoPage.mockResolvedValueOnce(page({ query: "אוזניות" }));
    expect(await save(SLUG, { query: Q, published: true })).toBe(
      "/admin/seo?status=updated-refreshing",
    );
    expect(m.afterCallbacks).toHaveLength(2);
  });

  it("does not refresh other saves, drafts, or outside production", async () => {
    expect(await save(SLUG, { query: Q, published: true })).toBe("/admin/seo?status=updated");
    expect(await save(null, { query: Q, published: false })).toBe("/admin/seo?status=created");
    m.writesAllowed.mockReturnValue(false);
    expect(await save(null, { query: Q, published: true })).toBe("/admin/seo?status=created");
    expect(m.afterCallbacks).toHaveLength(0);
    expect(m.refresh).not.toHaveBeenCalled();
  });

  it("does not revalidate the page when the refresh kept its results", async () => {
    m.refresh.mockResolvedValue({ status: "failed", error: "upstream" });
    await save(null, { query: Q, published: true });
    m.revalidatePath.mockClear();
    await m.afterCallbacks[0]();
    expect(m.revalidatePath).not.toHaveBeenCalledWith(`/s/${SLUG}`);
  });
});

describe("refreshSeoPageAction", () => {
  it("runs the refresh and says how it went, in Hebrew", async () => {
    expect(await refreshSeoPageAction(SLUG)).toEqual({
      message: "נשמר. מוצגים 5 מוצרים.",
      stored: true,
    });
    expect(m.revalidatePath).toHaveBeenCalledWith(`/s/${SLUG}`);
    m.refresh.mockResolvedValueOnce(stored(1));
    expect((await refreshSeoPageAction(SLUG)).message).toBe("נשמר. מוצג מוצר אחד.");
  });

  it("says how many products still wait for their lines, and how to finish them", async () => {
    m.refresh.mockResolvedValueOnce(stored(35, 50));
    const out = await refreshSeoPageAction(SLUG);
    expect(out.message).toContain("מוצגים 35 מוצרים, ועוד 15 מחכים להסברים");
    expect(out.message).toContain("השלמת הרענון");
    m.revalidatePath.mockClear();
    m.refresh.mockResolvedValueOnce({ status: "preparing", shown: 10, total: 50, pending: 8 });
    const waiting = await refreshSeoPageAction(SLUG);
    expect(waiting).toMatchObject({ stored: false });
    expect(waiting.message).toContain("התוצאות הקודמות");
    // The page itself did not change.
    expect(m.revalidatePath).not.toHaveBeenCalledWith(`/s/${SLUG}`);
  });

  it("says why nothing was stored, and whether the old results stayed", async () => {
    m.refresh.mockResolvedValueOnce({
      status: "kept",
      note: "smaller",
      hadSnapshot: true,
      results: {} as never,
    });
    expect((await refreshSeoPageAction(SLUG)).message).toContain("נשארו התוצאות הקודמות");
    m.refresh.mockResolvedValueOnce({
      status: "kept",
      note: "empty",
      hadSnapshot: false,
      results: {} as never,
    });
    expect((await refreshSeoPageAction(SLUG)).message).not.toContain("נשארו");
    m.refresh.mockResolvedValueOnce({ status: "failed", error: "upstream" });
    expect(await refreshSeoPageAction(SLUG)).toEqual({
      message: "הרענון לא הצליח: אלי אקספרס לא ענתה בזמן (לרוב עומס רגעי).",
      stored: false,
    });
    m.refresh.mockResolvedValueOnce({ status: "busy" });
    expect((await refreshSeoPageAction(SLUG)).message).toContain("רץ עכשיו");
  });

  it("refuses a slug that cannot exist without refreshing", async () => {
    expect((await refreshSeoPageAction("../x")).stored).toBe(false);
    expect(m.refresh).not.toHaveBeenCalled();
  });
});
