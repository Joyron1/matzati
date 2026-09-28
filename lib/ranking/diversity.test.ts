import { describe, expect, it } from "vitest";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { RESULTS_KEPT } from "@/lib/search/pipeline";
import { SHOP_CAP } from "./config";
import { dedupeListings, diversifyShops } from "./diversity";

function product(overrides: Partial<AliProduct>): AliProduct {
  return {
    productId: "1",
    title: "Item",
    price: 20,
    originalPrice: null,
    currency: "ILS",
    discountPct: null,
    positiveFeedbackPct: 98,
    unitsSold: 1000,
    mainImageUrl: "https://ae-pic-a1.aliexpress-media.com/kf/a.jpg",
    imageUrls: [],
    detailUrl: "https://he.aliexpress.com/item/1.html",
    promotionLink: null,
    shop: { id: null, name: null, url: null },
    commissionRatePct: 5,
    category: { firstId: null, firstName: null, secondId: null, secondName: null },
    ...overrides,
  };
}

const shop = (id: string | null) => ({ id, name: null, url: null });
const ids = (ps: AliProduct[]) => ps.map((p) => p.productId);
const inShops = (list: [string, string | null][]) =>
  list.map(([id, s]) => product({ productId: id, title: `Item ${id}`, shop: shop(s) }));

describe("diversifyShops", () => {
  it("keeps the kept-list size of the pipeline", () => {
    expect(SHOP_CAP.keptSize).toBe(RESULTS_KEPT);
  });

  it("shows one product per shop on the first page and two per shop in the kept list", () => {
    const list = inShops([
      ["a1", "A"],
      ["a2", "A"],
      ["a3", "A"],
      ["b1", "B"],
      ["a4", "A"],
      ["c1", "C"],
      ["b2", "B"],
      ["b3", "B"],
    ]);
    const out = diversifyShops(list, RESULTS_PER_PAGE);
    expect(ids(out)).toEqual(["a1", "b1", "c1", "a2", "b2", "a3", "a4", "b3"]);
    // Nothing is dropped.
    expect(ids(out).sort()).toEqual(ids(list).sort());
  });

  it("fills the page from one shop when no other shop has a product left", () => {
    const single = inShops([
      ["a1", "A"],
      ["a2", "A"],
      ["a3", "A"],
    ]);
    expect(ids(diversifyShops(single, RESULTS_PER_PAGE))).toEqual(["a1", "a2", "a3"]);
    // Two shops: the second shop's one product comes second, then the first shop again.
    const two = inShops([
      ["a1", "A"],
      ["a2", "A"],
      ["a3", "A"],
      ["b1", "B"],
    ]);
    expect(ids(diversifyShops(two, RESULTS_PER_PAGE))).toEqual(["a1", "b1", "a2", "a3"]);
  });

  it("never caps a product without a shop id", () => {
    const list = inShops([
      ["x1", null],
      ["x2", null],
      ["a1", "A"],
    ]);
    expect(ids(diversifyShops(list, RESULTS_PER_PAGE))).toEqual(["x1", "x2", "a1"]);
  });
});

describe("dedupeListings (item 4)", () => {
  it("merges one shop's listings that share the same sales and much of the title", () => {
    // Real live-drawer-organizer results #1 and #2: one shop, both at exactly 11,268 sales.
    const kept = dedupeListings([
      product({
        productId: "1005006995257180",
        title:
          "Thicken Clothes Organizer Pants Sweater Storage Cabinets Drawers Organizer Jeans Storage Box Wardrobe Clothes Storage Organizers",
        shop: shop("1103573332"),
        unitsSold: 11268,
      }),
      product({
        productId: "1005007011605676",
        title:
          "1/2/3PCS Collapsible Clothing Organizer Closet Clothes Pants Storage Organizer Closet Organizer Drawer Organizer Toy Storage",
        shop: shop("1103573332"),
        unitsSold: 11268,
      }),
    ]);
    expect(ids(kept)).toEqual(["1005006995257180"]);
  });

  it("keeps same-sales listings of different shops, of small sales, or of other products", () => {
    const a = {
      title: "Kids Water Bottle Straw Leakproof 500ml Cartoon",
      unitsSold: 4000,
      shop: shop("7"),
    };
    const b = { title: "Kitchen Drawer Organizer Bamboo Tray", unitsSold: 4000, shop: shop("7") };
    expect(
      ids(dedupeListings([product({ ...a, productId: "a" }), product({ ...b, productId: "b" })])),
    ).toEqual(["a", "b"]);
    const small = { title: "Kids Bottle Straw Cartoon Cute", unitsSold: 150, shop: shop("7") };
    const small2 = { title: "Kids Bottle Handle Cartoon Animal", unitsSold: 150, shop: shop("7") };
    expect(
      ids(
        dedupeListings([
          product({ ...small, productId: "s1" }),
          product({ ...small2, productId: "s2" }),
        ]),
      ),
    ).toEqual(["s1", "s2"]);
  });

  it("merges a lettered edition of the same model", () => {
    // Real ho-speaker results #1 and #2.
    const kept = dedupeListings([
      product({
        productId: "s32",
        title:
          "Zealot-S32 Wireless Speaker Outdoor Portable Subwoofer Speaker, Waterproof IPX 6, Dual Pairing,1800mAh Battery",
        shop: shop("1"),
        unitsSold: 4138,
      }),
      product({
        productId: "s32pro",
        title:
          "ZEALOT-S32PRO Powerful Bluetooth Speaker, Bass Wireless, LED Light, Outdoor Speakers, Subwoofer, Waterproof Sound Box Support",
        shop: shop("2"),
        unitsSold: 900,
      }),
      product({ productId: "x7", title: "Lenovo X7 Bone Conduction Earphones", shop: shop("3") }),
      product({ productId: "x70", title: "Lenovo X70 Open Ear Earphones", shop: shop("4") }),
    ]);
    expect(ids(kept)).toEqual(["s32", "x7", "x70"]);
  });

  it("merges near-identical titles across shops", () => {
    const title = "LED Night Light Motion Sensor EU Plug Wall Lamp Bedroom Stairs Kids Room";
    const kept = dedupeListings([
      product({ productId: "a", title, shop: shop("1") }),
      product({ productId: "b", title: `${title} Hallway`, shop: shop("2") }),
      product({
        productId: "c",
        title: "LED Night Light Motion Sensor USB Rechargeable",
        shop: shop("3"),
      }),
    ]);
    expect(ids(kept)).toEqual(["a", "c"]);
  });
});
