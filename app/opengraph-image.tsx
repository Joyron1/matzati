// The card every shared page shows unless its segment has its own (/p, /s): the brand, the tagline
// and the search box. Static: built once per deploy.
import { BRAND } from "@/lib/config/brand";
import { brandCard, OG_CONTENT_TYPE, OG_SIZE } from "@/lib/og/card";

export const alt = `${BRAND.name}: ${BRAND.tagline}`;
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default function Image() {
  return brandCard();
}
