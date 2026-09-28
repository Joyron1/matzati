// The recorded cases of docs/search-quality-plan.md (items 2-4) on their real product pools
// (fixtures/snapshots, every captured call): what a search shows now under lib/ranking.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { snapshotFiles } from "@/lib/eval/files";
import { parseLabelFile, type Label } from "@/lib/eval/labels";
import { distinctProducts, parseSnapshot, type Snapshot } from "@/lib/eval/snapshot";
import { SHARED_NUMBERS, SHOP_CAP_MODES, type ShopCapMode } from "./config";
import { findSharedNumbers, hasSharedNumbers, rankProducts, rankWithFill } from "./rank";
import { markIn } from "./shared-numbers";

const DIR = "fixtures/snapshots";
const available = [
  "live-drawer-organizer",
  "live-soundbar",
  "ho-gift-garden",
  "ho-neck-pillow",
].every((id) => existsSync(`${DIR}/${id}.json`) && existsSync(`${DIR}/labels/${id}.json`));

function load(id: string): { snap: Snapshot; pool: AliProduct[]; label: (p: AliProduct) => Label } {
  const snap = parseSnapshot(JSON.parse(readFileSync(`${DIR}/${id}.json`, "utf8")), id);
  const entries =
    parseLabelFile(id, JSON.parse(readFileSync(`${DIR}/labels/${id}.json`, "utf8"))).get(id) ?? [];
  const labels = new Map(entries.map((e) => [e.productId, e.label]));
  return {
    snap,
    pool: distinctProducts(snap.calls.filter((c) => !c.error)),
    label: (p) => labels.get(p.productId) ?? "weak",
  };
}

/** The list a search shows, under the admin's shop cap mode (the default "none" unless given). */
const shown = (pool: AliProduct[], snap: Snapshot, mode: ShopCapMode = "none") =>
  rankWithFill(pool, snap.parse.parsed, RESULTS_PER_PAGE, mode).ranked;

const maxPerShop = (page: AliProduct[]) =>
  Math.max(
    ...[...new Set(page.map((p) => p.shop.id))].map(
      (s) => page.filter((p) => p.shop.id === s).length,
    ),
  );

