import type { Metadata } from "next";
import { connection } from "next/server";
import { BRAND } from "@/lib/config/brand";
import { absoluteUrl } from "@/lib/config/site";
import { listApiCodes, type ApiCodeProduct } from "@/lib/coupons/api-codes";
import { listPublicCoupons, type PublicCoupons } from "@/lib/coupons/queries";
import { COUPONS_TITLE as TITLE, CouponsView } from "./coupons-view";

const DESCRIPTION =
  "קופונים לאלי אקספרס שהוספנו, עם התנאים והתוקף של כל אחד, קודים שאלי אקספרס מצמידה למוצרים שבדקנו, והסבר קצר איך מזינים קוד בקופה.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl("/coupons") },
  openGraph: {
    type: "website",
    locale: "he_IL",
    siteName: BRAND.name,
    url: absoluteUrl("/coupons"),
    title: `${TITLE} | ${BRAND.name}`,
    description: DESCRIPTION,
  },
};

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
    return (await listApiCodes(now)).slice(0, API_CODES_SHOWN);
  } catch (err) {
    logError("api-codes", err);
    return null;
  }
}

export default async function CouponsPage() {
  // Rendered per request: which coupons are valid depends on the time of the visit.
  await connection();
  const now = new Date();
  const [coupons, apiCodes] = await Promise.all([loadCoupons(now), loadApiCodes(now)]);

  return <CouponsView coupons={coupons} apiCodes={apiCodes} now={now} />;
}
