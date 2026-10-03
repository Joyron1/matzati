import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export interface Crumb {
  label: string;
  /** Absent for the current page (the last crumb). */
  href?: string;
}

/**
 * "בית › כל המוצרים › תכשיטים": the path to the page, the current one last and not a link. In RTL
 * the separators point left (forward). The page adds the matching BreadcrumbList JSON-LD
 * (breadcrumbJsonLd in lib/seo/structured-data.ts).
 */
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="פירורי לחם">
      <ol className="flex flex-wrap items-center gap-x-1 text-sm text-muted">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="inline-flex items-center gap-x-1">
            {i > 0 && <ChevronLeft aria-hidden className="size-3.5 shrink-0" />}
            {item.href ? (
              <Link
                href={item.href}
                className="inline-flex min-h-11 items-center rounded-full px-1 font-medium hover:text-ink hover:underline underline-offset-4"
              >
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="inline-flex min-h-11 items-center px-1 text-ink">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
