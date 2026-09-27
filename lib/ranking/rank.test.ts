import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseEnvelope, parseJsonKeepingIds } from "@/lib/aliexpress/client";
import { parseCategories, parseProductPage, type AliProduct } from "@/lib/aliexpress/schemas";
import type { ParsedQuery, Requirement, SearchFilters } from "@/lib/search/filters";
import { CATEGORY_LABELS, FILL_TIER, FILTERS } from "./config";
import { tokenize } from "./match";
import {
  dedupeListings,
  effectiveFeedbackPct,
  isRequestedProduct,
  passesFilters,
  rankProducts,
  rejectReason,
  rejectionCounts,
  rankWithFill,
  trustTierOf,
} from "./rank";

function product(overrides: Partial<AliProduct>): AliProduct {
  return {
    productId: "1",
    title: "Wireless Earbuds Waterproof IPX5",
    price: 50,
    originalPrice: null,
    currency: "ILS",
    discountPct: null,
    positiveFeedbackPct: 95,
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

function filters(overrides: Partial<SearchFilters> = {}): SearchFilters {
  return {
    keywords_en: "wireless earbuds",
    product_terms: [],
    requirements: [],
    sort_preference: "best_value",
    ...overrides,
  };
}

const req = (en: string, alt: string[] = []): Requirement => ({ en, alt, he: "דרישה" });

/** A recorded eval result (fixtures/llm/eval-2026-09-27.json): title, ₪ price, feedback %, 30-day sales. */
const recorded = (id: string, title: string, price: number, fb: number, sold: number) =>
  product({ productId: id, title, price, positiveFeedbackPct: fb, unitsSold: sold });

const ids = (ps: AliProduct[]) => ps.map((p) => p.productId);

function fixtureProducts(): AliProduct[] {
  const text = readFileSync("fixtures/aliexpress/aliexpress.affiliate.product.query.json", "utf8");
  return parseProductPage(
    parseEnvelope("aliexpress.affiliate.product.query", parseJsonKeepingIds(text)).result,
  ).products;
}

/** A round-2 eval record: the stored parse and the results shown (at most 3). */
interface EvalV2Record {
  id: string;
  parsed: ParsedQuery;
  response: {
    results: {
      product_id: string;
      title_en: string;
      price_ils: number;
      positive_feedback_pct: number | null;
      units_sold: number | null;
    }[];
  };
}

function evalV2Records(): EvalV2Record[] {
  return JSON.parse(readFileSync("fixtures/llm/eval-v2-2026-09-27.json", "utf8")).records;
}

/**
 * Round-2 results that were not the requested product (docs/eval-m3.md). The explain step
 * labelled each one "אביזר משלים"; every other result shown in round 2 was right.
 */
const V2_MISSES: Record<string, string> = {
  "1005010439353509": "ho-gift-garden: a padlock pick set tagged 'Home Garden Tools'",
  "1005007306682299": "kids-bottle: a bike bottle holder",
  "1005006860850404": "ho-powerbank: a bike light that also charges a phone",
  "1005009582248966": "ho-speaker: a shower phone holder with a speaker",
};

describe("passesFilters", () => {
  const f = filters({ max_price_ils: 100 });
  it("enforces the thresholds exactly at the boundary", () => {
    expect(passesFilters(product({ positiveFeedbackPct: 90, unitsSold: 100 }), f)).toBe(true);
    expect(passesFilters(product({ positiveFeedbackPct: 89.9 }), f)).toBe(false);
    expect(passesFilters(product({ unitsSold: 99 }), f)).toBe(false);
  });
  it("rejects missing trust data instead of treating it as good", () => {
    expect(passesFilters(product({ positiveFeedbackPct: null }), f)).toBe(false);
    expect(passesFilters(product({ unitsSold: null }), f)).toBe(false);
  });
  it("applies price bounds and never mixes currencies", () => {
    expect(passesFilters(product({ price: 100.01 }), f)).toBe(false);
    expect(passesFilters(product({ price: 30 }), filters({ min_price_ils: 40 }))).toBe(false);
    expect(passesFilters(product({ currency: "USD", price: 10 }), f)).toBe(false);
  });
  it("needs every requirement, and any phrasing of a requirement counts", () => {
    const both = filters({ requirements: [req("waterproof"), req("noise cancelling")] });
    expect(passesFilters(product({ title: "ANC Wireless Earbuds IPX5" }), both)).toBe(true);
    expect(passesFilters(product({ title: "Wireless Earbuds IPX5" }), both)).toBe(false);
    expect(passesFilters(product({ title: "ANC Wireless Earbuds" }), both)).toBe(false);
  });
});

describe("rejectionCounts", () => {
  it("attributes each rejected product to the first filter it fails", () => {
    const counts = rejectionCounts(
      [
        product({ positiveFeedbackPct: 80 }),
        product({ unitsSold: 20 }),
        product({ price: 500 }),
        product({ title: "Earbuds Charging Case Replacement Waterproof" }),
        product({ title: "Wireless Earbuds Bluetooth 5.3" }),
        product({}),
      ],
      filters({
        max_price_ils: 100,
        product_terms: ["earbud", "earphone"],
        requirements: [req("waterproof")],
      }),
    );
    expect(counts).toEqual({
      feedback: 1,
      volume: 1,
      currency: 0,
      price: 1,
      type: 1,
      requirement: 1,
    });
  });
});

describe("product type check", () => {
  it("keeps exactly the 22 cables among the 50 real 'usb cable' fixture titles", () => {
    // Hand-labelled: organizers, winders, storage bags, car chargers, power banks, an HDD
    // enclosure, an ethernet adapter, a watch dock and a drone are not cables.
    const cables = new Set([
      "1005011749334480",
      "1005012986616721",
      "1005012521402314",
      "1005006996786199",
      "1005008432730678",
      "1005012013994625",
      "1005008672050550",
      "1005012011073612",
      "1005006967329774",
      "1005007075301656",
      "1005006898416912",
      "1005008494569058",
      "1005009394603716",
      "1005011654015082",
      "1005008744485619",
      "1005012523994405",
      "1005009806732630",
      "1005010582888740",
      "1005010399772854",
      "1005009277207441",
      "1005006212088373",
      "1005006353683012",
    ]);
    const products = fixtureProducts();
    expect(products).toHaveLength(50);
    const f = { keywords_en: "usb cable", product_terms: ["cable", "cord"] };
    const kept = products.filter((p) => isRequestedProduct(p.title, f)).map((p) => p.productId);
    expect(new Set(kept)).toEqual(cables);
  });

  it("drops the recorded car-holder accessories and keeps the holders", () => {
    const f = filters({
      keywords_en: "car phone holder",
      product_terms: ["holder", "mount", "stand", "bracket"],
      requirements: [req("wireless charging", ["wireless charger"])],
    });
    const cases: [AliProduct, string | null][] = [
      [
        recorded(
          "holder-magnetic",
          "Magnetic Car Wireless Charger Mount 15W Fast Charging For iPhone 12 13 14 15 16 Samsung Qi Phone 360 Rotation Vent Clip No Cable",
          13.88,
          98,
          5089,
        ),
        null,
      ],
      [
        recorded(
          "ring-sticker",
          "10-1pcs Q Type Self Adhesive Metal Ring Iron Sheet Stickers for Samsung Mi Huawei iPhone Magsafe Magnetic Wireless Charging Ring",
          2.9,
          98,
          3126,
        ),
        "type",
      ],
      [
        recorded(
          "holder-vent",
          "Car For Magsafe Wireless Charger Pad Air Vent Phone Holder Stand For iPhone 17~12 Samsung Xiaomi Fast Charging Cellphone Bracket",
          15.43,
          98,
          2726,
        ),
        null,
      ],
      [
        recorded(
          "plate-sticker",
          "1/2/6Pcs Magnetic Metal Ring Sticker for Wireless Charging – Universal Metal Plate for Phone Cases, Compatible with Car Mounts &",
          4.06,
          98,
          1142,
        ),
        "type",
      ],
      [
        recorded(
          "tesla-mat",
          "Car Wireless Charging Pad For New Tesla Model 3/Y 2024 2023 2022 Center Console Charger Mat Phone Mount Silicone Non-slip Pads",
          9.69,
          98,
          973,
        ),
        "type",
      ],
      [
        recorded(
          "holder-infrared",
          "Wireless Charger Car Mount for Air Vent Mount Car Phone Holder Rotating Intelligent Infrared Fast Wireless Charging Charger",
          34.68,
          98,
          1255,
        ),
        null,
      ],
    ];
    for (const [p, reason] of cases)
      expect([p.productId, rejectReason(p, f)]).toEqual([p.productId, reason]);
    expect(
      ids(
        rankProducts(
          cases.map(([p]) => p),
          f,
        ),
      ),
    ).toEqual(["holder-magnetic", "holder-vent", "holder-infrared"]);
  });

  it("drops the recorded egg box from a drawer-organizer search", () => {
    const f = filters({
      keywords_en: "drawer organizer",
      product_terms: ["drawer organizer", "drawer divider", "cutlery tray"],
    });
    const cutlery = recorded(
      "cutlery",
      "UpgradedAdjustable Plastic Cutlery Drawer Organizer Divided Storage Tray Space Saving Holder for Kitchen Knives Spoons Tableware",
      16.91,
      100,
      331,
    );
    const eggBox = recorded(
      "egg-box",
      "1pc Kitchen Egg Storage Box Refrigerator Fresh Plastic 2-Layer Drawer Type Large Capacity Storage Home Kitchen Organizer Rack",
      50.59,
      98,
      4039,
    );
    expect(rejectReason(cutlery, f)).toBeNull();
    expect(rejectReason(eggBox, f)).toBe("type");
  });

  it("drops an adapter and cable organizers from a cable search", () => {
    const f = { keywords_en: "usb c cable", product_terms: ["cable", "cord"] };
    expect(
      isRequestedProduct(
        "USB-C to USB Adapter, USB-C Male to USB Female OTG Data Cable, Suitable for MacBook Pro/Air",
        f,
      ),
    ).toBe(false);
    expect(
      isRequestedProduct(
        "Silicone USB Cable Organizer USB Charging Cable Winder Desktop Tidy Management Clips",
        f,
      ),
    ).toBe(false);
    expect(
      isRequestedProduct(
        "PD 60W USB-C to USB-C Fast Charging PD Cable For iPhone 16 15 Series Macbook Huawei",
        f,
      ),
    ).toBe(true);
  });

  it("allows an accessory noun the user searched for", () => {
    const title = "Silicone Phone Case for iPhone 15 Shockproof";
    expect(isRequestedProduct(title, { keywords_en: "phone", product_terms: ["phone"] })).toBe(
      false,
    );
    expect(
      isRequestedProduct(title, { keywords_en: "phone case", product_terms: ["phone case"] }),
    ).toBe(true);
  });

  it("does not treat a bundled item after 'with' as the product", () => {
    const f = { keywords_en: "wireless earbuds", product_terms: ["earbud"] };
    expect(isRequestedProduct("TWS Earbuds With Charging Case Bluetooth 5.3", f)).toBe(true);
    expect(isRequestedProduct("Earbuds Charging Case Replacement For Pro 2", f)).toBe(false);
  });

  it("needs the product term within the first 12 tokens", () => {
    const f = { keywords_en: "watch charger", product_terms: ["charger"] };
    const late = "Portable Dock Station For Samsung Galaxy Watch 3 4 5 6 7 8 Pro Charger";
    expect(isRequestedProduct(late, f)).toBe(false);
    expect(isRequestedProduct("Magnetic Watch Charger For Samsung Galaxy Watch 6", f)).toBe(true);
  });

  it("matches product terms as whole words, not stems", () => {
    // Real fixture titles: a charging cable is not a charger, and a lighter socket is not a light.
    const charger = { keywords_en: "car charger", product_terms: ["charger"] };
    const cable =
      "4 in 1 Mecha Fast Charging Data Cable Cord PD 27W For iPhone 15 Samsung Xiaomi 65W USB Type C Multi Port Quick Charge Wire Line";
    const carCharger =
      "100W/200W QC3.0 PD Mini Car Charger 12-24V Lighter Fast Charging Car USB Type C Charger for Xiaomi Samsung Huawei iPhone Power";
    expect(isRequestedProduct(cable, charger)).toBe(false);
    expect(isRequestedProduct(carCharger, charger)).toBe(true);
    expect(
      isRequestedProduct(carCharger, {
        keywords_en: "car light",
        product_terms: ["light", "lamp"],
      }),
    ).toBe(false);
    // Plurals and USB-C still match.
    expect(
      isRequestedProduct("Men's Hoodies Fleece Pullover Sweatshirt", {
        keywords_en: "hoodie",
        product_terms: ["hoodie"],
      }),
    ).toBe(true);
    expect(
      isRequestedProduct("PD 60W USB-C to USB-C Cable Fast Charging For iPhone 16", {
        keywords_en: "usb cable",
        product_terms: ["usb cable"],
      }),
    ).toBe(true);
  });

  it("skips the check when the parse gave no product terms", () => {
    expect(
      isRequestedProduct("Cable Organizer Clips", { keywords_en: "usb", product_terms: [] }),
    ).toBe(true);
  });

  it("drops a product named only as what the listing fits ('for X') or comes with ('with X')", () => {
    const speaker = {
      keywords_en: "waterproof bluetooth speaker",
      product_terms: ["bluetooth speaker", "wireless speaker"],
    };
    // Recorded round-2 miss.
    const shower =
      'Shower Phone Holder with Bluetooth Speaker 360 Rotation Wall Phone Mount for Shower Waterproof Anti Fog for 4-6.9" Phones';
    expect(isRequestedProduct(shower, speaker)).toBe(false);
    expect(isRequestedProduct("Desk Stand for Bluetooth Speaker Aluminum Alloy", speaker)).toBe(
      false,
    );
    expect(isRequestedProduct("Beanie Hat with Wireless Speaker Headphones", speaker)).toBe(false);
    // The product itself, with a bundled part or a compatibility note after it.
    expect(isRequestedProduct("Waterproof Bluetooth Speaker with Mic IPX7", speaker)).toBe(true);
    expect(isRequestedProduct("Mini Bluetooth Speaker for Phone Shower", speaker)).toBe(true);
  });

  it("keeps a title that restates the product after 'with', and a model after 'for'", () => {
    const sensorLight = {
      keywords_en: "motion sensor light",
      product_terms: ["motion sensor light"],
    };
    expect(
      isRequestedProduct("LED Night Light With Motion Sensor Light EU Plug", sensorLight),
    ).toBe(true);
    // "for" only claims the words right after it: here the charger is the product.
    const charger = { keywords_en: "wireless charger", product_terms: ["wireless charger"] };
    expect(
      isRequestedProduct(
        "Car For Magsafe Wireless Charger Pad Air Vent Phone Holder Stand For iPhone 17~12",
        charger,
      ),
    ).toBe(true);
    expect(
      isRequestedProduct("For iPhone 15 Case Silicone", {
        keywords_en: "iphone case",
        product_terms: ["case"],
      }),
    ).toBe(true);
  });

  it("does not read an AliExpress category label pasted into a title as the product", () => {
    const garden = {
      keywords_en: "gardening tools set",
      product_terms: ["gardening tools", "garden tools"],
    };
    // Recorded round-2 miss: "Home Garden" is the Home & Garden category, not a garden tool.
    expect(
      isRequestedProduct(
        "10PCS Padlock Shim Picks Set Accessories Set Tools Home Garden Tools",
        garden,
      ),
    ).toBe(false);
    expect(
      isRequestedProduct("Stainless Steel Garden Tools Set 3pcs for Home Garden Planting", garden),
    ).toBe(true);
    expect(
      isRequestedProduct(
        "Garden Tool Hand Trowel,Rake,Cultivator,Weeder Tools With Ergonomic Handle,Garden Lawn Farmland Transplant Gardening Bonsai Tool",
        garden,
      ),
    ).toBe(true);
  });

  it("takes every category label from the real category list", () => {
    const text = readFileSync("fixtures/aliexpress/aliexpress.affiliate.category.get.json", "utf8");
    const firstLevel = parseCategories(
      parseEnvelope("aliexpress.affiliate.category.get", parseJsonKeepingIds(text)).result,
    )
      .filter((c) => c.parentId === null)
      .map((c) => tokenize(c.name).join(" "));
    for (const label of CATEGORY_LABELS) expect(firstLevel).toContain(tokenize(label).join(" "));
  });

  it("drops a product term that only describes the noun after it", () => {
    // Recorded round-2 misses: a bottle holder and a bike light that also charges a phone.
    const bottle = {
      keywords_en: "leak proof water bottle",
      product_terms: ["water bottle", "garden bottle"],
    };
    expect(
      isRequestedProduct(
        "Bike Water Bottle Holder, Durable Leak Proof Non Slip, Lightweight Premium Bike Cup Holder, Adjustable Bicycle Accessories",
        bottle,
      ),
    ).toBe(false);
    expect(isRequestedProduct("Kids Water Bottle With Straw Holder Strap", bottle)).toBe(true);
    const bank = {
      keywords_en: "power bank 10000mah",
      product_terms: ["power bank", "portable charger"],
    };
    expect(
      isRequestedProduct(
        "Bicycle Light 10000mAh Bike Light Power Bank Flashlight USB Charging MTB Mountain Bicycle Cycling Headlight Lamp Accessories",
        bank,
      ),
    ).toBe(false);
    expect(isRequestedProduct("Baseus 10000mAh Power Bank 22.5W with Flashlight", bank)).toBe(true);
    // A holder the shopper asked for is the product.
    expect(
      isRequestedProduct("Bike Water Bottle Holder Aluminum", {
        keywords_en: "bike bottle holder",
        product_terms: ["bottle holder", "bottle cage"],
      }),
    ).toBe(true);
  });

  it("keeps a light followed by 'Flashlight' or 'Torch': it is still a light", () => {
    const bike = { keywords_en: "bike light", product_terms: ["bike light", "bicycle light"] };
    expect(
      isRequestedProduct("Bicycle Light Flashlight USB Rechargeable LED Bike Front Light", bike),
    ).toBe(true);
    expect(isRequestedProduct("Bike Light Torch Waterproof 3 Modes", bike)).toBe(true);
    const head = { keywords_en: "led headlamp", product_terms: ["headlamp", "head lamp"] };
    expect(
      isRequestedProduct("LED Headlamp Flashlight USB Rechargeable Camping Head Lamp", head),
    ).toBe(true);
    const night = { keywords_en: "night light motion sensor", product_terms: ["night light"] };
    expect(isRequestedProduct("LED Night Light Flashlight 2 in 1 Motion Sensor", night)).toBe(true);
  });

  it("keeps a category label that opens the title: it is the product's own name", () => {
    const hose = { keywords_en: "garden hose", product_terms: ["garden hose"] };
    expect(isRequestedProduct("Home Garden Hose Expandable 50FT Magic Hose", hose)).toBe(true);
    const garden = { keywords_en: "garden tools", product_terms: ["garden tools"] };
    expect(isRequestedProduct("Home Garden Tools Set 3pcs Trowel Rake", garden)).toBe(true);
  });

  it("keeps 'X with <term>' when the shopper searched for X too", () => {
    const holder = {
      keywords_en: "wireless charging car phone holder",
      product_terms: ["phone holder", "car phone holder", "phone mount"],
    };
    expect(
      isRequestedProduct("Car Wireless Charger with Phone Holder Air Vent Mount", holder),
    ).toBe(true);
    // Nobody searched for a charger here, so the cable is only what it comes with.
    expect(
      isRequestedProduct("65W USB-C Wall Charger with Retractable Cable Super Fast Charging", {
        keywords_en: "usb c cable",
        product_terms: ["cable", "cord"],
      }),
    ).toBe(false);
  });
});

describe("recorded eval round 2 (fixtures/llm/eval-v2-2026-09-27.json)", () => {
  const records = evalV2Records();

  it("covers the 20 queries", () => {
    expect(records).toHaveLength(20);
    const shown = new Set(records.flatMap((r) => r.response.results.map((x) => x.product_id)));
    for (const id of Object.keys(V2_MISSES)) expect(shown).toContain(id);
  });

  it.each(records.map((r) => [r.id, r] as const))(
    "%s: keeps every right result and drops the misses",
    (_id, r) => {
      for (const x of r.response.results) {
        const p = recorded(
          x.product_id,
          x.title_en,
          x.price_ils,
          x.positive_feedback_pct ?? 0,
          x.units_sold ?? 0,
        );
        const trust = trustTierOf(p) === "standard" ? FILTERS : FILL_TIER;
        const expected = x.product_id in V2_MISSES ? "type" : null;
        expect([x.title_en, rejectReason(p, r.parsed, trust)]).toEqual([x.title_en, expected]);
      }
    },
  );
});

describe("recorded eval queries", () => {
  it("passes all three recorded chargers for 65W", () => {
    const f = filters({
      keywords_en: "gan charger",
      product_terms: ["charger"],
      requirements: [req("65w")],
    });
    const chargers = [
      recorded(
        "67w",
        "Essager 67W GaN USB Type C Charger For Laptop 45W 25W PD QC 3.0 Fast Charge For Macbook Xiaomi Samsung Iphone14 13 Phone Chagers",
        48.4,
        98.7,
        1928,
      ),
      recorded(
        "100w",
        "100W GaN PD Type C Charger USB QC 3.0 For Laptop Ipad PPS Fast Charge EU UK For Samsung Xiaomi iPhone 15 16 Pro Max Mobile Phone",
        38.74,
        98,
        3152,
      ),
      recorded(
        "85w",
        "Real 85W GaN Type C Charger USB QC3.0 For Laptop Ipad PPS PD 65W Fast Charge For Samsung Xiaomi iPhone 6-16 Pro Max Mobile Phone",
        27.31,
        98,
        1484,
      ),
      recorded("33w", "33W GaN Type C Charger USB PD Fast Charge For Samsung Xiaomi", 12, 98, 5000),
    ];
    expect(chargers.map((p) => rejectReason(p, f))).toEqual([null, null, null, "requirement"]);
    // Different products that share many words must not be merged as duplicates.
    expect(ids(rankProducts(chargers, f)).sort()).toEqual(["100w", "67w", "85w"]);
  });

  it("rejects the recorded smartwatches whose titles lack heart rate", () => {
    const f = filters({
      keywords_en: "smart watch",
      product_terms: ["smart watch", "smartwatch"],
      requirements: [req("heart rate", ["heart rate monitor"])],
      max_price_ils: 150,
    });
    const watches = [
      recorded(
        "hr",
        "LAXASFIT Smartwatch Bluetooth Talk Smartwatch Message Alert Heart Rate Monitor Sports Watch for Android IOS Men Women",
        14.48,
        98,
        6131,
      ),
      recorded(
        "no-hr-1",
        "LAXASFIT 2025 New Smart Watch for Men Women Gift Full Touch Screen Sports Fitness Watch Bluetooth Call Digital Smartwatch",
        23.25,
        98,
        6013,
      ),
      recorded(
        "no-hr-2",
        "2026 Smart Watch Android IOS Phone 2.01Inch Color Screen Bluetooth Answer Call Fitness Watches Tracker Smartwatch Women Men Ht22",
        23.08,
        98,
        4504,
      ),
    ];
    expect(watches.map((p) => rejectReason(p, f))).toEqual([null, "requirement", "requirement"]);
  });

  it("orders 'cheapest' by price and drops the recorded OTG adapter", () => {
    const f = filters({
      keywords_en: "usb c cable",
      product_terms: ["cable", "cord"],
      sort_preference: "cheapest",
    });
    const ranked = rankProducts(
      [
        recorded(
          "adapter",
          "USB-C to USB Adapter, USB-C Male to USB Female OTG Data Cable, Suitable for MacBook Pro/Air, iPhone 16 Pro Max/16 Plus/16e/15",
          3.67,
          98,
          5961,
        ),
        recorded(
          "pd60",
          "PD 60W USB-C to USB-C Fast Charging PD Cable For iPhone 16 15 Series Macbook Huawei Samsung Xiaomi Type C to Type C Cord Cable",
          2.4,
          94.8,
          459,
        ),
        recorded(
          "short",
          "0.28M Short USB Type C Cable PD60W Fast Charging Power Bank Data Cord For iphone 15 Samsung Xiaomi Huawei Phone USB C Cable",
          3.82,
          98,
          2166,
        ),
      ],
      f,
    );
    expect(ids(ranked)).toEqual(["pd60", "short"]);
  });

  it("shows the recorded night light once, not as two listings", () => {
    const title =
      "LED Night Light With Motion Sensor Light EU US Plug Socket Lamps Children Night Lights Wireless Wall Bedside Bedroom Night Lamp";
    const f = filters({
      keywords_en: "night light",
      product_terms: ["night light", "night lamp"],
      requirements: [req("motion sensor")],
    });
    const ranked = rankProducts(
      [
        recorded("1005006871905731", title, 14.7, 96.1, 2122),
        recorded("1005006872041175", title, 10.77, 96.6, 2447),
      ],
      f,
    );
    expect(ids(ranked)).toEqual(["1005006872041175"]);
  });

  it("keeps one listing of the recorded POLVCDG X9 earphones", () => {
    const f = filters({
      keywords_en: "running earphones",
      product_terms: ["earphone", "headphone", "earbud"],
      requirements: [req("waterproof", ["water resistant"])],
      max_price_ils: 100,
    });
    const ranked = rankProducts(
      [
        recorded(
          "x9-a",
          "POLVCDG X9 Bone Conduction Swimming Earphones 32G IPX8 Waterproof Open Swimming Running Bicycle Earphones Ear Hanging Earphones",
          94.31,
          98,
          727,
        ),
        recorded(
          "hd65",
          "Original GDLYL HD65 TWS Bluetooth V5.4 Headphones Wireless LED Digital Display Earphones Noise Reduction Waterproof Headset New",
          80.1,
          96.2,
          1889,
        ),
        recorded(
          "x9-b",
          "POLVCDG X9 Bone Conduction Earphones 32G IPX8 Waterproof Open Design for Swimming Running Cycling Hanging Earphones",
          97.48,
          95.5,
          4618,
        ),
        recorded(
          "sp16",
          "Original SP16 Sports Wireless Earphones over Ear Buds with Earhooks True Wireless Running In-Ear Headphones With Mic Otemkay",
          19.4,
          98,
          6988,
        ),
      ],
      f,
    );
    expect(ranked.filter((p) => p.productId.startsWith("x9"))).toHaveLength(1);
    expect(ids(ranked)).toContain("hd65");
    expect(ids(ranked)).not.toContain("sp16");
  });
});

describe("effectiveFeedbackPct", () => {
  it("pulls small-sample ratings above 98% down toward 98%", () => {
    const small = effectiveFeedbackPct(product({ positiveFeedbackPct: 100, unitsSold: 331 }));
    expect(small).toBeGreaterThan(98);
    expect(small).toBeLessThan(99);
    const large = effectiveFeedbackPct(product({ positiveFeedbackPct: 99, unitsSold: 100_000 }));
    expect(large).toBeGreaterThan(98.99);
  });
  it("never lifts a rating at or below 98%", () => {
    expect(effectiveFeedbackPct(product({ positiveFeedbackPct: 92, unitsSold: 150 }))).toBe(92);
    expect(effectiveFeedbackPct(product({ positiveFeedbackPct: 98, unitsSold: 150 }))).toBe(98);
  });
});

describe("rankProducts", () => {
  it("puts better feedback and volume first", () => {
    const ranked = rankProducts(
      [
        product({
          productId: "weak",
          title: "Earbuds A",
          positiveFeedbackPct: 90.5,
          unitsSold: 150,
        }),
        product({
          productId: "strong",
          title: "Earbuds B",
          positiveFeedbackPct: 98,
          unitsSold: 8000,
        }),
      ],
      filters(),
    );
    expect(ids(ranked)).toEqual(["strong", "weak"]);
  });

  it("does not let 100% on a few hundred sales beat 98% on thousands", () => {
    const ranked = rankProducts(
      [
        product({
          productId: "few",
          title: "Drawer Organizer A",
          positiveFeedbackPct: 100,
          unitsSold: 331,
        }),
        product({
          productId: "many",
          title: "Drawer Organizer B",
          positiveFeedbackPct: 98,
          unitsSold: 4039,
        }),
      ],
      filters(),
    );
    expect(ids(ranked)).toEqual(["many", "few"]);
  });

  it("uses commission only to break exact ties", () => {
    const base = { positiveFeedbackPct: 95, unitsSold: 1000, price: 50 };
    const tie = rankProducts(
      [
        product({ ...base, productId: "a", title: "Earbuds A1", commissionRatePct: 3 }),
        product({ ...base, productId: "b", title: "Earbuds B1", commissionRatePct: 9 }),
      ],
      filters(),
    );
    expect(tie[0].productId).toBe("b");

    const notTie = rankProducts(
      [
        product({
          ...base,
          productId: "better",
          title: "Earbuds A1",
          positiveFeedbackPct: 95.1,
          commissionRatePct: 1,
        }),
        product({ ...base, productId: "pays-more", title: "Earbuds B1", commissionRatePct: 50 }),
      ],
      filters(),
    );
    expect(notTie[0].productId).toBe("better");
  });

  it("orders by price when the user asked for the cheapest, then by score", () => {
    const items = [
      product({
        productId: "popular",
        title: "Earbuds A",
        price: 60,
        positiveFeedbackPct: 97,
        unitsSold: 5000,
      }),
      product({
        productId: "cheap",
        title: "Earbuds B",
        price: 10,
        positiveFeedbackPct: 91,
        unitsSold: 150,
      }),
      product({
        productId: "cheap-better",
        title: "Earbuds C",
        price: 10,
        positiveFeedbackPct: 93,
        unitsSold: 300,
      }),
    ];
    expect(ids(rankProducts(items, filters({ sort_preference: "cheapest" })))).toEqual([
      "cheap-better",
      "cheap",
      "popular",
    ]);
    expect(rankProducts(items, filters())[0].productId).toBe("popular");
  });

  it("does not let one very cheap outlier take the whole price bonus", () => {
    // Prices 20..29 plus a ₪2 outlier: the 10th-percentile floor is ₪20, so the outlier and the
    // ₪20 product get the same price fit and the slightly better-rated one wins.
    const fillers = Array.from({ length: 9 }, (_, i) =>
      product({
        productId: `f${i}`,
        title: `Filler Item ${i}`,
        price: 21 + i,
        positiveFeedbackPct: 91,
        unitsSold: 150,
      }),
    );
    const ranked = rankProducts(
      [
        ...fillers,
        product({
          productId: "outlier",
          title: "Outlier Item",
          price: 2,
          positiveFeedbackPct: 97.9,
        }),
        product({ productId: "floor", title: "Floor Item", price: 20, positiveFeedbackPct: 98 }),
      ],
      filters(),
    );
    expect(ids(ranked).slice(0, 2)).toEqual(["floor", "outlier"]);
  });

  it("ranks the real product.query fixture deterministically, within filters, without duplicates", () => {
    const products = fixtureProducts();
    const f = filters({
      keywords_en: "usb cable",
      product_terms: ["cable", "cord"],
      max_price_ils: 20,
    });
    const a = rankProducts(products, f);
    const b = rankProducts([...products].reverse(), f);
    expect(ids(a)).toEqual(ids(b));
    expect(a.length).toBeGreaterThan(3);
    for (const p of a) {
      expect(p.price).toBeLessThanOrEqual(20);
      expect(p.positiveFeedbackPct).toBeGreaterThanOrEqual(90);
      expect(p.title.toLowerCase()).toMatch(/cable|cord/);
    }
    const titles = a.map((p) => p.title.toLowerCase().replace(/\s+/g, " ").trim());
    expect(new Set(titles).size).toBe(titles.length);
  });
});

describe("dedupeListings", () => {
  const shop = (id: string) => ({ id, name: null, url: null });

  it("merges identical titles and same brand plus model, keeping the first", () => {
    const kept = dedupeListings([
      product({ productId: "a", title: "LED Night Light Motion Sensor" }),
      product({ productId: "b", title: "LED  Night-Light Motion Sensors" }),
      product({ productId: "c", title: "POLVCDG X9 Bone Conduction Earphones" }),
      product({ productId: "d", title: "POLVCDG X9 Swimming Headphones 32G" }),
    ]);
    expect(ids(kept)).toEqual(["a", "c"]);
  });

  it("merges same-shop listings with mostly the same words", () => {
    const kept = dedupeListings([
      product({
        productId: "a",
        title: "Silicone Kids Water Bottle Straw Leakproof 500ml",
        shop: shop("7"),
      }),
      product({
        productId: "b",
        title: "Silicone Kids Water Bottle Straw Leakproof 350ml",
        shop: shop("7"),
      }),
      product({
        productId: "c",
        title: "Silicone Kids Water Bottle Straw Leakproof 350ml",
        shop: shop("8"),
      }),
    ]);
    // c has the same title as b, but b was already dropped; c differs from a only by shop.
    expect(ids(kept)).toEqual(["a", "c"]);
  });

  it("keeps different products that share words or a compatibility model", () => {
    const kept = dedupeListings([
      product({
        productId: "a",
        title: "100W GaN PD Type C Charger USB QC 3.0 For Laptop",
        shop: shop("7"),
      }),
      product({
        productId: "b",
        title: "Real 85W GaN Type C Charger USB QC3.0 For Laptop PD 65W",
        shop: shop("7"),
      }),
      product({ productId: "c", title: "For PS5 Controller Charging Dock Station" }),
      product({ productId: "d", title: "For PS5 Controller Silicone Skin Cover" }),
    ]);
    expect(ids(kept)).toEqual(["a", "b", "c", "d"]);
  });

  it("does not merge listings on a model the shopper searched for", () => {
    // "s24" is the phone these fit, not their model: they are two different cases.
    const f = filters({
      keywords_en: "galaxy s24 case",
      product_terms: ["case"],
      requirements: [req("s24")],
    });
    const ranked = rankProducts(
      [
        product({ productId: "a", title: "Samsung S24 Ultra Case Silicone Soft Cover" }),
        product({ productId: "b", title: "Samsung S24 Ultra Leather Wallet Case" }),
      ],
      f,
    );
    expect(ids(ranked).sort()).toEqual(["a", "b"]);
  });
});

describe("trust tiers", () => {
  it("classifies products by the thresholds they meet", () => {
    expect(trustTierOf({ positiveFeedbackPct: 92, unitsSold: 150 })).toBe("standard");
    expect(trustTierOf({ positiveFeedbackPct: 100, unitsSold: 67 })).toBe("fill");
    expect(trustTierOf({ positiveFeedbackPct: 94, unitsSold: 67 })).toBeNull();
    expect(trustTierOf({ positiveFeedbackPct: 100, unitsSold: 29 })).toBeNull();
    expect(trustTierOf({ positiveFeedbackPct: null, unitsSold: 5000 })).toBeNull();
  });

  // Real case, "בובת סוניק" (2026-09-27): 0 of 91 met FILTERS; plush listings with 100% feedback
  // and 43-96 sales a month were rejected on volume.
  const sonic = filters({
    keywords_en: "sonic plush toy",
    product_terms: ["sonic plush", "sonic doll"],
  });
  const plush = (id: string, title: string, fb: number | null, sold: number) =>
    product({ productId: id, title, positiveFeedbackPct: fb, unitsSold: sold });

  it("tops up to the target from the second tier only when too few meet FILTERS", () => {
    const { ranked, fillIds } = rankWithFill(
      [
        plush("a", "33cm Sonic Plush High Quality Hedgehog Toy", 100, 96),
        plush("b", "Genuine Sonic Tails Knuckles Plush Doll Pillow", 100, 43),
        plush("c", "30cm Sonic Plush Toys Knuckles Tails Amy", 100, 67),
        plush("d", "New Sonic Doll Plush 30cm", 85.7, 31), // feedback below both tiers
        plush("e", "Sonic Plush Doll Toy", 100, 12), // too few sales for either tier
      ],
      sonic,
      3,
    );
    expect(ranked.map((p) => p.productId).sort()).toEqual(["a", "b", "c"]);
    expect(fillIds.sort()).toEqual(["a", "b", "c"]);
  });

  it("never uses the second tier when enough products meet FILTERS, and keeps standard first", () => {
    const items = [
      plush("s1", "Sonic Plush Doll Classic", 98, 2000),
      plush("s2", "Sonic Plush Doll Big", 97, 900),
      plush("f1", "Sonic Plush Doll Mini", 100, 80),
    ];
    const two = rankWithFill(items, sonic, 3);
    expect(two.ranked.map((p) => p.productId)).toEqual(["s1", "s2", "f1"]);
    expect(two.fillIds).toEqual(["f1"]);
    const enough = rankWithFill(
      [...items, plush("s3", "Sonic Plush Doll Plus", 96, 500)],
      sonic,
      3,
    );
    expect(enough.fillIds).toEqual([]);
    expect(enough.ranked.every((p) => trustTierOf(p) === "standard")).toBe(true);
  });

  it("applies every other gate to the second tier unchanged", () => {
    const { ranked } = rankWithFill(
      [plush("k", "Sonic Plush Keychain Pendant", 100, 80)], // accessory: fails the type gate
      { ...sonic, max_price_ils: 30 },
      3,
    );
    expect(ranked).toEqual([]);
  });
});
