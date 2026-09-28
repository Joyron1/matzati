import type { Metadata } from "next";
import Link from "next/link";
import { CloudOff, Inbox, Plus } from "lucide-react";
import { DealRowActions } from "@/app/admin/deals/deal-row-actions";
import { StateCard } from "@/components/state-card";
import { btnMd, btnPrimary, card } from "@/components/styles";
import { requireAdmin } from "@/lib/admin/auth";
import { DEAL_TYPE_DISPLAY, DEAL_TYPE_TAG } from "@/lib/deals/display";
import { listAllDeals } from "@/lib/deals/queries";
import { hasEnded } from "@/lib/deals/time";
import { formatDateTime } from "@/lib/format";
import { firstParam } from "@/lib/search-url";
import type { Deal } from "@/lib/types";
import { StatusMessage } from "./status-message";

export const metadata: Metadata = {
  title: "דילים", // the admin layout adds "| ניהול | <brand>"
  robots: { index: false, follow: false },
};

const STATUS: Record<string, string> = {
  created: "הדיל נשמר כטיוטה. כדי שיופיע באתר, לחצו על פרסום.",
  updated: "השינויים נשמרו.",
  deleted: "הדיל נמחק.",
};

const pill = "inline-flex items-center rounded-full px-3 py-1 text-xs font-bold whitespace-nowrap";

function StatusPills({ deal, now }: { deal: Deal; now: Date }) {
  const ended = hasEnded(deal, now);
  return (
    <>
      {deal.published ? (
        <span className={`${pill} bg-accent-soft text-accent-ink`}>מפורסם</span>
      ) : (
        <span className={`${pill} border border-line text-muted`}>טיוטה</span>
      )}
      {ended && <span className={`${pill} bg-surface-2 text-muted`}>הסתיים, לא מוצג באתר</span>}
    </>
  );
}

function DealMeta({ deal }: { deal: Deal }) {
  const items = [
    deal.starts_at && { label: "התחלה", value: formatDateTime(deal.starts_at) },
    deal.ends_at && { label: "סיום", value: formatDateTime(deal.ends_at) },
    deal.coupon_code && { label: "קופון", value: deal.coupon_code, ltr: true },
    { label: "נוצר", value: formatDateTime(deal.created_at) },
  ].filter((i): i is { label: string; value: string; ltr?: boolean } => Boolean(i));

  return (
    <dl className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted">
      {items.map((i) => (
        <div key={i.label} className="flex gap-1">
          <dt>{i.label}:</dt>
          <dd className={i.ltr ? "font-semibold tracking-wider text-ink" : "text-ink"}>
            {i.ltr ? <bdi dir="ltr">{i.value}</bdi> : i.value}
          </dd>
        </div>
      ))}
      {deal.product_id && (
        <div className="flex gap-1">
          <dt>מוצר:</dt>
          <dd>
            <Link
              href={`/p/${deal.product_id}`}
              className="font-semibold text-accent-ink underline underline-offset-4"
            >
              <bdi dir="ltr">{deal.product_id}</bdi>
            </Link>
          </dd>
        </div>
      )}
    </dl>
  );
}

async function loadDeals(): Promise<Deal[] | null> {
  try {
    return await listAllDeals();
  } catch (err) {
    console.error(`[admin] ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`);
    return null;
  }
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // The layout guards /admin too, but it does not re-run on client navigation (Next.js auth guide).
  await requireAdmin();
  // Own keys only: "?status=__proto__" must not pick up Object.prototype and crash the render.
  const statusKey = firstParam((await searchParams).status);
  const status = Object.hasOwn(STATUS, statusKey) ? STATUS[statusKey] : undefined;
  const deals = await loadDeals();
  const now = new Date();

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 pt-8 sm:px-6 sm:pt-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <h1 className="font-display text-4xl">ניהול דילים</h1>
          <p className="text-muted">
            באתר מופיעים רק דילים מפורסמים שעוד לא הסתיימו. טיוטות נראות רק כאן.
          </p>
        </div>
        <Link href="/admin/deals/new" className={`${btnPrimary} ${btnMd}`}>
          <Plus aria-hidden className="size-[18px]" />
          דיל חדש
        </Link>
      </div>

      {status && <StatusMessage>{status}</StatusMessage>}

      {deals === null ? (
        <StateCard Icon={CloudOff} title="לא הצלחנו לטעון את הדילים">
          <p className="text-muted">נסו לרענן את הדף בעוד רגע.</p>
        </StateCard>
      ) : deals.length === 0 ? (
        <StateCard Icon={Inbox} title="עוד אין דילים">
          <p className="text-muted">לחצו על דיל חדש כדי להוסיף את הראשון.</p>
        </StateCard>
      ) : (
        <ul className="space-y-3">
          {deals.map((deal) => {
            const { tagLabel, Icon, tag } = DEAL_TYPE_DISPLAY[deal.type];
            return (
              <li
                key={deal.id}
                className={`${card} flex flex-col gap-4 p-5 lg:flex-row lg:items-center lg:justify-between lg:gap-8`}
              >
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`${DEAL_TYPE_TAG} ${tag}`}>
                      <Icon aria-hidden className="size-3.5" />
                      {tagLabel}
                    </span>
                    <StatusPills deal={deal} now={now} />
                  </div>
                  <h2 className="text-lg leading-snug font-bold break-words">{deal.title}</h2>
                  <DealMeta deal={deal} />
                </div>
                <DealRowActions id={deal.id} title={deal.title} published={deal.published} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
