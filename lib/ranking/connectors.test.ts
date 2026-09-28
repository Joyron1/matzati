import { describe, expect, it } from "vitest";
import type { AliProduct } from "@/lib/aliexpress/schemas";
import type { ParsedQuery } from "@/lib/search/filters";
import { connectorFit, searchedPort, titleConnectors } from "./connectors";
import { rankWithFill } from "./rank";
import { isRequestedProduct } from "./type-gate";

/** The parse of "הכי זול: כבל USB-C לאייפון 15" on the live site (eval-v3-2026-09-28-subset.json). */
const liveCable: ParsedQuery = {
  keywords_en: "usb-c lightning cable iphone 15",
  product_terms: ["usb-c cable", "usb-c to lightning cable"],
  requirements: [{ en: "iphone 15", alt: ["lightning connector"], he: "לאייפון 15" }],
  sort_preference: "cheapest",
  product_he: "כבל USB-C לאייפון 15",
  category_hint: "phone cables",
};
/** The snapshot's stored parse of the same query (fixtures/snapshots/cheapest-cable.json). */
const storedCable: ParsedQuery = {
  keywords_en: "usb-c cable iphone 15",
  product_terms: ["usb-c cable", "iphone 15 cable"],
  requirements: [
    { en: "iphone 15 compatible", alt: ["iphone 15", "for iphone 15"], he: "תואם אייפון 15" },
  ],
  sort_preference: "cheapest",
  product_he: "כבל USB-C לאייפון 15",
};

const search = (overrides: Partial<ParsedQuery>): ParsedQuery => ({
  keywords_en: "",
  product_terms: [],
  requirements: [],
  sort_preference: "best_value",
  product_he: "",
  ...overrides,
});

// The five cards the live site showed for it, in its order (cheapest first).
const LIVE = {
  usbc: "Toocki USB Type C Cable Fast Charging USB C Charger Cord For iPhone 15 14 13 12 11 Huawei P40 P30 Realme Oppo Oneplus Samsung",
  toLightning:
    "Toocki PD 20W USB C To Lightnin Cable For iPhone 15 14 13 12 11 Pro XS 8 Type C To Lightning Cable Data Wire Fast Charging Cable",
  twoInOne:
    "PD 2 in 1 USB A Cable Type C To Lightning Fast Charging Cable For iPhone 16 15 14 13 11Pro Max iPad Xiaomi Huawe Samsung",
  fourInOne:
    "4 in 1 USB Type C Cable 66W PD Fast Charging Wire Type C To Lightning Cable For iPhone 17 16 15 14 Pro Max MacBook iPad Xiaomi",
  essager:
    "Essager 2 in 1 USB Type C Cable 65W PD Fast Charging Wire Type C To Lightning Cable For iPhone 15 14 Pro Max MacBook iPad Xiaomi",
};
// Titles of the cheapest-cable snapshot pool (fixtures/snapshots/cheapest-cable.json).
const SNAPSHOT = {
  carSpring:
    "Car USB Type C/Type C to Type C/USB LIGHTNING Fast Charging Spring Telescopic Cable For iPhone 16 15 14 Samsung Xiaomi OnePlus",
  oozcc:
    "OOZCC LCD Watt Display Cable, Max 120W Super Fast Charging USB Type C Cable Data Transfer, USB A to Lightning for IPhone14 Pro",
  cToC: "100W C to C USB C to USB C PD Cable for iPhone 15 Pro Max iPad 10 MacBook Huawei Xiaomi Type C to Type C PD Fast Charging",
  pd60: "PD 60W USB C to USB Type C Cable Fast Charge Data Cable For Iphone 15 15Pro Huawei Samsung Xiaomi Data Line Black",
  usbaToC:
    "NEW 12OW USBA To Type C To USBC Cable For iPhone 15 16 17 series PD  Fast Charging USB C DatCord For Xiaomi Oppo",
  threeInOne:
    "3 in 1 USB Cable Type C Cable Cord For Samsung Xiaomi Huawei USB C Cable For iPhone 16 15 14 13 Pro Phone Charger USB Data Cable",
};

describe("searchedPort", () => {
  it("reads the device from the parse's English and its Hebrew labels", () => {
    expect(searchedPort(liveCable)).toBe("usbc");
    expect(searchedPort(storedCable)).toBe("usbc");
    for (const model of ["iphone 16e", "iPhone 17 Pro Max", "iphone air", "iPhone15 plus"]) {
      expect(searchedPort(search({ keywords_en: `cable ${model}` })), model).toBe("usbc");
    }
    for (const model of ["iphone 14", "iPhone 13 Pro", "iphone se", "iphone xr", "iphone 8 plus"]) {
      expect(searchedPort(search({ keywords_en: `cable ${model}` })), model).toBe("lightning");
    }
    expect(searchedPort(search({ keywords_en: "usb c cable", product_he: "כבל לאייפון 15" }))).toBe(
      "usbc",
    );
  });

  it("has no port for no device, another device, or devices of both ports", () => {
    expect(searchedPort(search({ keywords_en: "usb c cable" }))).toBeNull();
    expect(searchedPort(search({ keywords_en: "ipad 10 cable" }))).toBeNull();
    expect(searchedPort(search({ keywords_en: "cable iphone 14 iphone 15" }))).toBeNull();
    expect(searchedPort(search({ keywords_en: "power bank 10000mah" }))).toBeNull();
  });
});

