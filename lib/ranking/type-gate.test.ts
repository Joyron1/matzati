import { describe, expect, it } from "vitest";
import type { Requirement, SearchFilters } from "@/lib/search/filters";
import { tokenize } from "./match";
import { PRODUCT_SYNONYM_GROUPS } from "./synonyms";
import { isRequestedProduct, productMatch, termPhrasings } from "./type-gate";

type Gate = Pick<SearchFilters, "keywords_en" | "product_terms"> &
  Partial<Pick<SearchFilters, "requirements">>;

const req = (en: string, alt: string[] = []): Requirement => ({ en, alt, he: "דרישה" });

// Parses recorded in fixtures/snapshots (docs/search-quality-plan.md, item 1).
const drawerOrganizer: Gate = {
  keywords_en: "drawer organizer storage",
  product_terms: ["drawer organizer", "drawer divider", "storage organizer"],
};
const neckPillow: Gate = {
  keywords_en: "neck pillow travel",
  product_terms: ["neck pillow", "travel pillow", "airplane pillow"],
};
const gardenGift: Gate = {
  keywords_en: "gardening tool",
  product_terms: ["gardening tool", "garden tool"],
};
const soundbar: Gate = { keywords_en: "soundbar", product_terms: ["soundbar", "sound bar"] };
const runningEarbuds: Gate = {
  keywords_en: "waterproof running earbuds",
  product_terms: ["running earbuds", "sports earbuds", "running headphones"],
  requirements: [req("waterproof", ["water resistant", "ipx"])],
};
const slippers: Gate = {
  keywords_en: "warm house slippers winter",
  product_terms: ["house slippers", "home slippers", "indoor slippers", "warm slippers"],
  requirements: [req("warm", ["heated", "thermal"])],
};
const kidsBottle: Gate = {
  keywords_en: "leak proof kids water bottle",
  product_terms: ["kids water bottle", "children's bottle", "leak proof bottle"],
  requirements: [req("leak proof", ["leakproof", "no leak"])],
};
const kitchenGift: Gate = {
  keywords_en: "kitchen tools set",
  product_terms: ["kitchen tools set", "cooking utensils"],
};

