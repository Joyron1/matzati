// Development-only visual previews of the coupon, sale and product-page sections and of the search
// waiting screen, rendered with the real page views and made-up data, so every state can be looked
// at (and screenshotted) in both themes without a database row or an API call:
// /dev/preview/coupons, /dev/preview/sales, /dev/preview/product-extras (a product opened from a
// search: video first in the gallery, coupons, variants, similar products),
// /dev/preview/product-hot (opened from /hot, with AliExpress's Hebrew title and the hot list's
// similar products), and the /search view (./search-previews.tsx): /dev/preview/search-loading
// (the wait, then the results), /dev/preview/search-results and /dev/preview/search-update, and
// /dev/preview/admin-settings (the /admin/settings form, whose action here saves nothing),
// /dev/preview/footer (the footer and its newsletter form, which stores nothing here) and
// /dev/preview/admin-newsletter (the /admin/newsletter view) from ./footer-previews.tsx, and
// /dev/preview/seo-page (an SEO landing page with a made-up snapshot of 50 products,
// ./seo-previews.tsx), and /dev/preview/products-category (a /products category page with a made-up
// list, ./products-previews.tsx).
// A 404 in production, noindex, disallowed in robots.txt and never
// listed in the sitemap. Nothing here reads the database, AliExpress or an LLM.
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { CouponsView } from "@/app/coupons/coupons-view";
import { ProductView } from "@/app/p/[productId]/product-view";
import { SalesIntro, SalesView } from "@/app/sales/sales-view";
import { DealsBoard } from "@/components/deals-board";
import { SaleCountdown } from "@/components/sale-countdown";
import { SimilarProducts } from "@/components/similar-products";
import type { AliPromoCode } from "@/lib/aliexpress/promo-code";
import type { AliSkuDetails } from "@/lib/aliexpress/schemas";
import type { ApiCodeProduct } from "@/lib/coupons/api-codes";
import type { Coupon, PublicCoupons } from "@/lib/coupons/types";
import { hotBack, hotProductHref } from "@/lib/hot/params";
import type { ProductPageData } from "@/lib/search/server";
import {
  searchProductHref,
  type SimilarItem,
  type SimilarProducts as SimilarProductsData,
} from "@/lib/similar/select";
import type { Deal } from "@/lib/types";
import { SettingsIntro } from "@/app/admin/settings/settings-intro";
import { DEFAULT_SHOP_CAP_MODE, isShopCapMode } from "@/lib/ranking/config";
import { AdminNewsletterPreview, FooterPreview } from "./footer-previews";
import { RecentStripPreview } from "./home-previews";
import { PreviewSettingsForm } from "./preview-controls";
import { PreviewCommunityForm, PreviewGoogleForm, PreviewMetaForm } from "./settings-previews";
import { isSearchScreen, SearchPreview } from "./search-previews";
import { CategoryPreview } from "./products-previews";
import { SeoPagePreview } from "./seo-previews";

export const metadata: Metadata = {
  title: "תצוגה מקדימה לפיתוח",
  robots: { index: false, follow: false },
};

const SCREENS = [
  "coupons",
  "sales",
  "product-extras",
  "product-hot",
  "search-loading",
  "search-results",
  "search-update",
  "recent-strip",
  "admin-settings",
  "footer",
  "admin-newsletter",
  "seo-page",
  "products-category",
] as const;
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

/** The search the product preview's similar products link with (made-up product ids: a 404). */
const PREVIEW_PRODUCT_QUERY = "תיק לכבלים לנסיעות";

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
    machineTranslated: false,
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

/** Photos from the product.query fixture (AliExpress's image CDN), so the gallery has real images. */
const IMG = (name: string) => `https://ae-pic-a1.aliexpress-media.com/kf/${name}`;
const GALLERY_IMAGES = [
  "S1054b9147d9e485388688a21f0437e4dL.jpg",
  "Sc36c59e5fe24402c874d8cd16bbb123dD.jpg",
  "Scb7416e62d2d42ad8e070094cf5a9f60b.jpg",
  "S7dbdac86722a4bc4aa9d3c79c67a7190P.jpg",
  "S599b8deeab1e40588d8202ecb8a88e9bi.jpg",
  "S320805b5a05146c6a6ebd8b624f1eb9aG.jpg",
].map(IMG);

