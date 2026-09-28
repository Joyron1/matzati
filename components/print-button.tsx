"use client";

import { Printer } from "lucide-react";
import { btnMd, btnSecondary } from "./styles";

/** "הדפסה" on the legal pages. The print styles in ./static-page.tsx leave only the document. */
export function PrintButton({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className={`${btnSecondary} ${btnMd} ${className}`}
    >
      <Printer aria-hidden className="size-[18px]" />
      הדפסה
    </button>
  );
}