describe("product synonym groups", () => {
  it("tries every other member of a group in place of the one a term names", () => {
    for (const group of PRODUCT_SYNONYM_GROUPS) {
      for (const member of group) {
        const phrasings = termPhrasings(member)
          .filter((ph) => !ph.forWords)
          .map((ph) => [...ph.loose, ...ph.core].join(" "));
        for (const other of group) expect(phrasings).toContain(tokenize(other).join(" "));
      }
    }
  });

  it("matches sports earphones, headphones and headsets for sports earbuds", () => {
    // Real pair-a titles (fixtures/snapshots/ex-1.json), labelled exact or reasonable.
    for (const title of [
      "Original SP16 Sports Wireless Earphones over Ear Buds with Earhooks True Wireless Running",
      "Sport Wireless Headphone TWS Wireless Earphones Bluetooth 5.3 Earbuds with ENC Noise",
      "Choice AOC Sports Headset Wireless Bluetooth 6.0 Earphones Waterproof LED Battery Display",
    ]) {
      expect([title, isRequestedProduct(title, runningEarbuds)]).toEqual([title, true]);
    }
    // Narrow: other audio products stay out.
    expect(isRequestedProduct("Sports Bluetooth Speaker Waterproof IPX7", runningEarbuds)).toBe(
      false,
    );
  });

  it("matches 'Smartwatch' for 'smart watch' and the other way round", () => {
    const watch = { keywords_en: "smart watch", product_terms: ["smart watch"] };
    expect(isRequestedProduct("LAXASFIT Smartwatch Bluetooth Talk Heart Rate", watch)).toBe(true);
    const one = { keywords_en: "smartwatch", product_terms: ["smartwatch"] };
    expect(isRequestedProduct("2026 New Smart Watch Men Heart Rate", one)).toBe(true);
    expect(isRequestedProduct("Smart Band Fitness Tracker Watch Strap", one)).toBe(false);
  });

  it("matches a sound bar for a soundbar", () => {
    const one = { keywords_en: "soundbar", product_terms: ["soundbar"] };
    expect(isRequestedProduct("4D Bluetooth Computer Sound Bar Stereo Subwoofer", one)).toBe(true);
  });

  it("matches a kitchen utensil set for a kitchen tools set", () => {
    // Real gift-cook title, labelled exact.
    expect(
      isRequestedProduct(
        "12Pcs Kitchen Utensil Set Silicone Spatula Set Wooden Handle Cooking Tools Kit with Holder",
        kitchenGift,
      ),
    ).toBe(true);
  });

  it("matches house shoes and house slides for house slippers, not summer slides", () => {
    const house = { keywords_en: "house slippers", product_terms: ["house slippers"] };
    expect(isRequestedProduct("Womens Plush Cat Winter Warm Cozy House Shoes", house)).toBe(true);
    expect(isRequestedProduct("Fluffy Cross Plush House Slides Females", house)).toBe(true);
    expect(isRequestedProduct("Men Slides Summer Outdoor Sandals Thick Sole", house)).toBe(false);
    expect(isRequestedProduct("Summer Beach Slides Women Sandals", house)).toBe(false);
  });

  it("matches the named kinds of a product one way only", () => {
    // Real car-holder, home-drawer and kids-toy titles, all labelled exact (the car holder names
    // itself only after the 12-word opening).
    const holder = {
      keywords_en: "wireless charging car phone holder",
      product_terms: ["car phone holder", "phone mount", "car mount"],
    };
    expect(
      isRequestedProduct(
        "Magnetic Car Wireless Charger RGB For iPhone12 13 14 15 16 17 Pro Max Macsafe Car Phone Holder",
        holder,
      ),
    ).toBe(true);
    const drawer = {
      keywords_en: "kitchen drawer organizer",
      product_terms: ["drawer organizer", "drawer divider", "kitchen organizer"],
    };
    for (const title of [
      "Cutlery Tray For Kitchen Drawer Spoons Forks Knives Cutlery Holder Expandable",
      "Adjustable and Expandable Plastic Utensil Tray, Suitable for Cutlery, Knives, Spoons",
    ]) {
      expect([title, isRequestedProduct(title, drawer)]).toEqual([title, true]);
    }
    // One way: a cutlery tray search does not take a clothes drawer organizer.
    expect(
      isRequestedProduct("Foldable Clothes Drawer Organizer For Socks", {
        keywords_en: "cutlery tray",
        product_terms: ["cutlery tray"],
      }),
    ).toBe(false);
    expect(
      isRequestedProduct(
        "6/12PCS Color Shape Matching Toys Simulated Egg with Storage Box Geometric Sorting Game",
        { keywords_en: "color sorting toy", product_terms: ["color sorting toy"] },
      ),
    ).toBe(true);
  });

  it("matches any figure of the character for a pop figure, one way only", () => {
    // Real titles of the live "Naruto pop" search (2026-10-04; owner decision: figures of the
    // character are wanted when few Funko listings pass the trust bar).
    const pop = { keywords_en: "naruto pop figure", product_terms: ["pop figure", "funko pop"] };
    for (const title of [
      "Funko Pop Naruto Kurama Sasuke Wakaki Boruto SIX PATH KAKASHI Vinyl Figures Keychain Toys",
      "POP MART Naruto Shippuden Childhood Series Trendy Mystery Box Anime Action Figure Blind Random Box Toys",
      "POP MART GONG Naruto Shippuden Akatsuki Arc Series Trendy Blind Random Box Toys Mystery Box",
      "Genuine Naruto Blind Box Mini Bean Figurines Hatake Kakashi Anime Figures Naruto Keycaps",
    ]) {
      expect([title, isRequestedProduct(title, pop)]).toEqual([title, true]);
    }
    // Other products of the character stay out, and a figure search does not take a pop only.
    expect(isRequestedProduct("Naruto Akatsuki Hoodie Men Women Anime Sweatshirt", pop)).toBe(
      false,
    );
    expect(
      isRequestedProduct("Funko Pop Naruto Uchiha Madara #722 Vinyl", {
        keywords_en: "anime figure",
        product_terms: ["anime figure"],
      }),
    ).toBe(false);
  });

  it("matches a travel pillow for a neck pillow, not a U-shaped body pillow", () => {
    const neck = { keywords_en: "neck pillow", product_terms: ["neck pillow"] };
    expect(isRequestedProduct("Inflatable Travel Pillow Push Pump", neck)).toBe(true);
    expect(isRequestedProduct("U-Shaped Memory Foam Travel Pillow Airplane Nap", neck)).toBe(true);
    expect(
      isRequestedProduct("U Shaped Pillow for Pregnant Women Full Body Pillow Maternity", neck),
    ).toBe(false);
    expect(isRequestedProduct("Memory Foam Lumbar Pillow Office Chair", neck)).toBe(false);
  });
});

