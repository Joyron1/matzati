import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import type { ReactNode } from "react";
import {
  Accessibility,
  CalendarDays,
  Cookie,
  ExternalLink,
  FileText,
  Handshake,
  History,
  Info,
  LayoutGrid,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Tag,
  TicketPercent,
  Users,
  type LucideIcon,
} from "lucide-react";
import { BRAND } from "@/lib/config/brand";
import { AFFILIATE_SECTION_ID, LEGAL_PAGE_NAMES, LEGAL_PATHS } from "@/lib/config/legal";
import { DEALS_ENABLED } from "@/lib/config/site";
import { hasPublishedCoupons } from "@/lib/coupons/queries";
import { hasPublishedDeals, hasUpcomingSales } from "@/lib/deals/queries";
import { COOKIE_SETTINGS_BUTTON_ID } from "@/lib/consent/store";
import { PRODUCTS_PATH } from "@/lib/hot/params";
import { subscribeToNewsletter } from "@/lib/newsletter/actions";
import { getCommunityLink, type CommunityLink } from "@/lib/settings/community";
import { CookieSettingsButton } from "./cookie-consent/cookie-settings-button";
import { LogoMark } from "./logo";
import { NewsletterCard } from "./newsletter/newsletter-card";
import { NewsletterForm } from "./newsletter/newsletter-form";
import { btnSecondary } from "./styles";

interface FooterLink {
  href: string;
  label: string;
  Icon: LucideIcon;
}

/** Which offer pages have something to show (as in the header). */
export interface FooterOffers {
  deals: boolean;
  sales: boolean;
  coupons: boolean;
}

function siteLinks(offers: FooterOffers): FooterLink[] {
  return [
    { href: "/", label: "חיפוש", Icon: Search },
    { href: PRODUCTS_PATH, label: "כל המוצרים", Icon: LayoutGrid },
    { href: "/searches", label: "חיפושים אחרונים", Icon: History },
    ...(offers.coupons ? [{ href: "/coupons", label: "קופונים", Icon: TicketPercent }] : []),
    ...(offers.sales ? [{ href: "/sales", label: "מבצעים", Icon: CalendarDays }] : []),
    ...(offers.deals ? [{ href: "/deals", label: "דילים", Icon: Tag }] : []),
  ];
}

// The affiliate disclosure lives in the terms (section id="affiliate"), linked as "גילוי נאות".
const LEGAL_LINKS: FooterLink[] = [
  { href: LEGAL_PATHS.terms, label: LEGAL_PAGE_NAMES.terms, Icon: FileText },
  { href: LEGAL_PATHS.privacy, label: LEGAL_PAGE_NAMES.privacy, Icon: ShieldCheck },
  { href: LEGAL_PATHS.cookies, label: LEGAL_PAGE_NAMES.cookies, Icon: Cookie },
  { href: LEGAL_PATHS.accessibility, label: LEGAL_PAGE_NAMES.accessibility, Icon: Accessibility },
  { href: `${LEGAL_PATHS.terms}#${AFFILIATE_SECTION_ID}`, label: "גילוי נאות", Icon: Handshake },
];

// A 44px row per link; the icon follows the text's hover color. Wraps to two lines on a narrow
// column instead of overflowing.
const linkClass =
  "group inline-flex min-h-11 cursor-pointer items-center gap-2.5 rounded-lg py-1 text-start text-[15px] leading-snug text-muted hover:text-ink";
const iconClass = "size-4 shrink-0 text-muted group-hover:text-accent";

function LinkGroup({
  title,
  links,
  children,
}: {
  title: string;
  links: FooterLink[];
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <h2 className="text-sm font-bold text-ink">{title}</h2>
      <ul className="mt-2">
        {links.map(({ href, label, Icon }) => (
          <li key={href}>
            <Link href={href} className={linkClass}>
              <Icon aria-hidden className={iconClass} />
              {label}
            </Link>
          </li>
        ))}
        {children}
      </ul>
    </div>
  );
}

/** "Join our community", only while the owner has set a link (/admin/settings). */
function CommunityButton({ link }: { link: CommunityLink }) {
  return (
    <a
      href={link.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`${btnSecondary} h-11 px-5 text-sm`}
    >
      <Users aria-hidden className="size-[18px]" />
      {link.label}
      <ExternalLink aria-hidden className="size-3.5 text-muted" />
      <span className="sr-only"> (נפתח בכרטיסייה חדשה)</span>
    </a>
  );
}

