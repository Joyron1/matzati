// The parts the /products hub and its category pages share: the grid of hot products with its
// summary and "הצגת עוד מוצרים", the failure states, and "מאיפה הרשימה". Server components.
import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronDown, CloudOff, PackageSearch, RotateCcw, SearchX } from "lucide-react";
import { FocusHashTarget } from "@/components/focus-hash-target";
import { HotProductCard } from "@/components/hot-product-card";
import { StateCard } from "@/components/state-card";
import { btnMd, btnPrimary, btnSecondary, card } from "@/components/styles";
import { formatCount } from "@/lib/format";
import { HOT_FILTER_NOTE, HOT_TITLES_NOTE } from "@/lib/hot/copy";
import type { HotProduct } from "@/lib/hot/select";

/** Id prefix of the grid items; "הצגת עוד מוצרים" links to the first new one. */
export const CARD_ID = "hot-";

/** Id of "מאיפה הרשימה" (the home carousel's note links to it). */
export const ABOUT_ID = "hot-about-title";

export const count = (n: number) => <bdi dir="ltr">{formatCount(n)}</bdi>;

/** "בדקנו N מוצרים מהרשימה של אלי אקספרס. M עברו את הסינון." */
export function checkedSummary(checked: number, passed: number): ReactNode {
  return (
    <>
      בדקנו {count(checked)} מוצרים מהרשימה של אלי אקספרס.{" "}
      {passed === 1 ? "מוצר אחד עבר" : <>{count(passed)} עברו</>} את הסינון.
    </>
  );
}

/**
 * The grid: `shown` of the `matching` products (the list with the view's filters and sort), the
 * summary lines over it, and the "more" link when there is more to show. `empty` replaces the
 * default "nothing matches the filter" card.
 */
export function Listing({
  summary,
  details,
  matching,
  shown,
  step,
  moreHref,
  clearHref,
  productHref,
  now,
  empty,
}: {
  /** One short line: what was checked, or which categories are mixed. */
  summary: ReactNode;
  /** The muted line under it: our thresholds and when the prices were checked. */
  details: string;
  matching: number;
  shown: HotProduct[];
  /** The step shown (FocusHashTarget moves focus to the first new card when it changes). */
  step: number;
  /** "הצגת עוד מוצרים" (to the first new card), or null. */
  moreHref: string | null;
  /** The list without the filters, for the empty state. */
  clearHref: string;
  productHref: (productId: string) => string;
  now: Date;
  empty?: ReactNode;
}) {
  return (
    <section aria-labelledby="hot-list-title" className="space-y-5">
      <div className="space-y-1">
        <h2 id="hot-list-title" className="sr-only">
          המוצרים
        </h2>
        <p className="font-semibold text-ink">{summary}</p>
        <p className="text-sm leading-relaxed text-muted">{details}</p>
      </div>
      <p role="status" className="sr-only">
        {matching === 0 ? "לא נמצאו מוצרים" : `מוצגים ${shown.length} מתוך ${matching} מוצרים`}
      </p>
      {matching === 0 ? (
        (empty ?? (
          <StateCard Icon={SearchX} title="לא מצאנו מוצרים שמתאימים לסינון">
            {/* A list is never empty, so only a filter can leave nothing to show. */}
            <p className="max-w-md leading-relaxed text-muted">
              נסו טווח מחירים אחר, או הסירו את הסינון.
            </p>
            <Link href={clearHref} className={`${btnSecondary} ${btnMd}`}>
              ניקוי הסינון
            </Link>
          </StateCard>
        ))
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
          {shown.map((product, i) => (
            // Focusable from script only (FocusHashTarget), for "הצגת עוד מוצרים".
            <li
              key={product.productId}
              id={`${CARD_ID}${i}`}
              tabIndex={-1}
              className="min-w-0 scroll-mt-6 rounded-card"
            >
              <HotProductCard
                product={product}
                now={now}
                sizes="(min-width: 1024px) 270px, (min-width: 640px) 30vw, 46vw"
                // The first two photos are the largest paint on phones; the rest load lazily.
                preload={i < 2}
                href={productHref(product.productId)}
              />
            </li>
          ))}
        </ul>
      )}
      {moreHref && matching > 0 && (
        <div className="flex justify-center">
          {/* Step n lists the first n steps. The link goes to the first new card: Next scrolls
              it into view and FocusHashTarget moves focus there, since this link may be gone. */}
          <Link href={moreHref} className={`${btnSecondary} ${btnMd}`}>
            הצגת עוד מוצרים
            <ChevronDown aria-hidden className="size-[18px]" />
          </Link>
        </div>
      )}
      <FocusHashTarget page={step} prefix={CARD_ID} />
    </section>
  );
}