describe("term phrasings", () => {
  it("drops leading words the requirements already check", () => {
    // "warm slippers" with the requirement "warm": any slippers, and the requirement checks warmth.
    // Real ho-slippers title, labelled exact; no product term appears in its own words.
    const title =
      "Women's Winter Slippers Non-Slip Indoor House Shoes, Plush Fleece Lined Warm Cotton Slippers";
    expect(isRequestedProduct(title, slippers)).toBe(true);
    expect(isRequestedProduct(title, { ...slippers, requirements: [] })).toBe(true); // house shoes
    expect(
      isRequestedProduct("Winter Plush Slippers Couples Thick Sole", {
        ...slippers,
        requirements: [],
        product_terms: ["warm slippers"],
      }),
    ).toBe(false);
    expect(
      isRequestedProduct("Winter Plush Slippers Couples Thick Sole", {
        ...slippers,
        product_terms: ["warm slippers"],
      }),
    ).toBe(true);
  });

  it("lets the words before the last two of a longer term stand anywhere in the opening", () => {
    // Real kids-bottle title, labelled exact.
    const dino =
      "600ml Dinosaur Water Bottle For Kids Water Sippy Cup With Silicone Straw Leakproof Plastic";
    expect(isRequestedProduct(dino, { ...kidsBottle, requirements: [] })).toBe(true);
    // Not when the word is missing, or only far past the opening.
    const adult = "Stainless Steel Water Bottle Leakproof Sports Gym Travel Office";
    expect(
      isRequestedProduct(adult, {
        keywords_en: "kids water bottle",
        product_terms: ["kids water bottle"],
      }),
    ).toBe(false);
    const late =
      "Stainless Steel Water Bottle Leakproof Sports Gym Travel Office Hiking Camping Outdoor Big Kids";
    expect(
      isRequestedProduct(late, {
        keywords_en: "kids water bottle",
        product_terms: ["kids water bottle"],
      }),
    ).toBe(false);
    // After the product words, only close by: far past them the word describes something else.
    // The recorded title is from the finding on gift-cook (a garden set called a kitchen set).
    expect(
      isRequestedProduct("Garden Tools Set 3pcs Trowel Rake Kitchen Garden", kitchenGift),
    ).toBe(false);
    expect(isRequestedProduct("Tools Set For Kitchen Silicone Spatula", kitchenGift)).toBe(true);
    // A loose word inside "multi-color" is not the word itself. Real kids-toy title, labelled
    // wrong (juggling sandbags shown at #4 before this rule).
    const colorToy = {
      keywords_en: "color learning toy",
      product_terms: ["color learning toy", "color sorting toy", "educational toy"],
    };
    expect(
      isRequestedProduct(
        "PVCjuggling ball outdoor sandbag multi-color beginner 1/3/6/12 sandbags circular learning toy smooth durable",
        colorToy,
      ),
    ).toBe(false);
    expect(isRequestedProduct("Color Sorting Sensory Toys For Toddlers", colorToy)).toBe(true);
    // A number in the last two words keeps the term whole.
    expect(termPhrasings("iphone 15 cable")[0]).toEqual({
      core: ["iphone", "15", "cable"],
      loose: [],
    });
  });

  it("reads 'X ... for <use>' as '<use> X'", () => {
    // Real pair-a titles, labelled exact: "running earbuds" said as "Earbuds ... for Running".
    const title =
      "Wireless Earphones Bluetooth 5.4 Earbuds TWS with ENC Noise Cancellation Mic IPX7 Waterproof for Running Sport";
    expect(isRequestedProduct(title, runningEarbuds)).toBe(true);
    expect(
      isRequestedProduct(
        "Lenovo X7 Bone Conduction Wireless Earphone Sport Swimming Bluetooth Compatible Headphone Hand-free With Mic for Running",
        runningEarbuds,
      ),
    ).toBe(true);
    expect(isRequestedProduct("Wireless Earphones Bluetooth 5.4 Earbuds TWS", runningEarbuds)).toBe(
      false,
    );
  });

  it("reads a possessive term word as the word itself", () => {
    const children = { keywords_en: "children bottle", product_terms: ["children's bottle"] };
    expect(isRequestedProduct("Children Water Bottle Straw 500ml", children)).toBe(true);
  });
});