describe("titleConnectors", () => {
  it("reads the plug at the device end after 'to' and before a cable noun", () => {
    expect(titleConnectors(LIVE.toLightning).ends).toEqual(new Set(["lightning"]));
    expect(titleConnectors(LIVE.twoInOne).ends).toEqual(new Set(["lightning"]));
    expect(titleConnectors(LIVE.fourInOne).ends).toEqual(new Set(["usbc", "lightning"]));
    expect(titleConnectors(SNAPSHOT.carSpring).ends).toEqual(new Set(["usbc", "lightning"]));
    expect(titleConnectors(LIVE.usbc).ends).toEqual(new Set(["usbc"]));
    expect(titleConnectors("USB C to 8 Pin Cable").ends).toEqual(new Set(["lightning"]));
    expect(titleConnectors("Type C to iOS Fast Charging Cable").ends).toEqual(
      new Set(["lightning"]),
    );
  });

  it("knows USB-C at both ends, and a socket is not a plug", () => {
    expect(titleConnectors(SNAPSHOT.cToC).bothEnds).toEqual(new Set(["usbc"]));
    expect(titleConnectors(LIVE.toLightning).bothEnds).toEqual(new Set());
    const adapter = titleConnectors("Lightning Female to Type C Male Adapter for iPhone 15");
    expect(adapter.ends).toEqual(new Set(["usbc"]));
    expect(adapter.named).toEqual(new Set(["usbc"]));
  });
});

describe("connectorFit", () => {
  it("rejects the live site's Lightning-only cables for an iPhone 15 and moves down the mixed ones", () => {
    for (const f of [liveCable, storedCable]) {
      expect(connectorFit(LIVE.usbc, f)).toBe("fits");
      expect(connectorFit(LIVE.toLightning, f)).toBe("wrong");
      expect(connectorFit(LIVE.twoInOne, f)).toBe("wrong");
      // "USB Type C Cable ... Type C To Lightning Cable": a USB-C cable may be one of the options.
      expect(connectorFit(LIVE.fourInOne, f)).toBe("doubtful");
      expect(connectorFit(LIVE.essager, f)).toBe("doubtful");
      expect(connectorFit(SNAPSHOT.carSpring, f)).toBe("doubtful");
      expect(connectorFit(SNAPSHOT.oozcc, f)).toBe("doubtful");
      for (const title of [SNAPSHOT.cToC, SNAPSHOT.pd60, SNAPSHOT.usbaToC, SNAPSHOT.threeInOne]) {
        expect(connectorFit(title, f), title).toBe("fits");
      }
      expect(connectorFit("Lightning Cable For iPhone 15 14 13 Fast Charging", f)).toBe("wrong");
      expect(connectorFit("USB C to 8 Pin Cable for iPhone 15 14", f)).toBe("wrong");
    }
  });

  it("the type gate drops a wrong plug; relevance and the gate keep the rest", () => {
    expect(isRequestedProduct(LIVE.toLightning, liveCable)).toBe(false);
    expect(isRequestedProduct(LIVE.twoInOne, liveCable)).toBe(false);
    expect(isRequestedProduct(LIVE.usbc, liveCable)).toBe(true);
    expect(isRequestedProduct(LIVE.fourInOne, liveCable)).toBe(true);
  });

  it("for a Lightning iPhone rejects only USB-C at both ends", () => {
    const f = search({
      keywords_en: "usb c cable iphone 14",
      product_terms: ["usb-c cable", "iphone 14 cable"],
      product_he: "כבל USB-C לאייפון 14",
    });
    expect(connectorFit(SNAPSHOT.cToC, f)).toBe("wrong");
    expect(
      connectorFit(
        "PD 60W USB-C to USB-C Fast Charging PD Cable For iPhone 16 15 Series Macbook Huawei",
        f,
      ),
    ).toBe("wrong");
    expect(connectorFit(LIVE.toLightning, f)).toBe("fits");
    expect(connectorFit(SNAPSHOT.carSpring, f)).toBe("doubtful");
    // "USB C cable for iPhone 14" usually means USB-C to Lightning: left alone.
    expect(connectorFit(LIVE.usbc, f)).toBe("fits");
  });

  it("only moves a charger or an adapter down, and reads an adapter's plug by 'male' only", () => {
    const charger = search({
      keywords_en: "fast charger iphone 15",
      product_terms: ["fast charger", "phone charger"],
      product_he: "מטען מהיר לאייפון 15",
    });
    expect(
      connectorFit(
        "20W PD USB C Fast Charger With Type C To Lightning Cable For iPhone 14 13",
        charger,
      ),
    ).toBe("doubtful");
    expect(connectorFit("USB C Charger 20W PD Fast Charging For iPhone 15 16", charger)).toBe(
      "fits",
    );
    const adapter = search({
      keywords_en: "usb c adapter iphone 15",
      product_terms: ["usb c adapter"],
      product_he: "מתאם לאייפון 15",
    });
    expect(connectorFit("Lightning Female to Type C Male Adapter for iPhone 15", adapter)).toBe(
      "fits",
    );
    expect(connectorFit("Type C Male to Lightning Female OTG Adapter for iPhone 15", adapter)).toBe(
      "fits",
    );
    expect(connectorFit("Lightning Male to Type C Female Adapter for iPhone 14 13", adapter)).toBe(
      "doubtful",
    );
    // Apple's "USB-C to Lightning Adapter" plugs USB-C into the phone: without "male", no rule.
    expect(connectorFit("USB C to Lightning Adapter for iPhone 15", adapter)).toBe("fits");
  });

  it("leaves alone what the shopper asked for, products that do not plug in and searches without a device", () => {
    // The shopper named Lightning in their own words (the chip says so): no rule.
    const lightningCable = search({
      keywords_en: "lightning cable iphone 15",
      product_terms: ["lightning cable"],
      product_he: "כבל לייטנינג לאייפון 15",
    });
    expect(connectorFit(LIVE.toLightning, lightningCable)).toBe("fits");
    expect(
      connectorFit(LIVE.toLightning, { ...lightningCable, product_he: "כבל לאייפון 15" }),
    ).toBe("wrong");
    const cases = search({
      keywords_en: "phone case iphone 15",
      product_terms: ["phone case", "iphone 15 case"],
    });
    expect(
      connectorFit("Shockproof Case For iPhone 15 14 13 With Lightning Port Dust Plug", cases),
    ).toBe("fits");
    const anyCable = search({ keywords_en: "usb cable", product_terms: ["cable", "cord"] });
    expect(connectorFit(LIVE.toLightning, anyCable)).toBe("fits");
  });
});

