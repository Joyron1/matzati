"use client";

// The queue's bar for many candidates at once (owner request 2026-10-27): the cards' checkboxes
// belong to this form (form="<id>"), so it counts them, selects all or none, and sends the chosen
// ids to "אישור ותזמון לטלגרם" or "לא מתאים". Busy with its progress bar while the server works.
import { Check, X } from "lucide-react";
import { useEffect, useState } from "react";
import { btnPrimary, btnSecondary, btnSm } from "@/components/styles";
import { FormProgress, PendingButton } from "../progress";
import { bulkApproveAction, bulkRejectAction } from "./actions";

export const BULK_FORM_ID = "bulk-candidates";

export function BulkBar({ telegramOn, total }: { telegramOn: boolean; total: number }) {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const boxes = () => [
      ...document.querySelectorAll<HTMLInputElement>(`input[form="${BULK_FORM_ID}"][name="ids"]`),
    ];
    const update = () => setCount(boxes().filter((b) => b.checked).length);
    document.addEventListener("change", update);
    update();
    return () => document.removeEventListener("change", update);
  }, []);

  const setAll = (checked: boolean) => {
    for (const b of document.querySelectorAll<HTMLInputElement>(
      `input[form="${BULK_FORM_ID}"][name="ids"]`,
    )) {
      b.checked = checked;
    }
    setCount(checked ? total : 0);
  };

  return (
    <form
      id={BULK_FORM_ID}
      action={bulkApproveAction}
      className="sticky top-14 z-20 space-y-2 rounded-[10px] border border-line bg-surface/95 p-3 shadow-sm backdrop-blur lg:top-2"
    >
      {telegramOn && <input type="hidden" name="telegram" value="on" />}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">
          {count ? `נבחרו ${count}` : "סמנו מוצרים כדי לטפל בכמה יחד"}
        </span>
        <button
          type="button"
          onClick={() => setAll(count < total)}
          className="min-h-11 rounded-lg px-3 text-sm font-semibold text-accent-ink hover:bg-surface-2"
        >
          {count < total ? `בחירת כל ה־${total}` : "ביטול הבחירה"}
        </button>
        {count > 0 && (
          <div className="ms-auto flex flex-wrap gap-2">
            <PendingButton op="approve" busyLabel="מאשרים…" className={`${btnPrimary} ${btnSm}`}>
              <Check aria-hidden className="size-4" />
              {telegramOn ? `אישור ותזמון לטלגרם (${count})` : `אישור (${count})`}
            </PendingButton>
            <PendingButton
              op="reject"
              busyLabel="מסירים…"
              formAction={bulkRejectAction}
              className={`${btnSecondary} ${btnSm}`}
            >
              <X aria-hidden className="size-4" />
              לא מתאים ({count})
            </PendingButton>
          </div>
        )}
      </div>
      <FormProgress
        ops={{
          approve: { label: `מאשרים ${count} ומתזמנים לטלגרם`, expectedMs: 1500 + count * 700 },
          reject: { label: `מסירים ${count}`, expectedMs: 800 + count * 300 },
        }}
      />
    </form>
  );
}