describe.skipIf(!available)("recorded cases on their snapshot pools", () => {
  it("drawer organizer: no car tray, at most 2 per shop under max2, nothing wrong on page 1", () => {
    const { snap, pool, label } = load("live-drawer-organizer");
    for (const mode of SHOP_CAP_MODES) {
      const list = shown(pool, snap, mode);
      // The car tray the live site showed at #3 (plan, item 2).
      expect(list.map((p) => p.productId)).not.toContain("1005012698650176");
      const page = list.slice(0, RESULTS_PER_PAGE);
      if (mode === "max2") expect(maxPerShop(page)).toBeLessThanOrEqual(2);
      expect(page.map(label)).not.toContain("wrong");
      // The two listings of one shop at exactly 11,268 sales show as one product.
      const ids = list.map((p) => p.productId);
      expect(ids.includes("1005006995257180") && ids.includes("1005007011605676")).toBe(false);
    }
  });

  it("soundbar: under max2 the shop that held the whole first page shares it; no stand", () => {
    const { snap, pool } = load("live-soundbar");
    const stone = "1103573332";
    // Without a shop cap, the score order puts this shop's products in every place of page 1.
    expect(
      rankProducts(pool, snap.parse.parsed)
        .slice(0, RESULTS_PER_PAGE)
        .every((p) => p.shop.id === stone),
    ).toBe(true);
    const list = shown(pool, snap, "max2");
    const page = list.slice(0, RESULTS_PER_PAGE);
    const others = new Set(list.filter((p) => p.shop.id !== stone).map((p) => p.shop.id));
    // Every other shop that passed is on the first page (here there is only one).
    expect(others.size).toBeGreaterThan(0);
    for (const shop of others) expect(page.map((p) => p.shop.id)).toContain(shop);
    for (const mode of SHOP_CAP_MODES) {
      // soundbar stand base
      expect(shown(pool, snap, mode).map((p) => p.productId)).not.toContain("1005011782758504");
    }
  });

  it("garden gift: the sharpener no longer leads, and no sharpener passes", () => {
    const { snap, pool, label } = load("ho-gift-garden");
    const list = shown(pool, snap);
    expect(list.map((p) => p.productId)).not.toContain("1005007805667144"); // "Garden Tool Sharpener"
    expect(list.some((p) => /sharpener/i.test(p.title))).toBe(false);
    expect(["exact", "reasonable"]).toContain(label(list[0]));
  });

  it.skipIf(!existsSync(`${DIR}/cheapest-cable.json`))(
    "cheapest cable: the cheapest button orders by price, whatever the category",
    () => {
      // The fixer's check of the category rule: exact iPhone 15 cables at ₪4.83-4.98 filed under
      // another category were pushed below a ₪16.49 cable.
      const { snap, pool } = load("cheapest-cable");
      expect(snap.parse.parsed.sort_preference).toBe("cheapest");
      const page = shown(pool, snap).slice(0, RESULTS_PER_PAGE);
      const prices = page.map((p) => p.price);
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
      expect(Math.max(...prices)).toBeLessThanOrEqual(6);
    },
  );

  it("shared numbers: only the store with 98.0% on nearly every listing, in every pool", () => {
    // Owner decision 2026-09-28. The rule names no shop; on the real pools it finds exactly one.
    const stone = "1103573332";
    const files = snapshotFiles(DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const snap = parseSnapshot(JSON.parse(readFileSync(`${DIR}/${file}`, "utf8")), file);
      const pool = distinctProducts(snap.calls.filter((c) => !c.error));
      const listings = pool.filter((p) => p.shop.id === stone).length;
      const { shops } = findSharedNumbers(pool);
      expect([...shops], snap.id).toEqual(
        listings >= SHARED_NUMBERS.feedbackMinListings ? [stone] : [],
      );
    }
  });

  it("shared numbers: each card's note is true of that card's own numbers", () => {
    // The card says "most listings checked from this shop show exactly this feedback" or "another
    // listing shows exactly these sales" (components/trust-metrics.tsx): each must hold in the pool
    // the card was ranked in.
    const marks = { feedback: 0, sales: 0, neither: 0 };
    for (const file of snapshotFiles(DIR)) {
      const snap = parseSnapshot(JSON.parse(readFileSync(`${DIR}/${file}`, "utf8")), file);
      const pool = distinctProducts(snap.calls.filter((c) => !c.error));
      const shared = findSharedNumbers(pool);
      for (const p of pool) {
        const mark = markIn(p, shared);
        if (!mark) continue;
        const shop = pool.filter((o) => o.shop.id === p.shop.id);
        const others = shop.filter((o) => o.productId !== p.productId);
        const rated = shop.filter((o) => o.positiveFeedbackPct !== null).length;
        const sameFeedback = shop.filter((o) => o.positiveFeedbackPct === p.positiveFeedbackPct);
        if (mark.feedback) {
          marks.feedback++;
          expect(sameFeedback.length * 2, p.productId).toBeGreaterThan(rated);
        }
        if (mark.sales) {
          marks.sales++;
          expect(
            others.some((o) => o.unitsSold === p.unitsSold),
            p.productId,
          ).toBe(true);
        }
        if (!mark.feedback && !mark.sales) marks.neither++;
      }
    }
    expect(marks.feedback).toBeGreaterThan(1_000);
    expect(marks.sales).toBeGreaterThan(10);
    expect(marks.neither).toBeGreaterThan(10);
    // ex-8's "עוד 3" card at 98.3% and 4,744 sales: of that shop, but both numbers are its own.
    const snap = parseSnapshot(JSON.parse(readFileSync(`${DIR}/ex-8.json`, "utf8")), "ex-8");
    const pool = distinctProducts(snap.calls.filter((c) => !c.error));
    const own = pool.find((p) => p.productId === "1005013266358009");
    expect(own && markIn(own, findSharedNumbers(pool))).toEqual({ feedback: false, sales: false });
  });

  it("drawer organizer: the store's listings are marked, its 11,268 counts once", () => {
    const { snap, pool } = load("live-drawer-organizer");
    const list = shown(pool, snap);
    for (const p of list) expect(hasSharedNumbers(p), p.productId).toBe(p.shop.id === "1103573332");
    // The two listings productdetail.get also returned at exactly 11,268 (2026-09-28).
    const shared = findSharedNumbers(pool).salesSharedBy;
    expect(shared.get("1005006995257180")).toBe(2);
    expect(shared.get("1005007011605676")).toBe(2);
  });

  it("neck pillow: no car headrest pillow, and the first product is a travel pillow", () => {
    const { snap, pool, label } = load("ho-neck-pillow");
    for (const mode of SHOP_CAP_MODES) {
      const list = shown(pool, snap, mode);
      expect(list.map((p) => p.productId)).not.toContain("1005010706919284"); // "Car Seat Headrest"
      expect(list.some((p) => /^\W*(?:\d+pcs?\s+)?(?:\w+\s+)?car\b/i.test(p.title))).toBe(false);
      expect(list.slice(0, RESULTS_PER_PAGE).map(label)).not.toContain("wrong");
      expect(["exact", "reasonable"]).toContain(label(list[0]));
    }
  });
});
