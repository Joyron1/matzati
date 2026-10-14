import type { Metadata } from "next";
import { listApiCodes, type ApiCodeProduct } from "@/lib/coupons/api-codes";
import { listPublicCoupons, type PublicCoupons } from "@/lib/coupons/queries";
import { pageMetadata } from "@/lib/seo/page-meta";
import { COUPONS_TITLE as TITLE, CouponsView } from "./coupons-view";

const DESCRIPTION =
  "קופונים לאלי אקספרס שהוספנו, עם התנאים והתוקף של כל אחד, קודים שאלי אקספרס מצמידה למוצרים שבדקנו, והסבר קצר איך מזינים קוד בקופה.";

export const metadata: Metadata = pageMetadata({
  title: TITLE,
  description: DESCRIPTION,
  path: "/coupons",
});

/** Codes AliExpress attached to products are sparse; a long list would bury the owner coupons. */
const API_CODES_SHOWN = 24;

function logError(where: string, err: unknown) {
  console.error(
    `[coupons] ${where}: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
  );
}

async function loadCoupons(now: Date): Promise<PublicCoupons | null> {
  try {
    return await listPublicCoupons(now);
  } catch (err) {
    logError("coupons", err);
    return null;
  }
}

async function loadApiCodes(now: Date): Promise<ApiCodeProduct[] | null> {
  try {
    return (await listApiCodes(now, "page")).slice(0, API_CODES_SHOWN);
  } catch (err) {
    logError("api-codes", err);
    return null;
  }
}

// Cached 10 minutes (2026-10-14, Vercel CPU; was per request): which coupons and codes are valid
// depends on the time, so the page is made again often; the admin's saves refresh it at once
// (revalidatePath("/coupons")).
export const revalidate = 600;

export default async function CouponsPage() {
  const now = new Date();
  const [coupons, apiCodes] = await Promise.all([loadCoupons(now), loadApiCodes(now)]);

  return <CouponsView coupons={coupons} apiCodes={apiCodes} now={now} />;
}
