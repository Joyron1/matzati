"use client";

import Link from "next/link";
import { X } from "lucide-react";

/**
 * "ניקוי הסינון": a link to the list without the filters. It goes away with them, so it first
 * moves keyboard focus to what stays: the "סינון ומיון" summary where it shows (phones, where the
 * disclosure then closes), otherwise the form's submit button.
 */
export function ClearFiltersLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      scroll={false}
      onClick={(e) => {
        const summary = e.currentTarget.closest("details")?.querySelector("summary");
        const target =
          summary && summary.getClientRects().length > 0
            ? summary
            : e.currentTarget.closest("form")?.querySelector<HTMLElement>("button[type=submit]");
        target?.focus();
      }}
      className="inline-flex min-h-11 items-center gap-1 rounded-full px-2 text-sm font-medium text-muted underline-offset-4 hover:text-ink hover:underline"
    >
      <X aria-hidden className="size-4" />
      ניקוי הסינון
    </Link>
  );
}
