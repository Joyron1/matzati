import { describe, expect, it } from "vitest";
import type { Coupon } from "@/lib/coupons/types";
import type { HotProduct } from "@/lib/hot/select";
import type { Deal, FilterChip } from "@/lib/types";
import {
  WELCOME_TEXT,
  afterResults,
  cardImage,
  clip,
  couponsText,
  failureText,
  goUrl,
  hotCard,
  menuList,
  optionsList,
  resultCard,
  saleText,
  searchSummary,
  text,
} from "./messages";
import { assertWithinLimits, product } from "./testkit";

const chars = (s: string) => [...s].length;

describe("clip", () => {
  it("keeps short text and cuts long text with an ellipsis, counting characters", () => {
    expect(clip("שלום", 10)).toBe("שלום");
    expect(chars(clip("א".repeat(50), 20))).toBe(20);
    expect(clip("א".repeat(50), 20).endsWith("…")).toBe(true);
    expect(chars(clip("😀".repeat(30), 10))).toBe(10);
  });
});

describe("cardImage", () => {
  it("takes the original JPEG or PNG on AliExpress's host, never WebP or another host", () => {
    expect(cardImage(["https://ae-pic-a1.aliexpress-media.com/kf/a.jpg"])).toContain("a.jpg");
    expect(cardImage(["https://ae-pic-a1.aliexpress-media.com/kf/a.png"])).toContain("a.png");
    expect(cardImage(["https://ae-pic-a1.aliexpress-media.com/kf/a.webp"])).toBeNull();
    expect(
      cardImage(["https://ae-pic-a1.aliexpress-media.com/kf/a.jpg_640x640.jpg"]),
    ).not.toBeNull();
    expect(cardImage(["https://evil.example/a.jpg"])).toBeNull();
    expect(cardImage(["http://ae-pic-a1.aliexpress-media.com/kf/a.jpg"])).toBeNull();
    expect(cardImage([])).toBeNull();
  });
  it("skips a bad first photo for a good second one", () => {
    expect(
      cardImage([
        "https://ae-pic-a1.aliexpress-media.com/a.webp",
        "https://ae-pic-a1.aliexpress-media.com/b.jpg",
      ]),
    ).toContain("b.jpg");
  });
});

describe("goUrl", () => {
  it("goes through /go with the channel, search uid and position the click log reads", () => {
    const url = new URL(goUrl("123", "whatsapp", { searchUid: "abc", position: 3 }));
    expect(url.origin).toBe("https://www.matzati-il.com");
    expect(url.pathname).toBe("/go/123");
    expect(url.searchParams.get("src")).toBe("whatsapp");
    expect(url.searchParams.get("s")).toBe("abc");
    expect(url.searchParams.get("pos")).toBe("3");
    expect(new URL(goUrl("123", "whatsapp_hot")).search).toBe("?src=whatsapp_hot");
  });
});

describe("resultCard", () => {
  it("shows the product's own numbers, the buy button and the affiliate note", () => {
    const m = resultCard(product(), 2, null);
    assertWithinLimits(m);
    if (m.type !== "interactive" || m.interactive.type !== "cta_url") throw new Error("not a cta");
    const i = m.interactive;
    expect(i.header?.image.link).toContain("S123.jpg");
    expect(i.body.text).toContain("*2. אוזניות ספורט Bluetooth עמידות למים*");
    expect(i.body.text).toContain("₪9.87");
    expect(i.body.text).toContain("98% משוב חיובי");
    expect(i.body.text).toContain("346");
    expect(i.body.text).toContain("במקום ₪12.50, 21% הנחה");
    expect(i.action.parameters.display_text).toBe("לקנייה באלי אקספרס");
    expect(i.action.parameters.url).toContain("/go/1005007429991325?src=whatsapp");
    expect(i.footer?.text).toContain("קישור שותפים");
    expect(i.footer?.text).toContain("matzati-il.com/terms#affiliate");
  });
  it("leaves out numbers AliExpress did not send and marks converted prices", () => {
    const m = resultCard(
      product({
        positive_feedback_pct: null,
        units_sold: null,
        original_price_ils: null,
        discount_pct: null,
        price_is_approx: true,
        price_ils: 78.2,
      }),
      1,
      null,
    );
    assertWithinLimits(m);
    const body =
      m.type === "interactive" && m.interactive.type === "cta_url" ? m.interactive.body.text : "";
    expect(body).toContain("≈₪78");
    expect(body).toContain("מחיר משוער בשקלים");
    expect(body).not.toContain("משוב חיובי");
    expect(body).not.toContain("במקום");
  });
  it("carries the note about shared numbers", () => {
    const m = resultCard(product(), 1, "מוצר אחר של החנות הזו מציג בדיוק את מספר המכירות הזה.");
    const body =
      m.type === "interactive" && m.interactive.type === "cta_url" ? m.interactive.body.text : "";
    expect(body).toContain("_מוצר אחר של החנות הזו");
  });
  it("has no photo header when it has no usable photo, and still fits with huge text", () => {
    const m = resultCard(
      product({ image_urls: [], title_he: "כ".repeat(900), why_he: "ל".repeat(900) }),
      5,
      "ש".repeat(400),
    );
    assertWithinLimits(m);
    expect(
      m.type === "interactive" && m.interactive.type === "cta_url" && m.interactive.header,
    ).toBeFalsy();
  });
});

