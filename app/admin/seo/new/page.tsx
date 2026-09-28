import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireAdmin } from "@/lib/admin/auth";
import { firstParam } from "@/lib/search-url";
import { seoFormValues } from "@/lib/seo/schema";
import { SeoForm } from "../seo-form";

export const metadata: Metadata = {
  title: "דף חיפוש חדש",
  robots: { index: false, follow: false },
};

// Saving a published page runs its first refresh after the response (after() in the save action):
// a fresh search of 7-15 s, a retry included up to about 45 s, inside this page's function.
export const maxDuration = 60;

/** ?q= prefills the query, title and slug (the stats dashboard links popular searches here). */
export default async function NewSeoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin();
  const q = firstParam((await searchParams).q);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 pt-6 sm:px-6 sm:pt-10">
      <Link
        href="/admin/seo"
        className="inline-flex min-h-11 items-center gap-1 rounded-full pe-3 font-semibold text-muted hover:text-ink"
      >
        <ChevronRight aria-hidden className="size-5" />
        לרשימת דפי החיפוש
      </Link>
      <div className="space-y-2">
        <h1 className="font-display text-4xl">דף חיפוש חדש</h1>
        <p className="text-muted">
          דף קבוע לחיפוש פופולרי, שמנועי חיפוש יכולים למצוא. הוא יופיע באתר רק אם תסמנו פרסום.
        </p>
      </div>
      {/* key: a new ?q= (another link from the stats page) starts a fresh form. */}
      <SeoForm key={q} originalSlug={null} initial={seoFormValues(null, q)} />
    </div>
  );
}
