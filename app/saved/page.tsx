import type { Metadata } from "next";
import { SavedList } from "@/components/saved-list";
import { BRAND } from "@/lib/config/brand";
import { pageMetadata } from "@/lib/seo/page-meta";

// "המוצרים ששמרתי" (owner request 2026-10-24): the visitor's saved products, kept in their browser
// only (lib/saved/mine.ts). Static: the list is read in the browser (components/saved-list.tsx).
export const metadata: Metadata = {
  ...pageMetadata({
    title: "המוצרים ששמרתי",
    description: `המוצרים ששמרתם ב־${BRAND.name}, נשמרים רק בדפדפן שלכם.`,
    path: "/saved",
  }),
  // Each visitor's own list: nothing here for search engines.
  robots: { index: false, follow: true },
};

export default function SavedPage() {
  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
      <header className="space-y-2">
        <h1 className="font-display text-3xl sm:text-4xl">המוצרים ששמרתי</h1>
        <p className="max-w-2xl text-muted">
          המוצרים שסימנתם בלב. הרשימה נשמרת רק בדפדפן הזה, בלי הרשמה: היא לא נשלחת אלינו, ומי שמשתמש
          בדפדפן אחר או מוחק את נתוני האתר לא יראה אותה.
        </p>
      </header>
      <SavedList />
    </div>
  );
}
