// Development-only visual previews of the coupon, sale and product-page sections, rendered with
// the real page views and made-up data, so every state can be looked at (and screenshotted) in
// both themes without a database row or an API call: /dev/preview/coupons, /dev/preview/sales,
// /dev/preview/product-extras. A 404 in production, noindex, disallowed in robots.txt and never
// listed in the sitemap. Nothing here reads the database, AliExpress or an LLM.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CouponsView } from "@/app/coupons/coupons-view";
import { ProductView } from "@/app/p/[productId]/product-view";
import { SalesIntro, SalesView } from "@/app/sales/sales-view";
import { DealsBoard } from "@/components/deals-board";
import { SaleCountdown } from "@/components/sale-countdown";
import type { AliPromoCode } from "@/lib/aliexpress/promo-code";
import type { AliSkuDetails } from "@/lib/aliexpress/schemas";
import type { ApiCodeProduct } from "@/lib/coupons/api-codes";
import type { Coupon, PublicCoupons } from "@/lib/coupons/types";
import type { ProductPageData } from "@/lib/search/server";
import type { Deal } from "@/lib/types";

export const metadata: Metadata = {
  title: "תצוגה מקדימה לפיתוח",
  robots: { index: false, follow: false },
};

const SCREENS = ["coupons", "sales", "product-extras"] as const;
type Screen = (typeof SCREENS)[number];

const isScreen = (value: string): value is Screen => (SCREENS as readonly string[]).includes(value);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** An instant `ms` from `now`, as ISO. */
const at = (now: Date, ms: number) => new Date(now.getTime() + ms).toISOString();

/** Israel midnight `days` days from today: an end that should print as the day before. */
function israelMidnight(now: Date, days: number): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem" }).format(
    new Date(now.getTime() + days * DAY),
  );
  // Israel is UTC+2 or +3; try both and keep the one that is midnight there.
  for (const offset of ["+02:00", "+03:00"]) {
    const iso = new Date(`${day}T00:00:00${offset}`).toISOString();
    const clock = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Jerusalem",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(iso));
    if (clock === "00:00") return iso;
  }
  return at(now, days * DAY);
}

const FAKE_PRODUCT_ID = "1000000000000001";

function coupon(now: Date, over: Partial<Coupon>): Coupon {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    code: "PREVIEW5",
    title: "₪5 הנחה",
    terms: null,
    min_spend_ils: null,
    scope: "sitewide",
    product_id: null,
    sale_id: null,
    starts_at: null,
    ends_at: null,
    featured: false,
    published: true,
    created_at: at(now, -DAY),
    updated_at: at(now, -DAY),
    ...over,
  };
}

function promo(now: Date, over: Partial<AliPromoCode>): AliPromoCode {
  return {
    code: "FAKE0O0CODE",
    offerText: "On order over ILS 62.2 , get ILS 3.11 off",
    offer: { kind: "amount", off: 3.11, minSpend: 62.2, currency: "ILS" },
    minSpend: 62.2,
    startsAt: at(now, -10 * DAY),
    endsAt: at(now, 20 * DAY),
    promotionUrl: null,
    ...over,
  };
}

function apiCode(now: Date, n: number, title: string, code: AliPromoCode): ApiCodeProduct {
  return {
    productId: `10000000000000${10 + n}`,
    title,
    titleIsHebrew: !/^[A-Za-z]/.test(title),
    imageUrl: null,
    checkedAt: at(now, -(n + 1) * HOUR),
    promoCode: code,
  };
}

