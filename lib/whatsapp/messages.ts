// The messages the bot sends, built as pure functions of our data. Every builder keeps within the
// limits Meta documents for its message type (checked 2026-09-29, tests in messages.test.ts), and
// keeps the site's promises: numbers are AliExpress's, the buy link goes through /go, and the
// affiliate note sits with every buy button (CLAUDE.md §1).
import { absoluteUrl } from "@/lib/config/site";
import { AFFILIATE_NOTE, APPROX_PRICE_NOTE, BUY_LABEL, SALE_DATES_NOTE } from "@/lib/copy";
import { OWNER_COUPON_NOTE, couponTiming, minSpendText } from "@/lib/coupons/display";
import type { Coupon } from "@/lib/coupons/types";
import { formatTimeLeft } from "@/lib/deals/time";
import { formatCount, formatIls, formatPct, formatShortDate, timeUntil } from "@/lib/format";
import { HOT_FILTER_NOTE, HOT_TITLES_NOTE } from "@/lib/hot/copy";
import type { HotProduct } from "@/lib/hot/select";
import { isAllowedImage } from "@/lib/images";
import { hotTitle } from "@/lib/product-title";
import type { Deal, FilterChip, ResultProduct, SortPreference } from "@/lib/types";
import { actionId, type Action } from "./intent";

/** Meta's limits per element (interactive messages: reply buttons, lists, CTA URL). */
export const LIMITS = {
  textBody: 4096,
  ctaBody: 1024,
  buttonsBody: 1024,
  listBody: 4096,
  footer: 60,
  headerText: 60,
  ctaLabel: 20,
  buttonTitle: 20,
  listButton: 20,
  rowTitle: 24,
  rowDescription: 72,
  sectionTitle: 24,
  buttons: 3,
  rows: 10,
} as const;

export type WaMessage =
  | { type: "text"; text: { body: string; preview_url?: boolean } }
  | { type: "interactive"; interactive: Interactive };

type Interactive =
  | {
      type: "cta_url";
      header?: { type: "image"; image: { link: string } };
      body: { text: string };
      footer?: { text: string };
      action: { name: "cta_url"; parameters: { display_text: string; url: string } };
    }
  | {
      type: "button";
      header?: { type: "text"; text: string };
      body: { text: string };
      footer?: { text: string };
      action: { buttons: { type: "reply"; reply: { id: string; title: string } }[] };
    }
  | {
      type: "list";
      header?: { type: "text"; text: string };
      body: { text: string };
      footer?: { text: string };
      action: {
        button: string;
        sections: {
          title: string;
          rows: { id: string; title: string; description?: string }[];
        }[];
      };
    };

/** Cuts `text` to `max` characters, with an ellipsis when it had to cut. */
export function clip(text: string, max: number): string {
  const chars = [...text.trim()];
  return chars.length <= max
    ? chars.join("")
    : `${chars
        .slice(0, max - 1)
        .join("")
        .trimEnd()}…`;
}

export const text = (body: string): WaMessage => ({
  type: "text",
  text: { body: clip(body, LIMITS.textBody) },
});

export const SORT_LABELS: Record<SortPreference, string> = {
  best_value: "הכי משתלם",
  cheapest: "הכי זול",
  most_popular: "הכי נמכר",
};

/** The affiliate note under a buy button, with the address of its full text. */
export const affiliateFooter = (): string =>
  clip(
    `${AFFILIATE_NOTE.label}: ${absoluteUrl(AFFILIATE_NOTE.href).replace("https://", "")}`,
    LIMITS.footer,
  );

/**
 * WhatsApp shows a photo header only for JPEG or PNG (WebP is for stickers). The site's own
 * resized copies (lib/images.ts) are WebP, so a card uses the original photo, only when it is a
 * JPEG or PNG on AliExpress's image host; otherwise the card has no photo.
 */
export function cardImage(urls: readonly string[]): string | null {
  return urls.find((u) => isAllowedImage(u) && /\.(jpe?g|png)$/i.test(u)) ?? null;
}

