// X (Twitter) shows the same card as Open Graph (./opengraph-image.tsx).
import { BRAND } from "@/lib/config/brand";
import { brandCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";

export const alt = `${BRAND.name}: ${BRAND.tagline}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return brandCard();
}
