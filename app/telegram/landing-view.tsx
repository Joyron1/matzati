// The /telegram landing page's content (./page.tsx): also the dev preview's (/dev/telegram-landing).
// Owner request 2026-10-31: a quiet Telegram group that only posts vetted products (consumer
// electronics, kids, small extras worth adding to the cart), the countdown to the next big sale
// (11.11, from the admin's sales calendar) and a join bar fixed to the bottom of the screen.
// Only what the group really does: the thresholds come from FILTERS, no member count or
// testimonial we do not have.
import Link from "next/link";
import { Baby, ChevronDown, Filter, Plug, ShoppingCart, Sparkles, VolumeX } from "lucide-react";
import { saleCalendarHref } from "@/components/sale-card";
import { SaleCountdown } from "@/components/sale-countdown";
import { card } from "@/components/styles";
import { ChannelPreview } from "@/components/telegram-join";
import { AFFILIATE_SECTION_ID, LEGAL_PATHS } from "@/lib/config/legal";
import type { Deal } from "@/lib/types";
import { FILTERS } from "@/lib/ranking/config";
import { JoinButton } from "./join-button";

/** The group the campaigns send to (the owner's link, 2026-10-31). */
export const TELEGRAM_DEALS_URL = "https://t.me/matzati_deals";

const CTA = "כן! אני רוצה להצטרף בחינם";
const FREE_NOTE = "חינם · בלי הרשמה · אפשר לעזוב מתי שרוצים";
const TRUST = `${FILTERS.minPositiveFeedbackPct}% משוב חיובי ומעלה ולפחות ${FILTERS.minUnitsSold} מכירות בחודש האחרון`;

export interface LandingSale {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
}

export function landingSale(deal: Deal | null): LandingSale | null {
  if (!deal?.starts_at) return null;
  return { id: deal.id, title: deal.title, startsAt: deal.starts_at, endsAt: deal.ends_at };
}

function Hero({ sale }: { sale: LandingSale | null }) {
  return (
    <section className="grid items-center gap-8 lg:grid-cols-[1.1fr_1fr]">
      <div className="space-y-5 text-center lg:text-start">
        <p className="inline-flex items-center gap-1.5 rounded-full bg-tg-soft px-3 py-1 text-sm font-semibold text-tg-ink">
          <VolumeX aria-hidden className="size-4" />
          קבוצת טלגרם שקטה
        </p>
        <h1 className="font-display text-4xl leading-tight text-balance sm:text-5xl">
          רק מוצרים איכותיים ואמינים מאלי אקספרס, ישר לטלגרם
        </h1>
        <p className="text-lg leading-relaxed text-pretty text-muted">
          בלי שיחות ובלי רעש. רק פרסומים של מוצרים שעברו את הסינון שלנו: מוצרי חשמל, מוצרים לילדים
          ואקסטרות קטנות ששווה להוסיף לעגלה. כל פרסום עם מחיר, משוב, מספר מכירות וקישור ישיר.
        </p>
        <div className="space-y-2">
          <JoinButton href={TELEGRAM_DEALS_URL} label={CTA} />
          <p className="text-sm text-muted">{FREE_NOTE}</p>
        </div>
        {sale && (
          <a
            href="#sale"
            className="inline-flex min-h-11 items-center gap-1 font-semibold text-accent-ink underline-offset-4 hover:underline"
          >
            {sale.title}: ספירה לאחור
            <ChevronDown aria-hidden className="size-4" />
          </a>
        )}
      </div>
      <div aria-hidden className="mx-auto w-full max-w-sm rounded-card bg-tg-soft p-5 shadow-soft">
        <ChannelPreview />
      </div>
    </section>
  );
}