/**
 * The footer's content, from its data: rendered by SiteFooter on every page and by the dev
 * preview (/dev/preview/footer) with made-up data. `preview` renders it as a plain block, not the
 * page's contentinfo landmark, and without the cookie button's id (the page's own footer has it).
 */
export function FooterView({
  offers,
  community,
  newsletter,
  preview = false,
}: {
  offers: FooterOffers;
  community: CommunityLink | null;
  /** The newsletter card with its form. */
  newsletter: ReactNode;
  preview?: boolean;
}) {
  const Root = preview ? "div" : "footer";
  return (
    <Root className="mt-20 border-t border-line bg-surface">
      <div className="mx-auto max-w-6xl px-4 pt-10 pb-4 sm:px-6 sm:pt-14">
        {newsletter}

        <div className="mt-12 grid gap-10 lg:mt-14 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-16">
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <LogoMark className="size-11 shrink-0" />
              <div>
                <p className="font-display text-2xl leading-none text-ink">{BRAND.name}</p>
                <p className="mt-1.5 text-sm text-muted">{BRAND.tagline}</p>
              </div>
            </div>
            <p className="max-w-md leading-relaxed text-ink/90">{BRAND.description}</p>
            {/* The affiliate disclosure itself lives in /terms#affiliate ("גילוי נאות"). */}
            <p className="flex max-w-md items-start gap-2 text-sm leading-relaxed text-muted">
              <Info aria-hidden className="mt-0.5 size-4 shrink-0" />
              {BRAND.name} הוא אתר עצמאי ואינו קשור לאלי אקספרס.
            </p>
            {community && (
              <div className="pt-1">
                <CommunityButton link={community} />
              </div>
            )}
          </div>

          <nav
            aria-label="קישורים באתר"
            className="grid grid-cols-1 gap-x-6 gap-y-8 min-[360px]:grid-cols-2"
          >
            <LinkGroup title="באתר" links={siteLinks(offers)} />
            <LinkGroup title="מידע ומדיניות" links={LEGAL_LINKS}>
              <li>
                {/* The consent manager moves focus here after a keyboard choice in the banner,
                    so this button is never inside a collapsed group. */}
                <span className="group inline-flex items-center gap-2.5">
                  <SlidersHorizontal aria-hidden className={iconClass} />
                  <CookieSettingsButton
                    id={preview ? undefined : COOKIE_SETTINGS_BUTTON_ID}
                    className="inline-flex min-h-11 cursor-pointer items-center rounded-lg py-1 text-start text-[15px] leading-snug text-muted hover:text-ink"
                  />
                </span>
              </li>
            </LinkGroup>
          </nav>
        </div>
      </div>

      <div className="mt-8 border-t border-line">
        <p className="mx-auto max-w-6xl px-4 py-5 text-center text-sm text-muted sm:px-6">
          © {new Date().getFullYear()} {BRAND.name}. כל הזכויות שמורות.
        </p>
      </div>
    </Root>
  );
}

/** The community link, or null (also when it cannot be read: the button just stays hidden). */
async function communityLink(): Promise<CommunityLink | null> {
  try {
    const link = await getCommunityLink();
    if (!link || !/^https:\/\//i.test(link.url) || !link.label.trim()) return null;
    return link;
  } catch (err) {
    unstable_rethrow(err);
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[footer] community link: ${text.slice(0, 300)}`);
    return null;
  }
}

export async function SiteFooter() {
  // Deals, sales and coupons only while their pages have something to show (as in the header).
  // None of these throws: a failure reads as "nothing to show".
  const [deals, sales, coupons, community] = await Promise.all([
    DEALS_ENABLED && hasPublishedDeals(),
    hasUpcomingSales(),
    hasPublishedCoupons(),
    communityLink(),
  ]);
  return (
    <FooterView
      offers={{ deals, sales, coupons }}
      community={community}
      newsletter={
        <NewsletterCard>
          <NewsletterForm action={subscribeToNewsletter} />
        </NewsletterCard>
      }
    />
  );
}
