import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans_Hebrew, Secular_One } from "next/font/google";
import { Info } from "lucide-react";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { ThemeProvider } from "@/components/theme-provider";
import { BRAND } from "@/lib/config/brand";
import { USING_MOCK_DATA } from "@/lib/config/site";
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

export const metadata: Metadata = {
  title: { default: `${BRAND.name} | ${BRAND.tagline}`, template: `%s | ${BRAND.name}` },
  description: BRAND.description,
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#EEF1F5" },
    { media: "(prefers-color-scheme: dark)", color: "#0B1120" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="he"
      dir="rtl"
      className={`${plex.variable} ${secular.variable} antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-dvh flex-col">
        <ThemeProvider>
          <a
            href="#main"
            className="sr-only z-50 rounded-full bg-accent px-5 py-3 font-semibold text-on-accent focus:not-sr-only focus:absolute focus:start-4 focus:top-4"
          >
            דלגו לתוכן
          </a>
          {USING_MOCK_DATA && (
            <div className="bg-invert-bg text-invert-ink">
              <p className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2 text-sm sm:px-6">
                <Info aria-hidden className="size-4 shrink-0" />
                גרסת עיצוב: המוצרים והמספרים בעמודים הם נתוני דוגמה.
              </p>
            </div>
          )}
          <SiteHeader />
          <main id="main" className="flex-1">
            {children}
          </main>
          <SiteFooter />
        </ThemeProvider>
      </body>
    </html>
  );
}