function SaleSection({ sale, renderedAt }: { sale: LandingSale; renderedAt: number }) {
  const elevenEleven = sale.title.includes("11.11");
  return (
    <section id="sale" className="mx-auto max-w-3xl scroll-mt-24 space-y-4">
      <SaleCountdown
        title={sale.title}
        startsAt={sale.startsAt}
        endsAt={sale.endsAt}
        renderedAt={renderedAt}
        reminderHref={null}
        calendarHref={saleCalendarHref(sale.id)}
      >
        <div className="space-y-2 leading-relaxed text-ink">
          {elevenEleven ? (
            <>
              <p>
                11.11 הוא יום הקניות הגדול של השנה באלי אקספרס: הנחות, קופונים ומבצעים על מיליוני
                מוצרים, לכמה ימים בלבד.
              </p>
              <p>
                בקבוצה נפרסם לקראתו ובזמן המבצע מוצרים שעברו את הסינון שלנו, עם קודי ההנחה כשיש.
                מצטרפים עכשיו ומגיעים מוכנים, בלי לחפש בלחץ ברגע האחרון.
              </p>
            </>
          ) : (
            <p>
              בקבוצה נפרסם לקראת המבצע ובזמן המבצע מוצרים שעברו את הסינון שלנו, עם קודי ההנחה כשיש.
            </p>
          )}
        </div>
        <JoinButton href={TELEGRAM_DEALS_URL} label="הצטרפות לקבוצה לפני המבצע" />
      </SaleCountdown>
    </section>
  );
}

const CATEGORIES = [
  {
    Icon: Plug,
    title: "מוצרי חשמל",
    body: "מטענים, אוזניות, גאדג׳טים לבית ולרכב: מוצרים עם הרבה מכירות ומשוב גבוה.",
  },
  {
    Icon: Baby,
    title: "מוצרים לילדים",
    body: "משחקים, ציוד ואביזרים לילדים, רק מוצרים שהקונים באלי אקספרס מרוצים מהם.",
  },
  {
    Icon: ShoppingCart,
    title: "אקסטרות לעגלה",
    body: "דברים קטנים וזולים ששווה להוסיף להזמנה, ושמשתמשים בהם כל יום.",
  },
];

