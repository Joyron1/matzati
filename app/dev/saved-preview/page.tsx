// Development-only preview of /saved with made-up saved products (six real AliExpress photos and
// titles from the committed product.query fixture), so the list can be looked at and screenshotted
// without saving by hand: ./seed.tsx writes them to this browser's list once the page loads. A 404
// in production, noindex, disallowed in robots.txt (/dev/).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import SavedPage from "@/app/saved/page";
import { SeedSaved } from "./seed";

export const metadata: Metadata = {
  title: "תצוגה מקדימה: המוצרים ששמרתי",
  robots: { index: false, follow: false },
};

export default function SavedPreviewPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <>
      <SeedSaved />
      <SavedPage />
    </>
  );
}
