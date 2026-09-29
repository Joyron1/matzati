"use client";

import Link from "next/link";
import { ExternalLink, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { btnBusy, btnPrimary, btnSecondary } from "@/components/styles";
import { seoPath } from "@/lib/seo/slug";
import {
  deleteSeoPageAction,
  refreshSeoPageAction,
  type SeoRefreshState,
  type SeoRowActionState,
} from "./actions";

// Busy buttons are aria-disabled, not disabled, so they keep keyboard focus (btnBusy).
const btnSm = `min-h-11 px-4 text-sm ${btnBusy}`;
const NO_ERROR: SeoRowActionState = { error: null };
const NOT_REFRESHED: SeoRefreshState = { message: null, stored: false };

interface SeoRowActionsProps {
  slug: string;
  title: string;
  published: boolean;
  /** A run left products without lines: the refresh button continues it (no new search). */
  incomplete?: boolean;
}

/**
 * View and "רענון עכשיו" (published only), edit and delete (with a confirm step) for one landing
 * page. The refresh collects the page's products again and stores them when they are at least as
 * good as the stored results (lib/seo/refresh.ts); while a run still lacks lines the button says
 * "השלמת הרענון" and writes them without a new search. The line under the buttons says how it went.
 */
export function SeoRowActions({ slug, title, published, incomplete = false }: SeoRowActionsProps) {
  const remove = useMemo(() => deleteSeoPageAction.bind(null, slug), [slug]);
  const [deleteState, deleteAction, deleting] = useActionState(remove, NO_ERROR);
  const refresh = useMemo(() => refreshSeoPageAction.bind(null, slug), [slug]);
  const [refreshState, refreshAction, refreshing] = useActionState(refresh, NOT_REFRESHED);

  const [confirming, setConfirming] = useState(false);
  const questionId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // Focus follows the confirm step: to "ביטול" when it opens, back to "מחיקה" when it closes.
  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
    else if (returnFocus.current) deleteRef.current?.focus();
    returnFocus.current = false;
  }, [confirming]);

  return (
    <div className="flex shrink-0 flex-col gap-3 lg:items-end">
      {confirming ? (
        <form
          action={deleteAction}
          onSubmit={(e) => {
            if (deleting) e.preventDefault();
          }}
          className="flex flex-col gap-3 rounded-2xl bg-gold-soft p-4 sm:flex-row sm:items-center"
        >
          <p id={questionId} className="font-semibold">
            למחוק את הדף? הכתובת שלו תפסיק לעבוד, ואי אפשר לבטל את זה.
          </p>
          <div className="flex gap-2">
            <button
              type="submit"
              aria-disabled={deleting}
              aria-describedby={questionId}
              className={`${btnPrimary} ${btnSm}`}
            >
              {deleting ? "מוחקים…" : "כן, למחוק"}
              <span className="sr-only">: {title}</span>
            </button>
            {/* Focus lands here when the step opens; the description reads the question out. */}
            <button
              ref={cancelRef}
              type="button"
              aria-disabled={deleting}
              aria-describedby={questionId}
              onClick={() => {
                if (deleting) return;
                returnFocus.current = true;
                setConfirming(false);
              }}
              className={`${btnSecondary} ${btnSm}`}
            >
              ביטול
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          {published && (
            <Link href={seoPath(slug)} target="_blank" className={`${btnSecondary} ${btnSm}`}>
              <ExternalLink aria-hidden className="size-4" />
              צפייה בדף
              <span className="sr-only">: {title} (נפתח בכרטיסייה חדשה)</span>
            </Link>
          )}
          {published && (
            <form
              action={refreshAction}
              onSubmit={(e) => {
                if (refreshing) e.preventDefault();
              }}
            >
              <button
                type="submit"
                aria-disabled={refreshing}
                className={`${btnSecondary} ${btnSm}`}
              >
                <RefreshCw
                  aria-hidden
                  className={`size-4 ${refreshing ? "motion-safe:animate-spin" : ""}`}
                />
                {refreshing ? "מרעננים…" : incomplete ? "השלמת הרענון" : "רענון עכשיו"}
                <span className="sr-only">: {title}</span>
              </button>
            </form>
          )}
          <Link
            href={`/admin/seo/edit/${encodeURIComponent(slug)}`}
            className={`${btnSecondary} ${btnSm}`}
          >
            <Pencil aria-hidden className="size-4" />
            עריכה
            <span className="sr-only">: {title}</span>
          </Link>
          <button
            ref={deleteRef}
            type="button"
            onClick={() => setConfirming(true)}
            className={`${btnSecondary} ${btnSm}`}
          >
            <Trash2 aria-hidden className="size-4" />
            מחיקה
            <span className="sr-only">: {title}</span>
          </button>
        </div>
      )}
      {deleteState.error && (
        <p role="alert" className="text-sm font-semibold">
          {deleteState.error}
        </p>
      )}
      {/* Always in the page (sr-only while empty), so screen readers announce what is written. */}
      {published && (
        <p
          role="status"
          className={
            refreshing || refreshState.message
              ? "max-w-xs text-sm font-semibold lg:text-end"
              : "sr-only"
          }
        >
          {refreshing
            ? incomplete
              ? "כותבים את ההסברים שחסרים. זה לוקח בדרך כלל עד חצי דקה."
              : "מחפשים מוצרים עדכניים וכותבים הסברים. זה לוקח בדרך כלל פחות מדקה."
            : (refreshState.message ?? "")}
        </p>
      )}
    </div>
  );
}
