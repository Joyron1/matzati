// The recorded cases of docs/search-quality-plan.md (items 2-4) on their real product pools
// (fixtures/snapshots, every captured call): what a search shows now under lib/ranking.
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { parseLabelFile, type Label } from "@/lib/eval/labels";
import { distinctProducts, parseSnapshot, type Snapshot } from "@/lib/eval/snapshot";
import { rankProducts, rankWithFill } from "./rank";

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

const shown = (pool: AliProduct[], snap: Snapshot) =>
  rankWithFill(pool, snap.parse.parsed, RESULTS_PER_PAGE).ranked;

describe.skipIf(!available)("recorded cases on their snapshot pools", () => {
  it("drawer organizer: no car tray, one product per shop, nothing wrong on the first page", () => {
    const { snap, pool, label } = load("live-drawer-organizer");
    const list = shown(pool, snap);
    // The car tray the live site showed at #3 (plan, item 2).
    expect(list.map((p) => p.productId)).not.toContain("1005012698650176");
    const page = list.slice(0, RESULTS_PER_PAGE);
    expect(new Set(page.map((p) => p.shop.id)).size).toBe(RESULTS_PER_PAGE);
    expect(page.map(label)).not.toContain("wrong");
    // The two listings of one shop at exactly 11,268 sales show as one product.
    const ids = list.map((p) => p.productId);
    expect(ids.includes("1005006995257180") && ids.includes("1005007011605676")).toBe(false);
  });

  it("soundbar: the shop that held the whole first page shares it, and the stand is gone", () => {
    const { snap, pool } = load("live-soundbar");
    const stone = "1103573332";
    // Before the shop cap, the score order put this shop's products in all three places.
    expect(
      rankProducts(pool, snap.parse.parsed)
        .slice(0, RESULTS_PER_PAGE)
        .every((p) => p.shop.id === stone),
    ).toBe(true);
    const list = shown(pool, snap);
    const page = list.slice(0, RESULTS_PER_PAGE);
    const others = new Set(list.filter((p) => p.shop.id !== stone).map((p) => p.shop.id));
    // Every other shop that passed is on the first page (here there is only one).
    expect(others.size).toBeGreaterThan(0);
    for (const shop of others) expect(page.map((p) => p.shop.id)).toContain(shop);
    expect(list.map((p) => p.productId)).not.toContain("1005011782758504"); // soundbar stand base
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

  it("neck pillow: no car headrest pillow, and the first product is a travel pillow", () => {
    const { snap, pool, label } = load("ho-neck-pillow");
    const list = shown(pool, snap);
    expect(list.map((p) => p.productId)).not.toContain("1005010706919284"); // "Car Seat Headrest"
    expect(list.some((p) => /^\W*(?:\d+pcs?\s+)?(?:\w+\s+)?car\b/i.test(p.title))).toBe(false);
    expect(list.slice(0, RESULTS_PER_PAGE).map(label)).not.toContain("wrong");
    expect(["exact", "reasonable"]).toContain(label(list[0]));
  });
});
