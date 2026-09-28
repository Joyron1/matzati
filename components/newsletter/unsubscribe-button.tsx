"use client";

import { MailX } from "lucide-react";
import { useFormStatus } from "react-dom";
import { btnBusy, btnLg, btnPrimary } from "@/components/styles";

/**
 * The unsubscribe page's confirm button: busy while the form's action runs (aria-disabled, so it
 * keeps focus), and a second press while busy is ignored. Works without JavaScript as a plain
 * submit button.
 */
export function UnsubscribeButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      aria-disabled={pending}
      onClick={(e) => {
        if (pending) e.preventDefault();
      }}
      className={`${btnPrimary} ${btnLg} ${btnBusy} w-full sm:w-auto`}
    >
      <MailX aria-hidden className="size-5" />
      {pending ? "מסירים…" : "הסרה מרשימת התפוצה"}
    </button>
  );
}