/** Eight made-up similar products: Hebrew titles, an English one, and shared numbers. */
function similarItems(href: (id: string) => string, hebrewOnly = false): SimilarItem[] {
  const rows: [string, string, number, number | null, number, number][] = [
    [
      "S77915714249b42d583972e4076b2b04dZ.jpg",
      "מארגן כבלים מסיליקון לשולחן (לדוגמה)",
      9.9,
      19.9,
      97.8,
      4210,
    ],
    [
      "S208e59066ea64143963230db82f0e2148.jpg",
      "קליפסים דביקים לסידור כבלים (לדוגמה)",
      6.5,
      null,
      98.4,
      12034,
    ],
    [
      "S2e87e57a7fc944399088a820931f12bbc.jpg",
      hebrewOnly
        ? "תיק נסיעות לכבלים ומטענים, עמיד במים, עם תאים (לדוגמה)"
        : "USB Cable Storage Bag Multifunctional Travel Portable Organizer (sample)",
      24.3,
      41.0,
      96.1,
      860,
    ],
    [
      "S7b9e52a1027f4e21bf9eb89a4338ee35y.jpg",
      "מלפף כבלים לאוזניות ולעכבר (לדוגמה)",
      5.2,
      8.9,
      97.0,
      3120,
    ],
    [
      "S5d6b30ff6d9b4ec2869eeab07895e0d3e.jpg",
      "סט 20 קליפסים לכבלים (לדוגמה)",
      11.4,
      null,
      98.0,
      1500,
    ],
    [
      "Sfecc881ce40e473aa689cf8947a36634V.jpg",
      "מחזיק כבלים מסיליקון, 5 חריצים (לדוגמה)",
      7.8,
      12.5,
      95.5,
      640,
    ],
    [
      "Sd7e3f2fe05b6472d928954de4f0dd910n.jpg",
      "30 קליפסים לשולחן העבודה (לדוגמה)",
      13.9,
      25.0,
      96.7,
      2290,
    ],
    [
      "S7b338a2be52747c0905f3efe50a7d343m.jpg",
      "סרט סקוץ׳ לכבלים באורך 5 מטר (לדוגמה)",
      8.6,
      null,
      97.3,
      980,
    ],
  ];
  return rows.map(([image, title, price, original, pct, sold], i) => {
    const productId = `10000000000001${String(i).padStart(2, "0")}`;
    return {
      productId,
      href: href(productId),
      title,
      imageUrl: IMG(image),
      price: {
        price_ils: price,
        original_price_ils: original,
        price_is_approx: false,
        discount_pct: original ? Math.round((1 - price / original) * 100) : null,
      },
      trust: {
        positive_feedback_pct: pct,
        units_sold: sold,
        // One listing of a shop that shares numbers, as the result cards show it.
        ...(i === 4 && !hebrewOnly ? { shared_numbers: { feedback: true, sales: false } } : {}),
      },
    };
  });
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
      title_he: "מוצר לדוגמה: תיק אחסון עמיד במים לכבלים ולמטענים (נתונים מומצאים)",
      title_en: "Sample Cable Storage Bag, Waterproof Organizer (made-up preview data)",
      why_he: "",
      price_ils: 45.9,
      original_price_ils: 89.9,
      price_is_approx: false,
      discount_pct: 49,
      positive_feedback_pct: 96,
      units_sold: 349,
      passed_tier: "standard",
      image_urls: GALLERY_IMAGES,
      category_id: null,
    },
    detailUrl: `https://www.aliexpress.com/item/${FAKE_PRODUCT_ID}.html`,
    shopName: "חנות לדוגמה",
    updatedAt: at(now, -3 * HOUR),
    tips: [
      "טיפ כללי לדוגמה: בדקו את המידות הפנימיות מול המטענים והכבלים שתרצו לשים בתיק.",
      "טיפ כללי לדוגמה: חפשו ״עמיד במים״ עם תקן מוגדר, לא רק ״דוחה מים״.",
      "טיפ כללי לדוגמה: רוכסן כפול ותאים עם גומי מחזיקים את הכבלים במקום.",
      "טיפ כללי לדוגמה: בתמונות של המוכר חפשו תמונה של התיק מלא, לא רק ריק.",
    ],
    tipsCategoryHe: "אביזרי נסיעה",
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
    // A made-up address: the gallery starts the video after mount (unless reduced motion or
    // Save-Data), so the browser asks AliExpress's video host for it once, gets an error, and the
    // poster stays.
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