/** The hot list could not be loaded (and no earlier one is kept). */
export function ListFailed({ retryHref }: { retryHref: string }) {
  return (
    <StateCard Icon={CloudOff} title="לא הצלחנו לטעון את המוצרים">
      <p className="max-w-md leading-relaxed text-muted">
        לא הצלחנו לקבל כרגע את הרשימה מאלי אקספרס. נסו שוב בעוד כמה דקות, או חפשו מוצר בעצמכם.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {/* A full reload, so the list is really asked for again. */}
        <a href={retryHref} className={`${btnPrimary} ${btnMd}`}>
          <RotateCcw aria-hidden className="size-[18px]" />
          ניסיון נוסף
        </a>
        <Link href="/" className={`${btnSecondary} ${btnMd}`}>
          לחיפוש מוצר
        </Link>
      </div>
    </StateCard>
  );
}

/** Nothing in the list passed our filters. */
export function NothingPassed({
  otherHref,
  otherLabel,
}: {
  otherHref?: string;
  otherLabel?: string;
}) {
  return (
    <StateCard Icon={PackageSearch} title="אין כרגע מוצרים שעברו את הסינון">
      <p className="max-w-md leading-relaxed text-muted">
        {otherHref
          ? "נסו קטגוריה אחרת, או חפשו מוצר בעצמכם."
          : "נסו שוב מאוחר יותר, או חפשו מוצר בעצמכם."}
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        {otherHref && otherLabel && (
          <Link href={otherHref} className={`${btnPrimary} ${btnMd}`}>
            {otherLabel}
          </Link>
        )}
        <Link href="/" className={`${btnSecondary} ${btnMd}`}>
          לחיפוש מוצר
        </Link>
      </div>
    </StateCard>
  );
}

/** Where the lists come from and what the numbers mean. Shown in every state. */
export function AboutTheList() {
  return (
    <section aria-labelledby={ABOUT_ID} className={`${card} space-y-3 p-6 sm:p-7`}>
      <h2 id={ABOUT_ID} className="font-display text-2xl">
        מאיפה הרשימה
      </h2>
      <ul className="max-w-3xl list-disc space-y-2 ps-5 leading-relaxed text-muted marker:text-muted">
        <li>
          זו רשימת המוצרים החמים שאלי אקספרס מציעה לשותפים שלה, לפי קטגוריה. אנחנו מציגים ממנה רק את
          מה שעבר את הסינון שלנו, עד 2 מוצרים מכל חנות, וכברירת מחדל ממיינים לפי מספר המכירות ב־30
          הימים האחרונים.
        </li>
        <li>{HOT_FILTER_NOTE} כל המספרים מאלי אקספרס.</li>
        <li>
          המחירים הם מה שאלי אקספרס הציגה כשבדקנו את הרשימה, והם יכולים להשתנות. המחיר הסופי מוצג
          באלי אקספרס.
        </li>
        <li>{HOT_TITLES_NOTE}</li>
        <li>
          על מוצרים מהרשימה הזו אלי אקספרס עשויה לשלם לנו עמלה גבוהה יותר. העמלה לא משפיעה על הסינון
          ועל הסדר.
        </li>
      </ul>
      <Link
        href="/terms#affiliate"
        className="inline-flex min-h-11 items-center font-semibold text-accent-ink underline-offset-4 hover:underline"
      >
        לגילוי הנאות המלא
      </Link>
    </section>
  );
}