function ctaCard(input: { image: string | null; body: string; url: string }): WaMessage {
  return {
    type: "interactive",
    interactive: {
      type: "cta_url",
      ...(input.image ? { header: { type: "image" as const, image: { link: input.image } } } : {}),
      body: { text: clip(input.body, LIMITS.ctaBody) },
      footer: { text: affiliateFooter() },
      action: {
        name: "cta_url",
        parameters: { display_text: clip(BUY_LABEL, LIMITS.ctaLabel), url: input.url },
      },
    },
  };
}

/** /go/<id>: logs the click, then redirects to the affiliate link. `src` names this channel. */
export function goUrl(
  productId: string,
  src: "whatsapp" | "whatsapp_hot",
  ref?: { searchUid?: string | undefined; position?: number },
): string {
  const params = new URLSearchParams({ src });
  if (ref?.searchUid) params.set("s", ref.searchUid);
  if (ref?.position) params.set("pos", String(ref.position));
  return absoluteUrl(`/go/${productId}?${params.toString()}`);
}

/** One search result as a photo card with a buy button. */
export function resultCard(
  p: ResultProduct & { search_uid?: string },
  position: number,
  sharedNote: string | null,
): WaMessage {
  const lines = [`*${position}. ${clip(p.title_he, 200)}*`, ""];
  const price = [formatIls(p.price_ils, p.price_is_approx)];
  if (p.original_price_ils && p.discount_pct) {
    price.push(
      `(במקום ${formatIls(p.original_price_ils, p.price_is_approx)}, ${p.discount_pct}% הנחה)`,
    );
  }
  lines.push(price.join(" "));
  const trust = [
    p.positive_feedback_pct !== null ? `${formatPct(p.positive_feedback_pct)} משוב חיובי` : null,
    p.units_sold !== null ? `${formatCount(p.units_sold)} נמכרו ב־30 הימים האחרונים` : null,
  ].filter(Boolean);
  if (trust.length) lines.push(trust.join(" · "));
  lines.push("", p.why_he);
  if (sharedNote) lines.push("", `_${sharedNote}_`);
  if (p.price_is_approx) lines.push("", APPROX_PRICE_NOTE);
  return ctaCard({
    image: cardImage(p.image_urls),
    body: lines.join("\n"),
    url: goUrl(p.product_id, "whatsapp", { searchUid: p.search_uid, position }),
  });
}

/** One hot-list product (AliExpress's own Hebrew title, machine-translated). */
export function hotCard(p: HotProduct, position: number): WaMessage {
  const lines = [`*${position}. ${clip(hotTitle(p.title), 200)}*`, ""];
  lines.push(
    p.originalPrice && p.discountPct
      ? `${formatIls(p.price, false)} (במקום ${formatIls(p.originalPrice, false)}, ${p.discountPct}% הנחה)`
      : formatIls(p.price, false),
  );
  lines.push(
    `${formatPct(p.positiveFeedbackPct)} משוב חיובי · ${formatCount(p.unitsSold)} נמכרו ב־30 הימים האחרונים`,
  );
  return ctaCard({
    image: cardImage([p.imageUrl]),
    body: lines.join("\n"),
    url: goUrl(p.productId, "whatsapp_hot", { position }),
  });
}

export const hotIntro = (): WaMessage =>
  text(`*מוצרים חמים באלי אקספרס*\n${HOT_FILTER_NOTE}\n${HOT_TITLES_NOTE}`);

/** Buttons offered under the results: 5 more, and the other two orders. */
export function afterResults(input: {
  moreAvailable: boolean;
  sort: SortPreference;
  summary: string;
}): WaMessage {
  const actions: { action: Action; title: string }[] = [];
  if (input.moreAvailable) actions.push({ action: { type: "more" }, title: "עוד 5 אפשרויות" });
  for (const sort of Object.keys(SORT_LABELS) as SortPreference[]) {
    if (sort !== input.sort) {
      actions.push({ action: { type: "sort", sort }, title: SORT_LABELS[sort] });
    }
  }
  return {
    type: "interactive",
    interactive: {
      type: "button",
      body: { text: clip(input.summary, LIMITS.buttonsBody) },
      action: {
        buttons: actions.slice(0, LIMITS.buttons).map(({ action, title }) => ({
          type: "reply" as const,
          reply: { id: actionId(action), title: clip(title, LIMITS.buttonTitle) },
        })),
      },
    },
  };
}