function couponsData(now: Date): { coupons: PublicCoupons; apiCodes: ApiCodeProduct[] } {
  return {
    coupons: {
      active: [
        coupon(now, {
          id: "00000000-0000-4000-8000-000000000011",
          code: "PREVIEWSITE10",
          title: "₪10 הנחה על כל ההזמנה (לדוגמה)",
          terms: "קופון לדוגמה בלבד.\nתקף פעם אחת לכל חשבון.",
          min_spend_ils: 80,
          featured: true,
          ends_at: at(now, 3 * DAY + 5 * HOUR),
        }),
        coupon(now, {
          id: "00000000-0000-4000-8000-000000000012",
          code: "PREVIEW-PRODUCT-CODE-WITH-A-VERY-LONG-N",
          title: "₪7 הנחה על מוצר לדוגמה",
          scope: "product",
          product_id: FAKE_PRODUCT_ID,
          min_spend_ils: 40,
          // Ends at Israel midnight: the card says the day before.
          ends_at: israelMidnight(now, 5),
        }),
        coupon(now, {
          id: "00000000-0000-4000-8000-000000000013",
          code: "NOEND",
          title: "5% הנחה ללא תאריך סיום (לדוגמה)",
        }),
      ],
      upcoming: [
        coupon(now, {
          id: "00000000-0000-4000-8000-000000000014",
          code: "SOON11",
          title: "₪11 הנחה בפתיחת המבצע (לדוגמה)",
          starts_at: at(now, 6 * DAY + 8 * HOUR),
          ends_at: at(now, 9 * DAY),
        }),
      ],
    },
    apiCodes: [
      apiCode(now, 1, "מוצר לדוגמה: מחזיק טלפון לרכב", promo(now, { endsAt: at(now, 2 * DAY) })),
      apiCode(
        now,
        2,
        "מוצר לדוגמה: כבל טעינה, קוד באחוזים בלי מינימום",
        promo(now, {
          code: "FAKEPCT5",
          offerText: "5% off",
          offer: { kind: "percent", pct: 5, minSpend: null, currency: null },
          minSpend: 0,
        }),
      ),
      apiCode(
        now,
        3,
        "Sample product: offer in another currency",
        promo(now, {
          code: "FAKEUSD3",
          offerText: "On order over USD 20 , get USD 3 off",
          offer: { kind: "amount", off: 3, minSpend: 20, currency: "USD" },
          minSpend: 20,
        }),
      ),
      apiCode(
        now,
        4,
        "מוצר לדוגמה: תיאור שלא זיהינו",
        promo(now, {
          code: "FAKEGIFT",
          offerText: "Get a free gift on orders over ILS 20",
          offer: null,
          minSpend: 20,
        }),
      ),
    ],
  };
}

function sale(now: Date, over: Partial<Deal>): Deal {
  return {
    id: "00000000-0000-4000-8000-000000000101",
    type: "holiday",
    title: "מבצע לדוגמה",
    body: "",
    product_id: null,
    coupon_code: null,
    starts_at: at(now, 2 * DAY),
    ends_at: at(now, 4 * DAY),
    published: true,
    created_at: at(now, -DAY),
    ...over,
  };
}

function salesData(now: Date) {
  const running = sale(now, {
    id: "00000000-0000-4000-8000-000000000101",
    title: "מבצע סוף העונה (לדוגמה)",
    body: "תיאור לדוגמה של המבצע, כמו שהמנהל כותב אותו.",
    coupon_code: "PREVIEWSALE20",
    product_id: FAKE_PRODUCT_ID,
    starts_at: at(now, -DAY),
    ends_at: israelMidnight(now, 3),
  });
  const next = sale(now, {
    id: "00000000-0000-4000-8000-000000000102",
    title: "11.11 (לדוגמה)",
    starts_at: at(now, 20 * DAY),
    ends_at: at(now, 23 * DAY),
  });
  const noEnd = sale(now, {
    id: "00000000-0000-4000-8000-000000000103",
    title: "מבצע בלי תאריך סיום (לדוגמה)",
    starts_at: at(now, 45 * DAY),
    ends_at: null,
  });
  const sales = [running, next, noEnd];
  const linked: Coupon[] = [
    coupon(now, {
      id: "00000000-0000-4000-8000-000000000201",
      code: "SALEPRODUCT12",
      title: "₪12 הנחה על מוצר לדוגמה",
      scope: "product",
      product_id: FAKE_PRODUCT_ID,
      sale_id: running.id,
      ends_at: running.ends_at,
    }),
    coupon(now, {
      id: "00000000-0000-4000-8000-000000000202",
      code: "SALESITEWIDE",
      title: "₪20 הנחה על כל האתר",
      min_spend_ils: 150,
      sale_id: running.id,
      ends_at: running.ends_at,
    }),
  ];
  return { sales, coupons: new Map([[running.id, linked]]) };
}

