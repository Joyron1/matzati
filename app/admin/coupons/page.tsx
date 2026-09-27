import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck, CloudOff, Inbox, Plus } from "lucide-react";
import { StateCard } from "@/components/state-card";
import { btnMd, btnPrimary, card } from "@/components/styles";
import { requireAdmin } from "@/lib/admin/auth";
import { minSpendText } from "@/lib/coupons/display";
import { listAllCoupons } from "@/lib/coupons/queries";
import type { Coupon } from "@/lib/coupons/types";
import { hasEnded, hasStarted } from "@/lib/deals/time";
import { formatDateTime } from "@/lib/format";
import { firstParam } from "@/lib/search-url";
import { CouponRowActions } from "./coupon-row-actions";
import { loadSaleOptions } from "./sale-options";

export const metadata: Metadata = {
  title: "קופונים", // the admin layout adds "| ניהול | <brand>"
  robots: { index: false, follow: false },
};

const STATUS: Record<string, string> = {
  created: "הקופון נשמר כטיוטה. כדי שיופיע באתר, לחצו על פרסום.",
  updated: "השינויים נשמרו.",
  deleted: "הקופון נמחק.",
};

const pill = "inline-flex items-center rounded-full px-3 py-1 text-xs font-bold whitespace-nowrap";

function StatusPills({ coupon, now }: { coupon: Coupon; now: Date }) {
  const ended = hasEnded(coupon, now);
  return (
    <>
      {coupon.published ? (
        <span className={`${pill} bg-accent-soft text-accent-ink`}>מפורסם</span>
      ) : (
        <span className={`${pill} border border-line text-muted`}>טיוטה</span>
      )}
      {ended ? (
        <span className={`${pill} bg-surface-2 text-muted`}>הסתיים, לא מוצג באתר</span>
      ) : (
        !hasStarted(coupon, now) && <span className={`${pill} bg-gold-soft text-ink`}>עתידי</span>
      )}
      <span className={`${pill} border border-line text-ink`}>
        {coupon.scope === "product" ? "למוצר" : "לכל האתר"}
      </span>
      {coupon.featured && <span className={`${pill} bg-gold text-on-gold`}>מומלץ</span>}
    </>
  );
}

function CouponMeta({ coupon, saleTitle }: { coupon: Coupon; saleTitle: string | null }) {
  const minSpend = minSpendText(coupon.min_spend_ils);
  const items = [
    { label: "קוד", value: coupon.code, ltr: true },
    minSpend && { label: "מינימום", value: minSpend },
    coupon.starts_at && { label: "התחלה", value: formatDateTime(coupon.starts_at) },
    coupon.ends_at && { label: "סיום", value: formatDateTime(coupon.ends_at) },
    saleTitle && { label: "מבצע", value: saleTitle },
    { label: "עודכן", value: formatDateTime(coupon.updated_at) },
  ].filter((i): i is { label: string; value: string; ltr?: boolean } => Boolean(i));

  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
      {items.map((i) => (
        <div key={i.label} className="flex min-w-0 gap-1">
          <dt>{i.label}:</dt>
          <dd
            className={
              i.ltr ? "font-mono font-semibold tracking-wider break-all text-ink" : "text-ink"
            }
          >
            {i.ltr ? <bdi dir="ltr">{i.value}</bdi> : i.value}
          </dd>
        </div>
      ))}
      {coupon.product_id && (
        <div className="flex gap-1">
          <dt>מוצר:</dt>
          <dd>
            <Link
              href={`/p/${coupon.product_id}`}
              className="font-semibold text-accent-ink underline underline-offset-4"
            >
              <bdi dir="ltr">{coupon.product_id}</bdi>
            </Link>
          </dd>
        </div>
      )}
    </dl>
  );
}

async function loadCoupons(): Promise<Coupon[] | null> {
  try {
    return await listAllCoupons();
  } catch (err) {
    console.error(
      `[admin-coupons] ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
    );
    return null;
  }
}

export default async function AdminCouponsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The layout guards /admin too, but it does not re-run on client navigation.
  await requireAdmin();
  // Own keys only: "?status=__proto__" must not pick up Object.prototype.
  const statusKey = firstParam((await searchParams).status);
  const status = Object.hasOwn(STATUS, statusKey) ? STATUS[statusKey] : undefined;
  const now = new Date();
  const [coupons, sales] = await Promise.all([loadCoupons(), loadSaleOptions(now)]);
  const saleTitles = new Map((sales ?? []).map((s) => [s.id, s.title]));
  const saleTitle = (saleId: string | null) => {
    if (!saleId) return null;
    if (sales === null) return "מבצע מקושר"; // the sales could not be loaded
    return saleTitles.get(saleId) ?? "מבצע שלא נמצא ברשימת המבצעים";
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 pt-8 sm:px-6 sm:pt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-display text-4xl">קופונים</h1>
          <p className="max-w-2xl text-muted">
            באתר מופיעים רק קופונים מפורסמים שעוד לא הסתיימו: בדף הקופונים, בדף המוצר (קופון למוצר,
            או קופון מומלץ לכל האתר) ובכרטיס של המבצע המקושר. טיוטות נראות רק כאן.
          </p>
        </div>
        <Link href="/admin/coupons/new" className={`${btnPrimary} ${btnMd}`}>
          <Plus aria-hidden className="size-[18px]" />
          קופון חדש
        </Link>
      </div>

      {status && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-2xl bg-accent-soft px-4 py-3 font-semibold text-accent-ink"
        >
          <CircleCheck aria-hidden className="size-5 shrink-0" />
          {status}
        </p>
      )}

      {coupons === null ? (
        <StateCard Icon={CloudOff} title="לא הצלחנו לטעון את הקופונים">
          <p className="text-muted">
            נסו לרענן את הדף בעוד רגע. אם זה חוזר, בדקו שהטבלה של הקופונים קיימת במסד הנתונים.
          </p>
        </StateCard>
      ) : coupons.length === 0 ? (
        <StateCard Icon={Inbox} title="עוד אין קופונים">
          <p className="text-muted">לחצו על קופון חדש כדי להוסיף את הראשון.</p>
        </StateCard>
      ) : (
        <ul className="space-y-3">
          {coupons.map((coupon) => (
            <li
              key={coupon.id}
              className={`${card} flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8`}
            >
              <div className="min-w-0 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <StatusPills coupon={coupon} now={now} />
                </div>
                <h2 className="text-lg leading-snug font-bold break-words">{coupon.title}</h2>
                <CouponMeta coupon={coupon} saleTitle={saleTitle(coupon.sale_id)} />
              </div>
              <CouponRowActions id={coupon.id} title={coupon.title} published={coupon.published} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