/** "בדקנו X מוצרים. Y עברו" plus the understood filters, as /search shows them. */
export function searchSummary(input: {
  checked: number;
  passed: number;
  chips: readonly FilterChip[];
  page: number;
}): string {
  const chips = input.chips.map((c) => `״${c.label_he}״`).join(", ");
  const head = `בדקנו ${formatCount(input.checked)} מוצרים. ${formatCount(input.passed)} עברו את הסינון שלנו.`;
  const shown = input.page > 0 ? `מקומות ${input.page * 5 + 1}–${input.page * 5 + 5}.` : "";
  return [chips ? `הבנו: ${chips}` : null, head, shown].filter(Boolean).join("\n");
}

/** A list of the other things to do: removable filters, other orders, the site's other features. */
export function optionsList(input: {
  chips: readonly FilterChip[];
  sort: SortPreference;
  moreAvailable: boolean;
}): WaMessage {
  const sections: { title: string; rows: { id: string; title: string; description?: string }[] }[] =
    [];
  const removable = input.chips.filter((c) => c.removable).slice(0, 3);
  if (removable.length) {
    sections.push({
      title: "הסרת סינון",
      rows: removable.map((c) => ({
        id: actionId({ type: "drop", chipId: c.id }),
        title: clip(`בלי ״${c.label_he}״`, LIMITS.rowTitle),
        description: clip(`חיפוש חוזר בלי הסינון ״${c.label_he}״`, LIMITS.rowDescription),
      })),
    });
  }
  const other: Action[] = [{ type: "hot" }, { type: "coupons" }, { type: "sales" }];
  sections.push({
    title: "באתר",
    rows: [
      { id: actionId(other[0]!), title: "מוצרים חמים", description: "הנמכרים ביותר עכשיו" },
      { id: actionId(other[1]!), title: "קופונים", description: "קודי הנחה שאספנו" },
      { id: actionId(other[2]!), title: "מבצעים", description: "תאריכי המבצעים הגדולים" },
    ],
  });
  return {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: "רוצים לדייק או לראות עוד?" },
      action: {
        button: clip("אפשרויות", LIMITS.listButton),
        sections: sections.map((s) => ({
          title: clip(s.title, LIMITS.sectionTitle),
          rows: s.rows.slice(0, LIMITS.rows),
        })),
      },
    },
  };
}

export const WELCOME_TEXT =
  "היי, אני מצאתי.\nכתבו מה אתם צריכים בעברית חופשית, למשל: *אוזניות לריצה, עמידות למים, עד 100 ש״ח*, ואחזיר 5 מוצרים מאלי אקספרס שעברו סינון.";

/** The main menu: what the bot can do, one tap each. */
export function menuList(): WaMessage {
  return {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: WELCOME_TEXT },
      footer: { text: "מצאתי · עוזר קניות לאלי אקספרס" },
      action: {
        button: "מה אפשר לעשות",
        sections: [
          {
            title: "בחרו",
            rows: [
              { id: "hot", title: "מוצרים חמים", description: "הנמכרים ביותר באלי אקספרס" },
              { id: "coupons", title: "קופונים", description: "קודי הנחה שאספנו" },
              { id: "sales", title: "מבצעים", description: "מתי המבצע הגדול הבא" },
              { id: "help", title: "איך זה עובד", description: "טיפים לחיפוש טוב" },
            ],
          },
        ],
      },
    },
  };
}

export const HELP_TEXT = [
  "*איך מחפשים נכון?*",
  "כתבו מה אתם צריכים, מה חשוב לכם ותקציב: *מטען אלחוטי מהיר לאייפון, עד 80 ש״ח*.",
  "מחזירים 5 מוצרים בכל פעם. כל אחד עבר סינון: לפחות 90% משוב חיובי ו־100 מכירות ב־30 הימים האחרונים.",
  "את הנתונים (מחיר, משוב, מכירות) אנחנו לוקחים מאלי אקספרס, ולא ממציאים.",
  "אפשר לכתוב *עוד* לעוד 5, ואפשר להסיר סינון או לשנות סדר בכפתורים.",
  "פקודות: *תפריט*, *מוצרים חמים*, *קופונים*, *מבצעים*.",
  `הקישורים לאלי אקספרס הם קישורי שותפים: ${absoluteUrl(AFFILIATE_NOTE.href)}`,
].join("\n\n");