function productData(now: Date): ProductPageData {
  const skuDetails: AliSkuDetails = {
    reviewCount: null,
    score: null,
    skus: [
      ["שחור", "S", 45.9, "CN"],
      ["שחור", "M", 47.9, "CN"],
      ["לבן", "S", 45.9, "CN"],
      ["ירוק זית", "L", 52.4, "IL"],
    ].map(([color, size, price, shipFrom], i) => ({
      skuId: String(i + 1),
      color: String(color),
      size: String(size),
      imageUrl: null,
      price: Number(price),
      currency: "ILS",
      minDeliveryDays: 7,
      maxDeliveryDays: 14,
      shipFrom: String(shipFrom),
    })),
  };
  return {
    product: {
      product_id: FAKE_PRODUCT_ID,
      title_he: "מוצר לדוגמה: אוזניות אלחוטיות (נתונים מומצאים)",
      title_en: "Sample Wireless Earbuds (made-up preview data)",
      why_he: "",
      price_ils: 45.9,
      original_price_ils: 89.9,
      price_is_approx: false,
      discount_pct: 49,
      positive_feedback_pct: 96,
      units_sold: 349,
      passed_tier: "standard",
      image_urls: [],
      category_id: null,
    },
    detailUrl: `https://www.aliexpress.com/item/${FAKE_PRODUCT_ID}.html`,
    shopName: "חנות לדוגמה",
    updatedAt: at(now, -3 * HOUR),
    tips: [
      "טיפ כללי לדוגמה: בדקו את סוג החיבור לטעינה.",
      "טיפ כללי לדוגמה: חפשו תקן עמידות מוגדר.",
    ],
    tipsCategoryHe: "אוזניות",
    coupon: null,
    ownerCoupons: [
      coupon(now, {
        id: "00000000-0000-4000-8000-000000000301",
        code: "PREVIEWP7",
        title: "₪7 הנחה על המוצר (לדוגמה)",
        scope: "product",
        product_id: FAKE_PRODUCT_ID,
        min_spend_ils: 40,
        terms: "תנאים לדוגמה.",
        ends_at: israelMidnight(now, 4),
      }),
    ],
    apiCoupon: promo(now, { code: "AJO7RM0ITRX2" }),
    // Never loaded: preload="none", and nothing here presses play.
    videoUrl: "https://video.aliexpress-media.com/preview/made-up.mp4",
    skuDetails,
  };
}

/** Says on the page itself that nothing here is real. */
function FakeDataNote({ children }: { children: string }) {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-6">
      <p
        role="note"
        className="rounded-2xl bg-invert-bg px-4 py-3 text-sm font-semibold text-invert-ink"
      >
        תצוגה מקדימה לפיתוח בלבד. כל הנתונים כאן מומצאים. {children}
      </p>
    </div>
  );
}

export default async function PreviewPage({ params }: PageProps<"/dev/preview/[screen]">) {
  if (process.env.NODE_ENV === "production") notFound();
  const { screen } = await params;
  if (!isScreen(screen)) notFound();
  // Countdowns and "valid now" are computed from the time of the visit.
  await connection();
  const now = new Date();

  if (screen === "coupons") {
    const { coupons, apiCodes } = couponsData(now);
    return (
      <>
        <FakeDataNote>כמו דף הקופונים.</FakeDataNote>
        <CouponsView coupons={coupons} apiCodes={apiCodes} now={now} />
      </>
    );
  }

  if (screen === "sales") {
    const data = salesData(now);
    const [, next] = data.sales;
    return (
      <>
        <FakeDataNote>
          כמו דף המבצעים, ואחריו כרטיס המבצע של דף הבית וכרטיסי מבצע מדף הדילים.
        </FakeDataNote>
        <div className="mx-auto max-w-6xl space-y-10 px-4 pt-8 sm:space-y-12 sm:px-6 sm:pt-12">
          <SalesIntro hasSales />
          <SalesView data={data} now={now} />
          <div className="max-w-3xl">
            <SaleCountdown
              title={next.title}
              startsAt={next.starts_at ?? ""}
              endsAt={next.ends_at}
              renderedAt={now.getTime()}
              moreHref="/sales"
            />
          </div>
          <DealsBoard deals={[data.sales[0], next]} />
        </div>
      </>
    );
  }

  return (
    <>
      <FakeDataNote>
        כמו דף מוצר, עם קופון שלנו, קוד של אלי אקספרס, סרטון, צבעים ומידות.
      </FakeDataNote>
      <ProductView data={productData(now)} q="" now={now} />
    </>
  );
}
