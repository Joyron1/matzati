import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { requireAdmin } from "@/lib/admin/auth";
import { getSeoPage } from "@/lib/seo/queries";
import { seoFormValues } from "@/lib/seo/schema";
import { parseSlugParam } from "@/lib/seo/slug";
import { SeoForm } from "../../seo-form";

export const metadata: Metadata = {
  title: "עריכת דף חיפוש",
  robots: { index: false, follow: false },
};

// Publishing the page or changing its query runs a refresh after the response (after() in the
// save action): a fresh search of 7-15 s, a retry included up to about 45 s.
export const maxDuration = 60;

// Under /edit/ so a page whose slug is "new" never collides with /admin/seo/new.
export default async function EditSeoPage({ params }: { params: Promise<{ slug: string }> }) {
  await requireAdmin();
  // Params that cannot be a slug come back null without a query.
  const slug = parseSlugParam((await params).slug);
  const page = slug ? await getSeoPage(slug) : null;
  if (!page) notFound();

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
        <h1 className="font-display text-4xl">עריכת דף חיפוש</h1>
        <p className="text-muted">
          {page.published
            ? "הדף מפורסם. השינויים יופיעו באתר מיד אחרי השמירה."
            : "הדף שמור כטיוטה ולא מופיע באתר."}
        </p>
      </div>
      <SeoForm originalSlug={page.slug} initial={seoFormValues(page)} />
    </div>
  );
}
