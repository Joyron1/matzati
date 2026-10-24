"use client";

// "המוצרים ששמרתי" (/saved): the products the visitor saved, from this browser only
// (lib/saved/mine.ts). The server renders the heading only; the list appears once the page has
// hydrated. Each card: the photo and title as saved, the price when saved (labelled), the buy button
// through /go (src=saved) with its "קישור שותפים" note, "למידע נוסף" and a remove button. The list
// can be shared on WhatsApp as our product pages' links, never affiliate links.
import Link from "next/link";
import { Heart, MessageCircle, Search, Trash2, X } from "lucide-react";
import { useSyncExternalStore } from "react";
import { formatCount, formatDateTime } from "@/lib/format";
import { clearSaved, forgetProduct } from "@/lib/saved/mine";
import { SITE_HOST } from "@/lib/config/site";
import { BuyButton } from "./buy-button";
import { ProductImage } from "./product-image";
import { useSavedList } from "./save-button";
import { btnMd, btnPrimary, btnSecondary, btnSm, card } from "./styles";

/** Hydrated or not (true in the browser, false on the server), without an effect. */
const noSubscribe = () => () => {};

const formatIls = (n: number) => `₪${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** WhatsApp text with our product pages (never the affiliate links), newest first. */
function shareText(list: { id: string; title: string }[]): string {
  const lines = list
    .slice(0, 20)
    .map((p) => `• ${p.title.slice(0, 60)}\nhttps://${SITE_HOST}/p/${p.id}`);
  return `המוצרים ששמרתי במצאתי:\n\n${lines.join("\n\n")}`;
}

export function SavedList() {
  const list = useSavedList();
  // The list exists only in the browser: until hydration nothing is known (no empty-state flash).
  const ready = useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
  if (!ready) return <p className="text-muted">טוענים את הרשימה…</p>;

  if (!list.length) {
    return (
      <div className={`${card} flex flex-col items-center gap-4 p-8 text-center`}>
        <span className="grid size-14 place-items-center rounded-full bg-accent-soft text-accent-ink">
          <Heart aria-hidden className="size-7" />
        </span>
        <p className="text-lg font-bold">עוד לא שמרתם מוצרים</p>
        <p className="max-w-md text-muted">
          לחצו על הלב שעל מוצר כדי לשמור אותו כאן. הרשימה נשמרת רק בדפדפן שלכם, בלי הרשמה.
        </p>
        <Link href="/" className={`${btnPrimary} ${btnMd} gap-2`}>
          <Search aria-hidden className="size-[18px]" />
          לחיפוש מוצרים
        </Link>
      </div>
    );
  }

  const total = list.reduce((sum, p) => sum + p.price, 0);
  return (
    <div className="space-y-5">
      <div
        className={`${card} flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5`}
      >
        <div>
          <p className="text-lg font-bold">
            <bdi dir="ltr">{formatCount(list.length)}</bdi> מוצרים שמורים
          </p>
          <p className="text-sm text-muted">
            סך הכול לפי המחירים בעת השמירה: <bdi dir="ltr">≈{formatIls(Math.round(total))}</bdi>.
            המחיר העדכני מופיע באלי אקספרס.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a
            href={`https://wa.me/?text=${encodeURIComponent(shareText(list))}`}
            target="_blank"
            rel="noopener"
            className={`${btnSecondary} ${btnSm} gap-1.5`}
          >
            <MessageCircle aria-hidden className="size-4" />
            שליחה בוואטסאפ
            <span className="sr-only">(נפתח בכרטיסייה חדשה)</span>
          </a>
          <button
            type="button"
            onClick={() => {
              if (window.confirm("למחוק את כל המוצרים מהרשימה?")) clearSaved();
            }}
            className={`${btnSecondary} ${btnSm} gap-1.5`}
          >
            <Trash2 aria-hidden className="size-4" />
            ניקוי הרשימה
          </button>
        </div>
      </div>

      <ul className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4">
        {list.map((p) => (
          <li key={p.id}>
            <article className={`${card} relative flex h-full flex-col overflow-hidden`}>
              <ProductImage
                src={p.image || undefined}
                alt=""
                className="aspect-square w-full border-b border-line"
                iconClassName="size-10"
                sizes="(min-width: 1280px) 280px, (min-width: 768px) 30vw, 46vw"
              />
              <button
                type="button"
                onClick={() => forgetProduct(p.id)}
                aria-label={`הסרה מהרשימה: ${p.title}`}
                title="הסרה מהרשימה"
                className="absolute end-2 top-2 grid size-11 place-items-center rounded-full bg-surface/90 text-ink shadow-soft hover:text-accent-ink"
              >
                <X aria-hidden className="size-5" />
              </button>
              <div className="flex flex-1 flex-col gap-2 p-3 sm:p-4">
                <h2 className="line-clamp-2 text-[15px] leading-snug font-semibold">
                  <Link href={`/p/${encodeURIComponent(p.id)}`} className="hover:text-accent-ink">
                    {p.title}
                  </Link>
                </h2>
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <bdi dir="ltr" className="text-lg font-bold">
                    {formatIls(p.price)}
                  </bdi>
                  {p.original !== null && (
                    <s className="text-sm text-muted">
                      <bdi dir="ltr">{formatIls(p.original)}</bdi>
                    </s>
                  )}
                </p>
                <p className="text-xs text-muted">
                  המחיר בעת השמירה, {formatDateTime(new Date(p.at).toISOString())}
                </p>
                <div className="mt-auto grid gap-1 pt-1">
                  <BuyButton productId={p.id} src="saved" size="sm" />
                  <Link
                    href={`/p/${encodeURIComponent(p.id)}`}
                    className={`${btnSecondary} ${btnSm} w-full`}
                  >
                    למידע נוסף
                  </Link>
                </div>
              </div>
            </article>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The header's heart: a link to /saved with the number saved (nothing until hydrated). */
export function SavedNavLink() {
  const count = useSavedList().length;
  return (
    <Link
      href="/saved"
      aria-label={count ? `המוצרים ששמרתי (${count})` : "המוצרים ששמרתי"}
      className="relative flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full font-medium text-muted hover:text-ink sm:px-4"
    >
      <Heart aria-hidden className="size-[18px]" />
      <span className="hidden sm:inline">שמורים</span>
      {count > 0 && (
        <span
          aria-hidden
          className="absolute end-0.5 top-0.5 grid min-w-5 place-items-center rounded-full bg-accent px-1 text-[11px] leading-5 font-bold text-on-accent sm:static sm:min-w-6"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
