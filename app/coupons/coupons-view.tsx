// The /coupons page body, shared by the page and the dev preview (app/dev/preview): the owner's
// coupons, the AliExpress codes of products we checked, and how to use a code. Data comes in as
// props (the page loads it), so the view never reads the database itself.
import Link from "next/link";
import { ChevronLeft, CloudOff, Inbox, Search } from "lucide-react";
import { API_CODE_DISCLAIMER, ApiOffer } from "@/components/api-promo-code";
import { CouponCard, CouponCodeRow, CouponValidity } from "@/components/coupon-card";
import { ProductImage } from "@/components/product-image";
import { StateCard } from "@/components/state-card";
import { btnMd, btnSecondary, card, featured } from "@/components/styles";
import type { ApiCodeProduct } from "@/lib/coupons/api-codes";
import { formatIsraelTime } from "@/lib/coupons/display";
import type { PublicCoupons } from "@/lib/coupons/queries";
import { formatShortDate } from "@/lib/format";
import { HOT_TITLES_NOTE, SOME_TITLES_NOTE } from "@/lib/hot/copy";
import { RESULTS_PER_PAGE } from "@/lib/config/site";

export const COUPONS_TITLE = "קופונים לאלי אקספרס";

const sectionTitle = "font-display text-2xl sm:text-3xl";
const grid = "grid gap-4 md:grid-cols-2 lg:grid-cols-3";