describe("ranking with the connector rule", () => {
  const card = (
    productId: string,
    title: string,
    price: number,
    positiveFeedbackPct: number,
    unitsSold: number,
  ): AliProduct => ({
    productId,
    title,
    price,
    originalPrice: null,
    currency: "ILS",
    discountPct: null,
    positiveFeedbackPct,
    unitsSold,
    mainImageUrl: "https://ae-pic-a1.aliexpress-media.com/kf/a.jpg",
    imageUrls: [],
    detailUrl: `https://he.aliexpress.com/item/${productId}.html`,
    promotionLink: null,
    shop: { id: null, name: null, url: null },
    commissionRatePct: null,
    category: { firstId: "509", firstName: null, secondId: null, secondName: null },
  });

  it("the live site's five cards: the Lightning-only cables go, the mixed ones follow the USB-C cable", () => {
    // Recorded prices, feedback and 30-day sales (eval-v3-2026-09-28-subset.json). The live page
    // showed them in this order: the ₪5.63 USB-C cable, then four cables with a Lightning plug.
    const shown = [
      card("1005005196104315", LIVE.usbc, 5.63, 96, 4438),
      card("1005013255643267", LIVE.toLightning, 7.56, 98, 8030),
      card("1005009695929286", LIVE.twoInOne, 7.62, 98, 2364),
      card("1005011833644553", LIVE.fourInOne, 9.07, 91.7, 208),
      card("1005007077065364", LIVE.essager, 9.75, 97.5, 1323),
    ];
    const cheapest = rankWithFill(shown, liveCable, 5, "none").ranked;
    expect(cheapest.map((p) => p.productId)).toEqual([
      "1005005196104315",
      "1005011833644553",
      "1005007077065364",
    ]);
    // A cheaper mixed cable still comes after one that fits, in every sort.
    const cheaperMixed = [
      ...shown,
      card("mixed", LIVE.fourInOne.replace("66W", "60W"), 1, 99, 9000),
    ];
    for (const sort of ["cheapest", "best_value", "most_popular"] as const) {
      const ranked = rankWithFill(cheaperMixed, { ...liveCable, sort_preference: sort }, 5, "none");
      expect(ranked.ranked[0].productId, sort).toBe("1005005196104315");
      expect(
        ranked.ranked.map((p) => p.productId),
        sort,
      ).not.toContain("1005013255643267");
    }
  });
});