export const UNSUPPORTED_TEXT =
  "כרגע אני מבין רק הודעות טקסט. כתבו במילים מה אתם מחפשים, או שלחו *תפריט*.";

export const TOO_LONG_TEXT = "החיפוש ארוך מדי. נסו לקצר אותו לשורה אחת.";

export const STOP_TEXT =
  "בסדר, מחקנו את החיפוש האחרון שלכם מהשיחה. אנחנו לא שולחים הודעות ביוזמתנו. אפשר לכתוב לנו מתי שרוצים.";

export const EXPIRED_TEXT = "השיחה הקודמת כבר לא שמורה. כתבו חיפוש חדש ונתחיל מחדש.";

export const SLOW_TEXT = "עוד רגע, בודקים מול אלי אקספרס…";

export const NO_RESULTS_TEXT =
  "לא מצאנו מוצרים שעברו את הסינון שלנו לחיפוש הזה. נסו לנסח אחרת, להוריד מגבלת מחיר, או לכתוב פחות דרישות.";

/** What to say when the search failed (the codes of SearchFailure). */
export function failureText(error: string, retryAfterSec?: number): string {
  switch (error) {
    case "rate_limited":
      return retryAfterSec
        ? `ביקשתם הרבה חיפושים בזמן קצר. נסו שוב בעוד ${Math.max(1, Math.ceil(retryAfterSec / 60))} דקות.`
        : "ביקשתם הרבה חיפושים בזמן קצר. נסו שוב עוד מעט.";
    case "capacity":
      return "הגענו למכסת החיפושים להיום. חיפושים שכבר נעשו עדיין עובדים. נסו שוב מחר.";
    case "llm":
      return "השירות שמבין את החיפוש לא ענה בזמן. נסו שוב בעוד רגע.";
    case "upstream":
      return "אלי אקספרס לא ענתה בזמן. נסו שוב בעוד רגע.";
    case "invalid_query":
    case "parse_failed":
      return "לא הצלחנו להבין את החיפוש. נסו לנסח אחרת, בשורה אחת.";
    default:
      return "משהו השתבש אצלנו. נסו שוב בעוד רגע.";
  }
}

/** Owner coupons valid now, as one text message. */
export function couponsText(coupons: readonly Coupon[], now: Date): string {
  if (!coupons.length) {
    return "אין כרגע קופונים פעילים. כתבו *תפריט* כדי לראות מה עוד אפשר.";
  }
  const blocks = coupons.slice(0, 8).map((c) => {
    const timing = couponTiming(c, now);
    const min = minSpendText(c.min_spend_ils);
    const left = timing.state === "ending" ? `נגמר בעוד ${timing.left}` : null;
    return [`*${c.title}*`, min, left, `\`\`\`${c.code}\`\`\``].filter(Boolean).join("\n");
  });
  return [
    "*קופונים לאלי אקספרס*",
    ...blocks,
    OWNER_COUPON_NOTE,
    `עוד: ${absoluteUrl("/coupons")}`,
  ].join("\n\n");
}

/** The next big sale (or the one running), from the owner's dates. */
export function saleText(sale: Deal | null, now: Date): string {
  if (!sale) return `אין כרגע מבצע גדול מתוכנן. לוח המבצעים: ${absoluteUrl("/sales")}`;
  const starts = sale.starts_at ? new Date(sale.starts_at) : null;
  const ends = sale.ends_at ? new Date(sale.ends_at) : null;
  let when = "";
  if (starts && starts.getTime() > now.getTime()) {
    const left = timeUntil(starts, now);
    when = `מתחיל ב־${formatShortDate(sale.starts_at!)}${left ? ` (בעוד ${formatTimeLeft(left)})` : ""}`;
  } else if (ends) {
    const left = timeUntil(ends, now);
    when = `רץ עכשיו${left ? `, נגמר בעוד ${formatTimeLeft(left)}` : ""}`;
  } else {
    when = "רץ עכשיו";
  }
  return [
    `*${sale.title}*`,
    when,
    sale.coupon_code ? `קוד: \`\`\`${sale.coupon_code}\`\`\`` : null,
    SALE_DATES_NOTE,
    `כל המבצעים: ${absoluteUrl("/sales")}`,
  ]
    .filter(Boolean)
    .join("\n");
}