describe("accessories and holders", () => {
  it("drops the recorded sharpeners, splitter and parts from the garden gift search", () => {
    // Real ho-gift-garden titles: the "grinder" of the plan (item 2) led the list.
    for (const title of [
      "2PCS Garden Tool Sharpener, Portable Knife Sharpening Stone, Edge Grinder for Pruners Shears",
      "Diamond Sharpener Sharpener Metal Double Sand File Scissors Gardening Tools Sharpener",
      "Copper Pipe Connection Brass Faucet Tap Faucet Splitter Garden Watering Fittings Tool 3/4 Inch",
      "Garden Power Tools Accessories 3 Pieces Petrol Fuel Hose and Filter for Gas Brush Cutter",
    ]) {
      expect([title, isRequestedProduct(title, gardenGift)]).toEqual([title, false]);
    }
    expect(
      isRequestedProduct(
        "Garden Hoe Agricultural Supplies Weeds Tool Gardening Tools Utensils Hand Herbicide",
        gardenGift,
      ),
    ).toBe(true);
    // A sharpener the shopper asked for is the product.
    expect(
      isRequestedProduct("Garden Tool Sharpener Portable Knife Sharpening Stone", {
        keywords_en: "garden tool sharpener",
        product_terms: ["tool sharpener"],
      }),
    ).toBe(true);
  });

  it("drops hooks, pouches, shields and lids named with the product", () => {
    expect(
      isRequestedProduct(
        "Kitchen Hook Organizer Bathroom Hanger Wall Dish Drying Rack Holder for Lid",
        { keywords_en: "kitchen drawer organizer", product_terms: ["kitchen organizer"] },
      ),
    ).toBe(false);
    const backpack = { keywords_en: "hiking backpack", product_terms: ["backpack"] };
    expect(
      isRequestedProduct(
        "Practical Backpack Rain Shield Waterproof Dustproof Bag Shield",
        backpack,
      ),
    ).toBe(false);
    expect(isRequestedProduct("Kids Water Bottle Lid Replacement Straw", kidsBottle)).toBe(false);
    // "Ear Hook" is an earphone style, not a hook.
    expect(
      isRequestedProduct(
        "Bluetooth 5.4 Ear Hook Headphones TWS Wireless Earphones HiFi Stereo Waterproof",
        runningEarbuds,
      ),
    ).toBe(false); // not for running: no running or sports word
    expect(
      isRequestedProduct("Sports Ear Hook Earphones Bluetooth Waterproof Running", runningEarbuds),
    ).toBe(true);
  });

  it("drops a stand or mount named after the product, the recorded soundbar stand included", () => {
    // Real live-soundbar title (plan appendix: "Soundbar Stand Base" at #4).
    expect(
      isRequestedProduct(
        ".2Pcs Universal Soundbar Stand Base For Desktop Monitor Speaker TV Audio Speaker Bracket",
        soundbar,
      ),
    ).toBe(false);
    const speaker = { keywords_en: "bluetooth speaker", product_terms: ["bluetooth speaker"] };
    expect(isRequestedProduct("Bluetooth Speaker Mount Wall Aluminum", speaker)).toBe(false);
    expect(isRequestedProduct("Waterproof Bluetooth Speaker Stand Up Design", speaker)).toBe(false);
    expect(isRequestedProduct("Portable Bluetooth Speaker IPX7 Bass", speaker)).toBe(true);
  });

  it("drops cables and car chargers from a charger search", () => {
    // The renormalized tech-charger parse: "65w charger" loses "65w" to its requirement, so the
    // term is "charger". Real tech-charger titles, labelled wrong or weak.
    const charger = {
      keywords_en: "65w fast charger",
      product_terms: ["fast charger", "65w charger", "power adapter"],
      requirements: [req("65w")],
    };
    for (const title of [
      "PD 65W Supervooc Fast Charger Cable For Oneplus Ace 12 11 10T 9 8T 7T Pro USB C To Type C Cable",
      "120W Type C Cable 10A Fast Charging Phone Charger Data Cord For Huawei Mate 40 50 Honor",
      "65W Fast Charger Car Charger Dual USB",
      "Baseus 160W Magnetic Car Charger Type-C for Xiaomi Charger&4 Ports Fast Charging USB for iPhone",
    ]) {
      expect([title, isRequestedProduct(title, charger)]).toEqual([title, false]);
    }
    expect(
      isRequestedProduct("Baseus 65W GaN Fast Charger USB C PD Wall Adapter for Laptop", charger),
    ).toBe(true);
    // A cable search keeps its cables, cords included (real cheapest-cable title, labelled exact).
    const cable = { keywords_en: "usb c cable iphone 15", product_terms: ["usb-c cable"] };
    expect(
      isRequestedProduct(
        "Toocki 100W USB C To Type C Cable Fast Charging Charger Cable Data Cord For iPhone 15",
        cable,
      ),
    ).toBe(true);
    // Cables after another product are features: real ho-powerbank title.
    expect(
      isRequestedProduct("UGREEN Nexode Pro 200W 25000mAh Power Bank Retractable Cables Portable", {
        keywords_en: "power bank",
        product_terms: ["power bank"],
      }),
    ).toBe(true);
  });

  it("allows every holder noun once the search names one", () => {
    const holder = {
      keywords_en: "wireless charging car phone holder",
      product_terms: ["car phone holder", "phone mount", "car mount"],
    };
    // Real car-holder title, labelled exact: "Stand" before and "Bracket" after the term.
    expect(
      isRequestedProduct(
        "Magnetic Car Wireless Charger Stand Magnet Car Mount Fast Charging Station Phone Holder Bracket",
        holder,
      ),
    ).toBe(true);
    expect(isRequestedProduct("Car Magnetic Phone Holder Stand For iPhone", holder)).toBe(true);
  });
});

