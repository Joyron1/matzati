// Coupons the owner creates in /admin/coupons (not AliExpress data: every coupon is shown as
// "לפי תנאי הקופון", CLAUDE.md §1 rule 2). Public pages read published rows only (RLS).

export type CouponScope = "sitewide" | "product";

export interface Coupon {
  id: string;
  /** The code shoppers type at checkout: letters, digits, "_" and "-". */
  code: string;
  /** Hebrew heading, e.g. "₪5 הנחה" (the card adds min_spend_ils as "בהזמנה מעל ₪40"). */
  title: string;
  /** Hebrew terms as the owner wrote them; null when none. */
  terms: string | null;
  /** Minimum order in shekels, when the coupon has one. */
  min_spend_ils: number | null;
  scope: CouponScope;
  /** The product a "product" coupon is for (products.product_id); null for sitewide. */
  product_id: string | null;
  /** The big sale (deals row of type "holiday") this coupon belongs to, if any. */
  sale_id: string | null;
  /** ISO times; null starts_at = valid now, null ends_at = no end date. */
  starts_at: string | null;
  ends_at: string | null;
  /** Shown first on /coupons and eligible as the sitewide coupon on product pages. */
  featured: boolean;
  published: boolean;
  created_at: string;
  updated_at: string;
}

/** What an admin edits; id, published and the timestamps are managed separately. */
export type CouponInput = Omit<Coupon, "id" | "published" | "created_at" | "updated_at">;

/** Published coupons for /coupons, split by the time of the visit. */
export interface PublicCoupons {
  /** Valid now: featured first, then the soonest to end. */
  active: Coupon[];
  /** Starting later, soonest first. */
  upcoming: Coupon[];
}

/** Cache tag of every public coupon read; admin actions call updateTag(COUPONS_TAG). */
export const COUPONS_TAG = "coupons";
