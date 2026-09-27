"use server";
// Admin coupon mutations. Every action checks requireAdmin() itself: actions are reachable by a
// direct POST, so the guarded /admin layout is not enough. Inputs are validated here and again in
// saveCoupon() right before the service-role write.
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { importCouponProduct } from "@/lib/coupons/product-import";
import {
  CouponNotFoundError,
  CouponSaleMissingError,
  CouponValidationError,
  deleteCoupon,
  isCouponId,
  saveCoupon,
  setCouponPublished,
} from "@/lib/coupons/queries";
import {
  COUPON_ERRORS,
  parseCouponForm,
  readCouponFormValues,
  type CouponFieldErrors,
  type CouponFormState,
} from "@/lib/coupons/schema";
import { COUPONS_TAG } from "@/lib/coupons/types";
import { getDeal } from "@/lib/deals/queries";

const MISSING_COUPON = "הקופון הזה כבר לא קיים. אולי הוא נמחק בחלון אחר.";
const SAVE_FAILED = "לא הצלחנו לשמור את הקופון. נסו שוב בעוד רגע.";
const UPDATE_FAILED = "לא הצלחנו לעדכן את הקופון. נסו שוב בעוד רגע.";

function logError(where: string, err: unknown) {
  // Name and message only. Our errors name missing env keys, never their values.
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[admin-coupons] ${where}: ${text.slice(0, 300)}`);
}

/** Everything that shows coupons: /coupons, the sales page, the header link and the admin list. */
function revalidateCoupons() {
  updateTag(COUPONS_TAG);
  revalidatePath("/coupons");
  revalidatePath("/sales");
  revalidatePath("/admin/coupons");
}

/** The linked sale must be a holiday deal that still exists. Null when it is. */
async function checkSale(saleId: string): Promise<CouponFieldErrors | null> {
  try {
    const sale = await getDeal(saleId);
    return sale?.type === "holiday" ? null : { sale_id: COUPON_ERRORS.sale };
  } catch (err) {
    logError("sale", err);
    return { form: SAVE_FAILED };
  }
}

/**
 * Creates (id null) or updates a coupon from the admin form, for useActionState. Bound with the id
 * by the form. On success it redirects to /admin/coupons; otherwise it returns the typed values
 * with Hebrew errors so the form keeps what the admin wrote.
 */
export async function saveCouponAction(
  id: string | null,
  _prev: CouponFormState,
  formData: FormData,
): Promise<CouponFormState> {
  await requireAdmin();
  const values = readCouponFormValues(formData);
  if (id !== null && !isCouponId(id)) return { values, errors: { form: MISSING_COUPON } };

  const parsed = parseCouponForm(values);
  if (!parsed.ok) return { values, errors: parsed.errors };
  const input = parsed.input;

  if (input.sale_id) {
    const saleErrors = await checkSale(input.sale_id);
    if (saleErrors) return { values, errors: saleErrors };
  }

  // /p/<id> must work before a coupon links to it. Costs AliExpress calls only for a new product.
  if (input.scope === "product" && input.product_id) {
    const productErrors = await importCouponProduct(input.product_id);
    if (productErrors) return { values, errors: productErrors };
  }

  try {
    await saveCoupon(input, id ?? undefined);
  } catch (err) {
    if (err instanceof CouponValidationError) return { values, errors: err.errors };
    if (err instanceof CouponNotFoundError) return { values, errors: { form: MISSING_COUPON } };
    if (err instanceof CouponSaleMissingError) {
      return { values, errors: { sale_id: COUPON_ERRORS.sale } };
    }
    logError("save", err);
    return { values, errors: { form: SAVE_FAILED } };
  }
  revalidateCoupons();
  redirect(`/admin/coupons?status=${id === null ? "created" : "updated"}`);
}

export interface CouponRowActionState {
  error: string | null;
}

/**
 * Publish / unpublish from the admin list, for useActionState (bound with the id and the new
 * value; the state and form data it also receives are not needed).
 */
export async function setCouponPublishedAction(
  id: string,
  published: boolean,
): Promise<CouponRowActionState> {
  await requireAdmin();
  if (!isCouponId(id)) return { error: MISSING_COUPON };
  try {
    await setCouponPublished(id, published === true);
  } catch (err) {
    if (err instanceof CouponNotFoundError) return { error: MISSING_COUPON };
    logError("publish", err);
    return { error: UPDATE_FAILED };
  }
  revalidateCoupons();
  return { error: null };
}

/** Deletes a coupon after the confirm step in the admin list. Bound with the id, like above. */
export async function deleteCouponAction(id: string): Promise<CouponRowActionState> {
  await requireAdmin();
  if (!isCouponId(id)) return { error: MISSING_COUPON };
  try {
    await deleteCoupon(id);
  } catch (err) {
    logError("delete", err);
    return { error: "לא הצלחנו למחוק את הקופון. נסו שוב בעוד רגע." };
  }
  revalidateCoupons();
  redirect("/admin/coupons?status=deleted");
}