describe("objects the search did not name", () => {
  it("drops the recorded car tray from the drawer-organizer search", () => {
    // Real live-drawer-organizer result #3 (plan, item 2): "Car" opens the title.
    const tray =
      "Car Under Seat Storage Box ABS Drawer Organizer Anti-Slip Universal Auto Front Seat Tray Interior Accessories";
    expect(isRequestedProduct(tray, drawerOrganizer)).toBe(false);
    expect(
      isRequestedProduct(tray, {
        keywords_en: "car seat organizer",
        product_terms: ["car organizer", "drawer organizer"],
      }),
    ).toBe(true);
  });

  it("drops the recorded car headrest pillows from the neck-pillow search", () => {
    // Real ho-neck-pillow titles, all labelled wrong.
    for (const title of [
      "Car Seat Headrest Universal Travel Rest 3D Neck Pillow Protect Neck Soft Fluffy",
      "Universal Car Seat Headrest Neck Pillow, 3D Ergonomic Travel Neck Rest",
      "1PCS Cute Car Neck Pillow Safety Sleep Prevent Leaning Head Back Car Sleeping",
      "YZ for Tesla Travel Neck Pillow Model Y YL 3 Highland Headrest Lumbar Support",
      "Memory Foam Car Neck Pillow With Washable Pillow Case Provides Comfortable Neck Support",
      "Suede Comfortable Headrest Neck Pillow For Tesla Highland Model 3/Y Model S",
    ]) {
      expect([title, isRequestedProduct(title, neckPillow)]).toEqual([title, false]);
    }
    // "Car" later in the title, as a place of use, is fine.
    const flight =
      "U Shaped Inflatable Travel Pillow Push Pump Portable Air Neck Support Cushion For Flight Car Sleeping";
    expect(isRequestedProduct(flight, neckPillow)).toBe(true);
    expect(productMatch(flight, neckPillow)?.forOtherObject).toBe(false);
  });

  it("does not let a term reach across a noun of another thing", () => {
    expect(isRequestedProduct("Soft Neck Headrest Pillow Memory Foam", neckPillow)).toBe(false);
    expect(isRequestedProduct("Soft Neck Travel Pillow Memory Foam", neckPillow)).toBe(true);
  });

  it("keeps cars and trucks in a toy search, where they name the toy", () => {
    const toy = { keywords_en: "color learning toy", product_terms: ["learning toy"] };
    expect(isRequestedProduct("Car Learning Toy Color Matching Montessori", toy)).toBe(true);
  });

  it("marks a product made for an unsearched object without dropping it", () => {
    const m = productMatch(
      "Travel Neck Pillow Memory Foam Soft Support for Tesla Model Y",
      neckPillow,
    );
    expect(m).not.toBeNull();
    expect(m?.forOtherObject).toBe(true);
  });
});

