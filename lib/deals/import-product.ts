// A deal that names a product links to /p/<id>, and /p only serves products we have saved. When
// the admin names a product we have not seen, fetch it once from AliExpress, make sure it has an
// affiliate link (a product we cannot link is never shown), and save it. The AliExpress and
// Supabase calls come in as deps, so the flow is tested with fakes.
import type { AliProduct } from "@/lib/aliexpress/schemas";

export interface ProductImportDeps {
  /** Whether the products table already has this product. */
  isStored(productId: string): Promise<boolean>;
  /** productdetail.get; null when AliExpress does not know the id. */
  fetchDetails(productId: string): Promise<AliProduct | null>;
  /** link.generate for the product page; null when AliExpress gives no link. */
  generateLink(productId: string): Promise<string | null>;
  save(product: AliProduct): Promise<void>;
}

export type ProductImportError = "not_found" | "no_link" | "not_saved";

export type ProductImportResult =
  { ok: true; imported: boolean } | { ok: false; error: ProductImportError };

export const PRODUCT_IMPORT_ERRORS: Record<ProductImportError | "unavailable", string> = {
  not_found: "אלי אקספרס לא מכירה מוצר עם המספר הזה. בדקו את הקישור או את מספר המוצר.",
  no_link: "אלי אקספרס לא נתנה קישור שותפים למוצר הזה, אז אי אפשר לקשר אליו. נסו מוצר אחר.",
  not_saved: "לא הצלחנו לשמור את פרטי המוצר. נסו לשמור שוב.",
  unavailable: "לא הצלחנו לבדוק את המוצר מול אלי אקספרס כרגע. נסו שוב בעוד רגע.",
};

/** Errors thrown by the deps (AliExpress or the database is down) propagate to the caller. */
export async function ensureDealProduct(
  productId: string,
  deps: ProductImportDeps,
): Promise<ProductImportResult> {
  if (await deps.isStored(productId)) return { ok: true, imported: false };

  const product = await deps.fetchDetails(productId);
  if (!product || product.productId !== productId) return { ok: false, error: "not_found" };

  const promotionLink = product.promotionLink ?? (await deps.generateLink(productId));
  if (!promotionLink) return { ok: false, error: "no_link" };

  await deps.save({ ...product, promotionLink });
  // The store logs and swallows write failures, so check that the row is really there.
  if (!(await deps.isStored(productId))) return { ok: false, error: "not_saved" };
  return { ok: true, imported: true };
}
