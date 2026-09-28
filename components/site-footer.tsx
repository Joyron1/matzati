import Link from "next/link";
import { BRAND } from "@/lib/config/brand";
import { DEALS_ENABLED } from "@/lib/config/site";
import { hasPublishedCoupons } from "@/lib/coupons/queries";
import { hasPublishedDeals, hasUpcomingSales } from "@/lib/deals/queries";
import { COOKIE_SETTINGS_BUTTON_ID } from "@/lib/consent/store";
import { CookieSettingsButton } from "./cookie-consent/cookie-settings-button";
import { LogoMark } from "./logo";

const SITE_LINKS = [
  { href: "/hot", label: "מוצרים חמים" },
  { href: "/searches", label: "חיפושים אחרונים" },
];

// The affiliate disclosure lives in the terms (section id="affiliate").
const LEGAL_LINKS = [
  { href: "/terms", label: "תקנון ותנאי שימוש" },
  { href: "/privacy", label: "מדיניות פרטיות" },
  { href: "/cookies", label: "מדיניות עוגיות" },
  { href: "/accessibility", label: "הצהרת נגישות" },
  { href: "/terms#affiliate", label: "גילוי נאות" },
];

const linkClass =
  "inline-flex min-h-11 cursor-pointer items-center text-start text-sm text-muted underline-offset-4 hover:text-ink hover:underline";

function LinkList({ links }: { links: { href: string; label: string }[] }) {
  return links.map((link) => (
    <li key={link.href}>
      <Link href={link.href} className={linkClass}>
        {link.label}
      </Link>
    </li>
  ));
}

export async function SiteFooter() {
  // Deals, sales and coupons only while their pages have something to show (as in the header).
  const [deals, sales, coupons] = await Promise.all([
    DEALS_ENABLED && hasPublishedDeals(),
    hasUpcomingSales(),
    hasPublishedCoupons(),
  ]);
  const siteLinks = [
    ...(deals ? [{ href: "/deals", label: "דילים" }] : []),
    ...(sales ? [{ href: "/sales", label: "מבצעים" }] : []),
    ...(coupons ? [{ href: "/coupons", label: "קופונים" }] : []),
    ...SITE_LINKS,
  ];
  return (
    <footer className="mt-20 border-t border-line">
      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.2fr_1fr]">
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <LogoMark className="size-8" />
            <span className="font-display text-xl">{BRAND.name}</span>
          </div>
          {/* The affiliate disclosure itself lives in /terms#affiliate ("גילוי נאות" below). */}
          <p className="max-w-md text-sm leading-relaxed text-muted">
            {BRAND.name} הוא אתר עצמאי ואינו קשור לאלי אקספרס.
          </p>
        </div>
        <nav aria-label="קישורים באתר" className="grid grid-cols-2 gap-x-6 gap-y-6">
          <div>
            <h2 className="text-sm font-semibold">באתר</h2>
            <ul className="mt-1">
              <LinkList links={siteLinks} />
            </ul>
          </div>
          <div>
            <h2 className="text-sm font-semibold">מידע ומדיניות</h2>
            <ul className="mt-1">
              <LinkList links={LEGAL_LINKS} />
              <li>
                <CookieSettingsButton id={COOKIE_SETTINGS_BUTTON_ID} className={linkClass} />
              </li>
            </ul>
          </div>
        </nav>
      </div>
      <p className="border-t border-line py-5 text-center text-xs text-muted">
        © {new Date().getFullYear()} {BRAND.name}
      </p>
    </footer>
  );
}
