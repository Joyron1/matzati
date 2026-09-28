"use client";

import Link from "next/link";
import { Eye, EyeOff, Pencil, Trash2 } from "lucide-react";
import { useActionState, useEffect, useId, useMemo, useRef, useState } from "react";
import { btnBusy, btnPrimary, btnSecondary } from "@/components/styles";
import { deleteCouponAction, setCouponPublishedAction, type CouponRowActionState } from "./actions";

// Busy buttons are aria-disabled, not disabled, so they keep keyboard focus (btnBusy).
const btnSm = `min-h-11 px-4 text-sm ${btnBusy}`;
const NO_ERROR: CouponRowActionState = { error: null };

interface CouponRowActionsProps {
  id: string;
  title: string;
  published: boolean;
}

/** Publish toggle, edit link and delete (with a confirm step) for one coupon in the admin list. */
export function CouponRowActions({ id, title, published }: CouponRowActionsProps) {
  const publish = useMemo(
    () => setCouponPublishedAction.bind(null, id, !published),
    [id, published],
  );
  const remove = useMemo(() => deleteCouponAction.bind(null, id), [id]);
  const [publishState, publishAction, publishing] = useActionState(publish, NO_ERROR);
  const [deleteState, deleteAction, deleting] = useActionState(remove, NO_ERROR);

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

  const error = publishState.error ?? deleteState.error;

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
            למחוק את הקופון? אי אפשר לבטל את זה.
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
          <form
            action={publishAction}
            onSubmit={(e) => {
              if (publishing) e.preventDefault();
            }}
          >
            <button
              type="submit"
              aria-disabled={publishing}
              className={`${published ? btnSecondary : btnPrimary} ${btnSm}`}
            >
              {published ? (
                <EyeOff aria-hidden className="size-4" />
              ) : (
                <Eye aria-hidden className="size-4" />
              )}
              {publishing ? "מעדכנים…" : published ? "הסרת פרסום" : "פרסום"}
              <span className="sr-only">: {title}</span>
            </button>
          </form>
          <Link href={`/admin/coupons/${id}`} className={`${btnSecondary} ${btnSm}`}>
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
      {error && (
        <p role="alert" className="text-sm font-semibold">
          {error}
        </p>
      )}
    </div>
  );
}