export default async function PreviewPage({
  params,
  searchParams,
}: PageProps<"/dev/preview/[screen]">) {
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

  if (screen === "admin-settings") {
    // The /admin/settings forms (sign-in only there), with actions that save nothing.
    // ?mode=max2 selects the other choice, ?error=1 shows the "could not save" message and the
    // field messages, ?google=none shows no Google connection, ?meta=none no Meta Pixel,
    // ?community=on a shown community button and ?community=none no link.
    const params = await searchParams;
    const mode = isShopCapMode(params.mode) ? params.mode : DEFAULT_SHOP_CAP_MODE;
    const google =
      params.google === "none"
        ? { measurementId: null, siteVerification: null }
        : { measurementId: "G-PREVIEW123", siteVerification: "PreviewToken_made-up_0123456789" };
    const community =
      params.community === "none"
        ? { url: null, label: "הצטרפו לקהילה שלנו", enabled: false }
        : {
            url: "https://chat.whatsapp.com/PreviewMadeUpInvite",
            label: "הצטרפו לקהילה שלנו",
            enabled: params.community === "on",
          };
    return (
      <>
        <FakeDataNote>כמו דף ההגדרות בניהול. השמירה כאן לא שומרת כלום.</FakeDataNote>
        <div className="mx-auto max-w-3xl space-y-6 px-4 pt-8 sm:px-6 sm:pt-12">
          <SettingsIntro />
          <p className="text-sm text-muted">נשמרה לאחרונה ב־28.9.2026, 23:00 (לדוגמה).</p>
          <PreviewSettingsForm mode={mode} failed={params.error === "1"} />
          <div className="space-y-10 pt-6">
            <PreviewGoogleForm stored={google} failed={params.error === "1"} />
            <PreviewMetaForm
              storedPixelId={params.meta === "none" ? null : "1234567890123456"}
              failed={params.error === "1"}
            />
            <PreviewCommunityForm stored={community} failed={params.error === "1"} />
          </div>
        </div>
      </>
    );
  }

  if (screen === "footer") {
    // The footer and its newsletter form, which stores nothing here (./footer-previews.tsx).
    return (
      <FooterPreview
        params={await searchParams}
        note={(text) => <FakeDataNote>{text}</FakeDataNote>}
      />
    );
  }

  if (screen === "admin-newsletter") {
    // The /admin/newsletter view with ?n= made-up subscribers (./footer-previews.tsx).
    return (
      <>
        <FakeDataNote>כמו דף הניוזלטר בניהול, עם רשומים מומצאים. אין כאן ייצוא.</FakeDataNote>
        <AdminNewsletterPreview params={await searchParams} now={now} />
      </>
    );
  }

  if (screen === "products-category") {
    // A /products category page with a made-up list (./products-previews.tsx).
    return (
      <CategoryPreview
        params={await searchParams}
        now={now}
        note={(text) => <FakeDataNote>{text}</FakeDataNote>}
      />
    );
  }

  if (screen === "seo-page") {
    // An SEO landing page with a made-up snapshot of 50 products (./seo-previews.tsx).
    return (
      <SeoPagePreview
        params={await searchParams}
        now={now}
        note={(text) => <FakeDataNote>{text}</FakeDataNote>}
      />
    );
  }

  if (screen === "recent-strip") {
    // The home "חיפושים אחרונים" strip with ?n= made-up searches (./home-previews.tsx).
    const n = Math.min(6, Math.max(1, Number((await searchParams).n) || 2));
    return (
      <>
        <FakeDataNote>{`רצועת החיפושים האחרונים של דף הבית, עם ${n} חיפושים לדוגמה.`}</FakeDataNote>
        <RecentStripPreview n={n} now={now} />
      </>
    );
  }

  if (isSearchScreen(screen)) {
    // The /search view: the wait, then the results (./search-previews.tsx).
    return (
      <SearchPreview
        screen={screen}
        params={await searchParams}
        now={now}
        note={(text) => <FakeDataNote>{text}</FakeDataNote>}
      />
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

  if (screen === "product-hot") {
    // Saved from a hot list: no title of ours, and AliExpress's title is its Hebrew machine
    // translation, with Latin words and numbers that must stay in reading order.
    const base = productData(now);
    const title = "מוצר לדוגמה: כיסוי טלפון לאייפון 17, 18 Pro Max עם MagSafe (נתונים מומצאים)";
    const data: ProductPageData = {
      ...base,
      product: { ...base.product, title_he: title, title_en: title },
      ownerCoupons: [],
      skuDetails: null,
    };
    const similar: SimilarProductsData = {
      source: { kind: "hot", categoryHe: "מחשבים ומשרד" },
      checkedAt: at(now, -5 * HOUR),
      items: similarItems((id) => hotProductHref(id, "7"), true),
    };
    return (
      <>
        <FakeDataNote>
          כמו דף מוצר שנפתח מקטגוריה של כל המוצרים, עם השם של אלי אקספרס בעברית.
        </FakeDataNote>
        <ProductView
          data={data}
          q=""
          hotBack={hotBack({ from: "hot", cat: "7" })}
          now={now}
          similar={<SimilarProducts data={similar} className="mt-12" />}
        />
      </>
    );
  }

  // A product opened from a search: the similar products are the rest of that search's results.
  const similar: SimilarProductsData = {
    source: { kind: "search" },
    checkedAt: at(now, -26 * HOUR),
    items: similarItems((id) => searchProductHref(id, PREVIEW_PRODUCT_QUERY)),
  };
  return (
    <>
      <FakeDataNote>
        כמו דף מוצר שנפתח מחיפוש, עם סרטון, קופון שלנו, קוד של אלי אקספרס, צבעים ומידות ומוצרים
        דומים.
      </FakeDataNote>
      {/* No q: its back link would open /search, which runs a real search. */}
      <ProductView
        data={productData(now)}
        q=""
        now={now}
        similar={<SimilarProducts data={similar} className="mt-12" />}
      />
    </>
  );
}
