import Link from "next/link";
import { BRAND } from "@/lib/config/brand";
import { DEALS_ENABLED } from "@/lib/config/site";
import { hasPublishedDeals } from "@/lib/deals/queries";
import { LogoMark } from "./logo";

const LINKS = [
  { href: "/searches", label: "חיפושים אחרונים" },
  { href: "/disclosure", label: "גילוי נאות" },
  { href: "/privacy", label: "מדיניות פרטיות" },
  { href: "/terms", label: "תנאי שימוש" },
];

export async function SiteFooter() {
  const links =
    DEALS_ENABLED && (await hasPublishedDeals())
      ? [{ href: "/deals", label: "דילים" }, ...LINKS]
      : LINKS;
  return (
    <footer className="mt-20 border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.2fr_1fr]">
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <LogoMark className="size-8" />
            <span className="font-display text-xl">{BRAND.name}</span>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-muted">
            {BRAND.name} הוא אתר עצמאי ואינו קשור לאלי אקספרס. אנחנו מרוויחים עמלה קטנה על קניות דרך
            הקישורים שלנו, והעמלה לא משפיעה על סדר התוצאות.
          </p>
        </div>
        <nav aria-label="קישורים באתר">
          <ul className="grid grid-cols-2 gap-x-6 gap-y-1">
            {links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className="inline-flex min-h-11 items-center text-sm text-muted underline-offset-4 hover:text-ink hover:underline"
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <p className="border-t border-line py-5 text-center text-xs text-muted">
        © {new Date().getFullYear()} {BRAND.name}
      </p>
    </footer>
  );
}