describe("hotCard", () => {
  const hot: HotProduct = {
    productId: "1005011815415616",
    title: "צעצוע נחש לכלבים במבצע חם",
    imageUrl: "https://ae-pic-a1.aliexpress-media.com/kf/H1.jpg",
    price: 7.8,
    originalPrice: null,
    discountPct: null,
    positiveFeedbackPct: 92.7,
    unitsSold: 3197,
    hasVideo: false,
    promoCode: null,
    categoryId: null,
    subcategoryId: null,
    shopId: null,
  };
  it("uses the hot channel and stays within limits", () => {
    const m = hotCard(hot, 1);
    assertWithinLimits(m);
    if (m.type !== "interactive" || m.interactive.type !== "cta_url") throw new Error("not a cta");
    expect(m.interactive.action.parameters.url).toContain("src=whatsapp_hot");
    expect(m.interactive.body.text).toContain("92.7% משוב חיובי");
    expect(m.interactive.body.text).toContain("3,197");
  });
});

describe("buttons and lists", () => {
  const chips: FilterChip[] = [
    { id: "product", kind: "keywords", label_he: "אוזניות לריצה", removable: false },
    {
      id: "req0",
      kind: "must_have",
      label_he: "עמידות למים ברמה גבוהה מאוד של אטימות",
      removable: true,
    },
    { id: "max", kind: "max_price", label_he: "עד ₪100", removable: true },
  ];
  it("offers 5 more and the two other orders", () => {
    const m = afterResults({ moreAvailable: true, sort: "best_value", summary: "x" });
    assertWithinLimits(m);
    const ids =
      m.type === "interactive" && m.interactive.type === "button"
        ? m.interactive.action.buttons.map((b) => b.reply.id)
        : [];
    expect(ids).toEqual(["more", "sort:cheapest", "sort:most_popular"]);
  });
  it("offers no 'more' when there is none, and never more than 3 buttons", () => {
    const m = afterResults({ moreAvailable: false, sort: "cheapest", summary: "x" });
    assertWithinLimits(m);
    const ids =
      m.type === "interactive" && m.interactive.type === "button"
        ? m.interactive.action.buttons.map((b) => b.reply.id)
        : [];
    expect(ids).toEqual(["sort:best_value", "sort:most_popular"]);
  });
  it("lists removable filters (not the product) and the site's features", () => {
    const m = optionsList({ chips, sort: "best_value", moreAvailable: true });
    assertWithinLimits(m);
    const rows =
      m.type === "interactive" && m.interactive.type === "list"
        ? m.interactive.action.sections.flatMap((s) => s.rows.map((r) => r.id))
        : [];
    expect(rows).toEqual(["drop:req0", "drop:max", "hot", "coupons", "sales"]);
  });
  it("has a main menu within limits that carries the welcome text", () => {
    const m = menuList();
    assertWithinLimits(m);
    expect(m.type === "interactive" && m.interactive.body.text).toBe(WELCOME_TEXT);
  });
});

describe("texts", () => {
  it("summarises like the site: what was understood, and how many passed", () => {
    const s = searchSummary({
      checked: 1234,
      passed: 12,
      chips: [{ id: "product", kind: "keywords", label_he: "אוזניות", removable: false }],
      page: 0,
    });
    expect(s).toContain("הבנו: ״אוזניות״");
    expect(s).toContain("בדקנו 1,234 מוצרים. 12 עברו");
  });
  it("names failures in Hebrew, including the wait", () => {
    expect(failureText("rate_limited", 600)).toContain("10 דקות");
    for (const code of ["capacity", "llm", "upstream", "invalid_query", "parse_failed", "other"]) {
      expect(failureText(code)).toMatch(/[א-ת]/);
    }
  });
  it("lists coupons with the owner-coupon note, and says so when there are none", () => {
    const coupon = {
      id: "1",
      code: "SAVE5",
      title: "₪5 הנחה",
      terms: null,
      min_spend_ils: 40,
      scope: "sitewide",
      product_id: null,
      sale_id: null,
      starts_at: null,
      ends_at: null,
      featured: true,
      published: true,
      created_at: "",
      updated_at: "",
    } satisfies Coupon;
    const t = couponsText([coupon], new Date("2026-09-29T10:00:00Z"));
    expect(t).toContain("```SAVE5```");
    expect(t).toContain("₪5 הנחה");
    expect(t).toContain("לפי תנאי הקופון");
    expect(couponsText([], new Date())).toContain("אין כרגע קופונים");
  });
  it("describes the next sale with the owner's dates note, or none", () => {
    const sale = {
      id: "s",
      type: "holiday",
      title: "מבצע 11.11",
      body: "",
      product_id: null,
      coupon_code: null,
      starts_at: "2026-11-10T22:00:00Z",
      ends_at: "2026-11-12T22:00:00Z",
      published: true,
      created_at: "",
    } satisfies Deal;
    const t = saleText(sale, new Date("2026-10-30T10:00:00Z"));
    expect(t).toContain("מבצע 11.11");
    expect(t).toContain("מתחיל ב־");
    expect(t).toContain("תאריכים לפי אלי אקספרס ולפי המועדים של השנים הקודמות");
    expect(saleText(sale, new Date("2026-11-11T10:00:00Z"))).toContain("רץ עכשיו");
    expect(saleText(null, new Date())).toContain("/sales");
  });
  it("cuts a plain text message to the limit", () => {
    const m = text("א".repeat(5000));
    assertWithinLimits(m);
  });
});
