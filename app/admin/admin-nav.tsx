"use client";

// Admin section links. A client component only for the active state (usePathname), which the
// server layout cannot read. The current page gets aria-current="page"; a page inside a section
// (e.g. /admin/deals/new under "דילים") marks its section with aria-current="true".
import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "דילים", section: ["/admin", "/admin/deals"] },
  { href: "/admin/coupons", label: "קופונים", section: ["/admin/coupons"] },
  { href: "/admin/stats", label: "נתונים", section: ["/admin/stats"] },
  { href: "/admin/seo", label: "עמודי SEO", section: ["/admin/seo"] },
  { href: "/admin/searches", label: "חיפושים", section: ["/admin/searches"] },
] as const;

const within = (pathname: string, base: string) =>
  base === "/admin" ? pathname === base : pathname === base || pathname.startsWith(`${base}/`);

export function AdminNav() {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="ניווט בניהול">
      <ul className="flex flex-wrap items-center gap-1">
        {LINKS.map(({ href, label, section }) => {
          const current = pathname === href ? "page" : section.some((b) => within(pathname, b));
          return (
            <li key={href}>
              <Link
                href={href}
                aria-current={current || undefined}
                className={`flex min-h-11 items-center rounded-full px-4 text-sm font-semibold ${
                  current
                    ? "bg-accent-soft text-accent-ink"
                    : "text-muted hover:bg-surface-2 hover:text-ink"
                }`}
              >
                {label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
