// What a landing page (/s/[slug]) shows (lib/seo/page-view.ts), with fakes: its stored results
// whenever it has them (never the "unavailable" card then), and one live run only without them.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SeoPage } from "./db";
import { seoPageView } from "./page-view";
import { fixtureResults } from "./results-fixture";
import type { SnapshotRun } from "./snapshot";

const m = vi.hoisted(() => ({
  getPublishedSeoPage: vi.fn<(slug: string) => Promise<unknown>>(),
  getPublishedSnapshot: vi.fn<(slug: string) => Promise<unknown>>(),
  firstRun: vi.fn<(slug: string, query: string, at: string | null) => Promise<SnapshotRun>>(),
  retrySoon: vi.fn(async () => true),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ unstable_cache: () => m.retrySoon }));
vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: <T>(fn: T) => fn,
}));
vi.mock("./queries", () => ({
  getPublishedSeoPage: m.getPublishedSeoPage,
  getPublishedSnapshot: m.getPublishedSnapshot,
}));
vi.mock("./refresh-server", () => ({ seoRefresher: { firstRun: m.firstRun } }));

const SLUG = "אוזניות-אלחוטיות";
const Q = "אוזניות אלחוטיות";

const PAGE: SeoPage = {
  slug: SLUG,
  query: Q,
  title_he: "אוזניות אלחוטיות",
  intro_he: null,
  published: true,
  created_at: "2026-09-28T10:00:00.000Z",
  updated_at: "2026-09-28T10:00:00.000Z",
};

const RESULTS = fixtureResults(12);

beforeEach(() => {
  vi.resetAllMocks();
  m.getPublishedSeoPage.mockResolvedValue(PAGE);
  m.getPublishedSnapshot.mockResolvedValue(null);
  m.firstRun.mockResolvedValue({ ok: true, results: RESULTS });
  m.retrySoon.mockResolvedValue(true);
});

describe("seoPageView", () => {
  it("shows the stored results with their date, without any search", async () => {
    m.getPublishedSnapshot.mockResolvedValue({
      results: RESULTS,
      resultsAt: "2026-09-25T01:00:00+00:00",
    });
    expect(await seoPageView(SLUG)).toEqual({
      page: PAGE,
      results: RESULTS,
      checkedAt: "2026-09-25T01:00:00.000Z",
    });
    expect(m.firstRun).not.toHaveBeenCalled();
  });

  it("runs the query once when the page has no stored results", async () => {
    const view = await seoPageView(SLUG);
    expect(view).toMatchObject({ results: RESULTS, checkedAt: RESULTS.fetched_at });
    expect(m.firstRun).toHaveBeenCalledWith(SLUG, Q, null);
    expect(m.retrySoon).not.toHaveBeenCalled();
  });

  it("runs it too when the stored results were made for the old query", async () => {
    m.getPublishedSnapshot.mockResolvedValue({
      results: { ...RESULTS, query: "אוזניות" },
      resultsAt: "2026-09-25T01:00:00+00:00",
    });
    await seoPageView(SLUG);
    expect(m.firstRun).toHaveBeenCalledWith(SLUG, Q, "2026-09-25T01:00:00+00:00");
  });

  it("shows the fallback only when there is nothing stored and the run failed", async () => {
    m.firstRun.mockResolvedValue({ ok: false, error: "upstream" });
    expect(await seoPageView(SLUG)).toEqual({ page: PAGE, results: null, checkedAt: null });
    // The fallback page is kept 10 minutes at most.
    expect(m.retrySoon).toHaveBeenCalled();
  });

  it("is a 404 for drafts and unknown slugs, without a search", async () => {
    m.getPublishedSeoPage.mockResolvedValue(null);
    expect(await seoPageView(SLUG)).toBeNull();
    expect(await seoPageView("not a slug")).toBeNull();
    expect(m.firstRun).not.toHaveBeenCalled();
  });

  it("throws when the stored results cannot be read, never showing the page without them", async () => {
    m.getPublishedSnapshot.mockRejectedValue(new Error("db down"));
    await expect(seoPageView(SLUG)).rejects.toThrow("db down");
    expect(m.firstRun).not.toHaveBeenCalled();
  });
});