function Categories() {
  return (
    <section aria-labelledby="tg-what" className="space-y-6">
      <div className="space-y-1 text-center">
        <p className="text-sm font-semibold text-tg-ink">מה מתפרסם בקבוצה</p>
        <h2 id="tg-what" className="font-display text-3xl text-balance">
          מוצרים שבאמת שווים, משלוש קטגוריות
        </h2>
      </div>
      <ul className="grid gap-4 md:grid-cols-3">
        {CATEGORIES.map(({ Icon, title, body }) => (
          <li key={title} className={`${card} space-y-3 p-5`}>
            <div className="flex items-center gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-tg-to to-tg text-white">
                <Icon aria-hidden className="size-6" />
              </span>
              <h3 className="text-lg font-bold">{title}</h3>
            </div>
            <p className="leading-relaxed text-muted">{body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Why() {
  const points = [
    {
      Icon: Filter,
      title: "רק מה שעבר סינון",
      body: `כל מוצר עובר את הסינון שלנו לפני שהוא מתפרסם: ${TRUST}. כל המספרים מאלי אקספרס.`,
    },
    {
      Icon: VolumeX,
      title: "שקט, בלי הצפה",
      body: "כמה פרסומים ביום, בלי שיחות ובלי הודעות מיותרות. אפשר להשתיק ולהציץ מתי שנוח.",
    },
    {
      Icon: Sparkles,
      title: "הכל בפרסום אחד",
      body: "תמונות וסרטון של המוצר, המחיר, קוד הנחה כשיש, וקישור ישיר לקנייה באלי אקספרס.",
    },
  ];
  return (
    <section aria-labelledby="tg-why" className="space-y-6">
      <h2 id="tg-why" className="text-center font-display text-3xl text-balance">
        למה דווקא הקבוצה של מצאתי
      </h2>
      <ul className="grid gap-4 md:grid-cols-3">
        {points.map(({ Icon, title, body }) => (
          <li key={title} className="flex gap-3">
            <Icon aria-hidden className="mt-1 size-6 shrink-0 text-tg-ink" />
            <div className="space-y-1">
              <h3 className="font-bold">{title}</h3>
              <p className="leading-relaxed text-muted">{body}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Numbers() {
  const facts = [
    { value: "0 ₪", label: "עלות ההצטרפות" },
    { value: `${FILTERS.minPositiveFeedbackPct}%+`, label: "משוב חיובי לכל מוצר" },
    { value: `${FILTERS.minUnitsSold}+`, label: "מכירות בחודש האחרון" },
  ];
  return (
    <section
      aria-label="בקצרה"
      className="space-y-6 rounded-card bg-gradient-to-br from-tg-to to-tg px-5 py-8 text-center text-white sm:px-8"
    >
      <dl className="grid gap-6 sm:grid-cols-3">
        {facts.map((f) => (
          <div key={f.label} className="flex flex-col-reverse gap-1">
            <dt className="text-white/90">{f.label}</dt>
            <dd className="text-4xl font-bold">
              <bdi dir="ltr">{f.value}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      <p className="mx-auto max-w-xl text-lg font-semibold text-balance">
        מוכנים לקבל רק את המוצרים ששווים?
      </p>
      <JoinButton href={TELEGRAM_DEALS_URL} label={CTA} light />
    </section>
  );
}

const FAQ = [
  {
    q: "האם הקבוצה באמת חינמית?",
    a: "כן, לגמרי. כשקונים דרך הקישורים שלנו, אלי אקספרס משלמת לנו עמלה, והמחיר שלכם לא משתנה.",
  },
  {
    q: "כמה הודעות מקבלים?",
    a: "כמה פרסומים ביום, וזהו. אין בקבוצה שיחות, ואפשר להשתיק אותה ולהציץ מתי שנוח.",
  },
  {
    q: "איך בוחרים את המוצרים?",
    a: `רק מוצרים עם ${TRUST}, מהקטגוריות של מוצרי חשמל, מוצרים לילדים ואקסטרות לעגלה. כל המספרים מאלי אקספרס.`,
  },
  {
    q: "צריך להירשם או להשאיר פרטים?",
    a: "לא. מספיק חשבון טלגרם. אנחנו לא מקבלים את מספר הטלפון שלכם.",
  },
  {
    q: "אפשר לעזוב מתי שרוצים?",
    a: "כן, יוצאים מהקבוצה בטלגרם בלחיצה.",
  },
  {
    q: "איך מצטרפים?",
    a: "לוחצים על הכפתור הכחול, טלגרם נפתח עם הקבוצה, ולוחצים ״הצטרפות״. אין לכם טלגרם? מורידים אותו חינם מחנות האפליקציות.",
  },
];

function Faq() {
  return (
    <section aria-labelledby="tg-faq" className="mx-auto max-w-3xl space-y-4">
      <h2 id="tg-faq" className="text-center font-display text-3xl">
        שאלות נפוצות
      </h2>
      <div className="space-y-2">
        {FAQ.map((item) => (
          <details key={item.q} className={`${card} group p-0`}>
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-semibold [&::-webkit-details-marker]:hidden">
              {item.q}
              <ChevronDown
                aria-hidden
                className="size-5 shrink-0 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none"
              />
            </summary>
            <p className="px-5 pb-4 leading-relaxed text-muted">{item.a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

/** The join bar fixed to the bottom of the screen, on every width (the phone's tab bar is hidden here). */
function StickyJoin() {
  return (
    <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-4px_16px_rgba(0,0,0,0.08)] backdrop-blur print:hidden">
      <div className="mx-auto flex max-w-3xl items-center justify-center gap-4">
        <p className="hidden text-sm font-semibold sm:block">
          קבוצת טלגרם שקטה, רק מוצרים שעברו סינון
        </p>
        <JoinButton href={TELEGRAM_DEALS_URL} label="הצטרפות חינם לקבוצה" compact />
      </div>
    </div>
  );
}

export function TelegramLandingView({
  sale,
  renderedAt,
}: {
  sale: LandingSale | null;
  renderedAt: number;
}) {
  return (
    <>
      <div className="mx-auto max-w-6xl space-y-14 px-4 pt-8 pb-16 sm:space-y-20 sm:px-6 sm:pt-12">
        <Hero sale={sale} />
        {sale && <SaleSection sale={sale} renderedAt={renderedAt} />}
        <Categories />
        <Why />
        <Numbers />
        <Faq />
        <section className="space-y-3 text-center">
          <JoinButton href={TELEGRAM_DEALS_URL} label={CTA} />
          <p className="text-sm text-muted">{FREE_NOTE}</p>
          <p className="text-sm text-muted">
            הקישורים לאלי אקספרס הם קישורי שותפים.{" "}
            <Link
              href={`${LEGAL_PATHS.terms}#${AFFILIATE_SECTION_ID}`}
              className="underline underline-offset-4"
            >
              מה זה אומר
            </Link>
          </p>
        </section>
      </div>
      {/* Keeps the footer's end clear of the fixed bar. */}
      <div aria-hidden className="h-24" />
      <StickyJoin />
    </>
  );
}