function OwnerCoupons({ coupons, now }: { coupons: PublicCoupons | null; now: Date }) {
  if (coupons === null) {
    return (
      <StateCard Icon={CloudOff} title="לא הצלחנו לטעון את הקופונים">
        <p className="max-w-md leading-relaxed text-muted">נסו לרענן את הדף בעוד רגע.</p>
      </StateCard>
    );
  }
  const { active, upcoming } = coupons;
  if (active.length === 0 && upcoming.length === 0) {
    return (
      <StateCard Icon={Inbox} title="אין כרגע קופונים פעילים">
        <p className="max-w-md leading-relaxed text-muted">
          כשנוסיף קופונים הם יופיעו כאן. בינתיים כתבו בחיפוש מה אתם צריכים, ונציג {RESULTS_PER_PAGE}{" "}
          מוצרים שעברו את הסינון.
        </p>
        <Link href="/" className={`${btnSecondary} ${btnMd}`}>
          <Search aria-hidden className="size-4" />
          לחיפוש מוצר
        </Link>
      </StateCard>
    );
  }
  return (
    <>
      <section aria-labelledby="active-title" className="space-y-4">
        <h2 id="active-title" className={sectionTitle}>
          קופונים פעילים
        </h2>
        {active.length > 0 ? (
          <ul className={grid}>
            {active.map((coupon) => (
              <li key={coupon.id} className="grid">
                <CouponCard coupon={coupon} now={now} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="leading-relaxed text-muted">
            אין כרגע קופון שאפשר להשתמש בו. הקופונים למטה מתחילים בקרוב.
          </p>
        )}
      </section>
      {upcoming.length > 0 && (
        <section aria-labelledby="upcoming-title" className="space-y-4">
          <h2 id="upcoming-title" className={sectionTitle}>
            מתחילים בקרוב
          </h2>
          <ul className={grid}>
            {upcoming.map((coupon) => (
              <li key={coupon.id} className="grid">
                <CouponCard coupon={coupon} now={now} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

function ApiCodeCard({ item, now }: { item: ApiCodeProduct; now: Date }) {
  const promo = item.promoCode;
  return (
    <article className={`${card} flex flex-col gap-4 p-5`}>
      <div className="flex items-start gap-4">
        {/* The title next to it names the product, so the photo is decorative here. */}
        <ProductImage
          src={item.imageUrl ?? undefined}
          alt=""
          sizes="80px"
          iconClassName="size-6"
          className="size-20 shrink-0 rounded-tile"
        />
        <div className="min-w-0 space-y-1">
          <h3 className="line-clamp-3 leading-snug font-semibold break-words">
            {item.titleIsHebrew ? item.title : <bdi dir="ltr">{item.title}</bdi>}
          </h3>
          <p className="text-sm text-muted">
            <span className="whitespace-nowrap">
              נבדק ב־<bdi dir="ltr">{formatShortDate(item.checkedAt)}</bdi>
            </span>{" "}
            בשעה <bdi dir="ltr">{formatIsraelTime(item.checkedAt)}</bdi>
          </p>
        </div>
      </div>
      <div className="space-y-1">
        {/* The same offer line as on /p, including AliExpress's own words when we cannot read it. */}
        <ApiOffer promo={promo} />
        <p className="text-sm text-muted">
          <CouponValidity startsAt={promo.startsAt} endsAt={promo.endsAt} now={now} />
        </p>
      </div>
      <CouponCodeRow code={promo.code} className="rounded-2xl bg-accent-soft p-2 ps-3" />
      <p className="text-xs leading-relaxed text-muted">
        קוד של אלי אקספרס למוצר הזה. {API_CODE_DISCLAIMER}
      </p>
      <Link
        href={`/p/${item.productId}`}
        className="mt-auto inline-flex min-h-11 items-center gap-1 self-start font-semibold text-accent-ink underline-offset-4 hover:underline"
      >
        לדף המוצר
        <span className="sr-only">: {item.title}</span>
        <ChevronLeft aria-hidden className="size-4" />
      </Link>
    </article>
  );
}

/** Said once for the section: products saved from a hot list carry AliExpress's Hebrew titles. */
function titlesNote(codes: ApiCodeProduct[] | null): string | null {
  const machine = codes?.filter((item) => item.machineTranslated).length ?? 0;
  if (machine === 0) return null;
  return machine === codes?.length ? HOT_TITLES_NOTE : SOME_TITLES_NOTE;
}

function ApiCodes({ codes, now }: { codes: ApiCodeProduct[] | null; now: Date }) {
  const note = titlesNote(codes);
  return (
    <section aria-labelledby="ali-codes-title" className="space-y-4">
      <div className="max-w-2xl space-y-2">
        <h2 id="ali-codes-title" className={sectionTitle}>
          קודים של אלי אקספרס למוצרים שבדקנו
        </h2>
        <p className="leading-relaxed text-muted">
          לחלק מהמוצרים אלי אקספרס מצמידה קוד הנחה משלה. אלה הקודים שהופיעו במוצרים שבדקנו ביומיים
          האחרונים, כל עוד הם בתוקף לפי התאריכים של אלי אקספרס.{note && ` ${note}`}
        </p>
      </div>
      {codes === null ? (
        <p className="flex items-start gap-2 rounded-2xl bg-surface-2 px-4 py-3 text-ink">
          <CloudOff aria-hidden className="mt-0.5 size-5 shrink-0" />
          לא הצלחנו לטעון את הקודים של אלי אקספרס. נסו לרענן את הדף בעוד רגע.
        </p>
      ) : codes.length === 0 ? (
        <p className="rounded-2xl bg-surface-2 px-4 py-3 text-ink">
          כרגע אין קוד כזה באף מוצר שבדקנו ביומיים האחרונים. הם מופיעים רק בחלק קטן מהמוצרים.
        </p>
      ) : (
        <ul className={grid}>
          {codes.map((item) => (
            <li key={item.productId} className="grid">
              <ApiCodeCard item={item} now={now} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function HowToUse() {
  return (
    <section aria-labelledby="how-title" className={`${featured} max-w-3xl space-y-4 p-6`}>
      <h2 id="how-title" className={sectionTitle}>
        איך משתמשים בקוד
      </h2>
      <ol className="list-decimal space-y-2 ps-5 leading-relaxed marker:font-bold">
        <li>לחצו על ״העתקה״ ליד הקוד.</li>
        <li>הוסיפו לעגלה באלי אקספרס את מה שאתם רוצים לקנות, ועברו לקופה.</li>
        <li>בקופה, הדביקו את הקוד בשדה של קוד הקופון ואשרו אותו.</li>
        <li>
          לפני התשלום, בדקו בסיכום ההזמנה שההנחה התקבלה. אם לא, ייתכן שהקוד הסתיים, נוצל עד הסוף או
          לא מתאים להזמנה הזאת.
        </li>
      </ol>
      <p className="text-sm leading-relaxed text-muted">
        קופון למוצר עובד רק על המוצר שלו, ולחלק מהקופונים יש סכום מינימום להזמנה. התנאים של כל קוד
        כתובים בכרטיס שלו.
      </p>
    </section>
  );
}

/** Null data is a failed load: that section shows an error line instead. */
export function CouponsView({
  coupons,
  apiCodes,
  now,
}: {
  coupons: PublicCoupons | null;
  apiCodes: ApiCodeProduct[] | null;
  now: Date;
}) {
  return (
    <div className="mx-auto max-w-6xl space-y-12 px-4 pt-8 sm:px-6 sm:pt-12">
      <div className="max-w-2xl space-y-3">
        <h1 className="font-display text-4xl sm:text-5xl">{COUPONS_TITLE}</h1>
        <p className="text-lg leading-relaxed text-muted">
          קופונים שהוספנו בעצמנו, וקודים שאלי אקספרס מצמידה למוצרים שבדקנו. כל קוד מוזן בקופה של אלי
          אקספרס, וההנחה לפי תנאי הקופון.
        </p>
      </div>
      <OwnerCoupons coupons={coupons} now={now} />
      <ApiCodes codes={apiCodes} now={now} />
      <HowToUse />
    </div>
  );
}