describe("productMatch", () => {
  it("says where the product term starts, in words (numbers do not count)", () => {
    expect(productMatch("Travel Neck Pillow Memory Foam", neckPillow)?.position).toBe(0);
    expect(productMatch("Soft Plush Travel Neck Pillow", neckPillow)?.position).toBe(2);
    expect(productMatch("2026 Soft Plush Travel Neck Pillow", neckPillow)?.position).toBe(2);
  });

  it("marks titles that use the first product term word for word", () => {
    expect(productMatch("Travel Neck Pillow Memory Foam", neckPillow)?.primary).toBe(true);
    expect(productMatch("Inflatable Travel Pillow Push Pump", neckPillow)?.primary).toBe(false);
    // Real live-drawer-organizer titles: a drawer organizer, and a storage box that has drawers.
    expect(
      productMatch("Cabinet Underwear Organizer Drawer Clothes Organizer Boxes", drawerOrganizer)
        ?.primary,
    ).toBe(true);
    expect(
      productMatch(
        "3-Tier Plastic Cosmetic Storage Box Organizer with Drawers Multifunctional",
        drawerOrganizer,
      )?.primary,
    ).toBe(false);
  });

  it("matches any title when there are no product terms", () => {
    expect(productMatch("Anything", { keywords_en: "x", product_terms: [] })).toEqual({
      position: 0,
      forOtherObject: false,
      primary: true,
      close: false,
    });
  });
});
