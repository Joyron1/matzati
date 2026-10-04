import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Hebrew, Secular_One } from "next/font/google";
import { GoogleAnalytics } from "@/components/analytics/google-analytics";
import { MetaPixel } from "@/components/analytics/meta-pixel";
import { VercelAnalytics } from "@/components/analytics/vercel-analytics";
import { ConsentManager } from "@/components/cookie-consent/consent-manager";
import { InPageLink } from "@/components/in-page-link";
import { SaleBar } from "@/components/sale-bar";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { BRAND } from "@/lib/config/brand";
import { siteUrl } from "@/lib/config/site";
import { saleBarSales } from "@/lib/deals/queries";
import { OG_BASE } from "@/lib/seo/page-meta";
import { publicSettings } from "@/lib/settings/queries";
import "./globals.css";

const plex = IBM_Plex_Sans_Hebrew({
  variable: "--font-plex",
  subsets: ["hebrew", "latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const secular = Secular_One({
  variable: "--font-secular",
  subsets: ["hebrew", "latin"],
  weight: "400",
  display: "swap",
});

// The owner settings are read through a 5-minute cache under the "settings" tag (the admin's save
// expires it), so pages stay static; a failed read is an empty setting, never an error.
export async function generateMetadata(): Promise<Metadata> {
  const { siteVerification } = await publicSettings();
  const title = `${BRAND.name} | ${BRAND.tagline}`;
  return {
    // Absolute URLs for canonical links and the Open Graph images: always the official domain.
    metadataBase: new URL(siteUrl()),
    title: { default: title, template: `%s | ${BRAND.name}` },
    description: BRAND.description,
    applicationName: BRAND.name,
    // The home page's preview. Every other public page sets its own (pageMetadata), since Next
    // does not merge openGraph; the image is app/opengraph-image.tsx unless the page has one.
    // No twitter here: Next fills a page's X tags from its own openGraph when none are set.
    openGraph: { ...OG_BASE, url: siteUrl(), title, description: BRAND.description },
    // Search Console's HTML-tag verification (/admin/settings): the validated token only.
    ...(siteVerification ? { verification: { google: siteVerification } } : {}),
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EEF1F5" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1120" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [{ measurementId, metaPixelId }, saleBar] = await Promise.all([
    publicSettings(),
    saleBarSales(),
  ]);
  return (
    <html
      lang="he"
      dir="rtl"
      className={`${plex.variable} ${secular.variable} antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Product photos come from AliExpress's image host on every page with cards; the first
            ones are the largest paint on phones, and the connection (DNS, TCP, TLS) would otherwise
            start only when the first photo is discovered (Lighthouse 2026-09-30). */}
        <link rel="preconnect" href="https://ae-pic-a1.aliexpress-media.com" />
      </head>
      {/* The minimum height grows with the space the cookie banner reserves (--consent-banner-h,
          the body's bottom padding in app/globals.css): otherwise that padding would shrink
          <main> on a short page and move the footer up when the banner appears. */}
      <body className="flex min-h-[calc(100dvh+var(--consent-banner-h,0px))] flex-col">
        <ThemeProvider>
          {/* Moves focus into <main> without a history entry (InPageLink). The padding comes with
              the focus variants: not-sr-only resets padding to 0, and as a focus: utility it would
              override a plain px-5 py-3. */}
          <InPageLink
            targetId="main"
            updateUrl={false}
            className="sr-only z-50 rounded-full bg-accent font-semibold text-on-accent focus:not-sr-only focus:absolute focus:start-4 focus:top-4 focus:px-5 focus:py-3"
          >
            דלגו לתוכן
          </InPageLink>
          {/* A big sale running or starting soon, above the header (hidden on /admin and /dev). */}
          <SaleBar sales={saleBar.sales} checkedAt={saleBar.checkedAt} />
          <SiteHeader />
          {/* The skip link's target: a landmark, not a control, so no focus ring around it. */}
          <main id="main" className="flex-1 focus:outline-none">
            {children}
          </main>
          <SiteFooter />
          {/* Last in the DOM: Tab reaches the cookie banner after the footer. Client-only, so the
              layout reads no cookies and pages stay static. */}
          <ConsentManager
            analyticsInUse={measurementId !== null}
            marketingInUse={metaPixelId !== null}
          />
          {/* Google Analytics only while the owner has set an id, in Consent Mode "advanced": it
              loads for every visitor with all consent denied (cookieless pings) and sets its
              cookies only after the visitor accepts statistics; nothing on /admin or /dev.
              Renders no HTML. */}
          {measurementId && (
            <GoogleAnalytics measurementId={measurementId} marketingInUse={metaPixelId !== null} />
          )}
          {/* The Meta Pixel only while the owner has set its id, and strictly behind consent: it
              renders only inside ConsentGate "marketing" (nothing reaches Meta before the visitor
              accepts marketing), sends page views only for addresses without visitor text, and
              nothing on /admin, /dev or /go. Renders no HTML. */}
          {metaPixelId && (
            <MetaPixel pixelId={metaPixelId} analyticsInUse={measurementId !== null} />
          )}
          {/* Vercel Web Analytics: cookieless, no query strings, no admin pages (/privacy). */}
          <VercelAnalytics />
        </ThemeProvider>
      </body>
    </html>
  );
}
