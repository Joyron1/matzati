"use server";
// Admin deal mutations. Every action checks requireAdmin() itself: actions are reachable by a
// direct POST, so the guarded /admin layout is not enough. Inputs are validated here and again in
// saveDeal() right before the service-role write.
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { generateLinks, getProductDetails } from "@/lib/aliexpress/affiliate";
import { AliExpressClient } from "@/lib/aliexpress/client";
import { AliExpressError } from "@/lib/aliexpress/errors";
import {
  ensureDealProduct,
  PRODUCT_IMPORT_ERRORS,
  type ProductImportDeps,
} from "@/lib/deals/import-product";
import {
  DEALS_TAG,
  DealNotFoundError,
  DealValidationError,
  deleteDeal,
  isDealId,
  saveDeal,
  setDealPublished,
} from "@/lib/deals/queries";
import {
  parseDealForm,
  readFormValues,
  type DealFormState,
  type FieldErrors,
} from "@/lib/deals/schema";
import { aliexpressConfig } from "@/lib/env";
import { SupabaseStore } from "@/lib/search/supabase-store";
import { serviceClient } from "@/lib/supabase/server";

const MISSING_DEAL = "הדיל הזה כבר לא קיים. אולי הוא נמחק בחלון אחר.";
const SAVE_FAILED = "לא הצלחנו לשמור את הדיל. נסו שוב בעוד רגע.";
const UPDATE_FAILED = "לא הצלחנו לעדכן את הדיל. נסו שוב בעוד רגע.";

function logError(where: string, err: unknown) {
  // Name and message only. Our errors name missing env keys, never their values.
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[admin-deals] ${where}: ${text.slice(0, 300)}`);
}

/**
 * Everything that shows deals: the public board, the sales calendar, the home countdown and the
 * admin list. The tag also refreshes the menu links (hasPublishedDeals, hasUpcomingSales).
 */
function revalidateDeals() {
  updateTag(DEALS_TAG);
  revalidatePath("/deals");
  revalidatePath("/sales");
  revalidatePath("/");
  revalidatePath("/admin");
}

function productImportDeps(): ProductImportDeps {
  const store = new SupabaseStore(serviceClient());
  let client: AliExpressClient | undefined;
  const ali = () => (client ??= new AliExpressClient(aliexpressConfig()));
  return {
    isStored: async (id) => (await store.getProduct(id)) !== null,
    fetchDetails: async (id) => {
      const page = await getProductDetails(ali(), [id]);
      return page.products.find((p) => p.productId === id) ?? null;
    },
    generateLink: async (id) => {
      const links = await generateLinks(ali(), [`https://www.aliexpress.com/item/${id}.html`]);
      return links.find((l) => l.promotionLink)?.promotionLink ?? null;
    },
    // No Hebrew title: /p shows the AliExpress title until a search writes one.
    save: (product) => store.saveProducts([product], {}),
  };
}

/** Makes sure /p/<id> will work for the deal's product. Null when it will; errors otherwise. */
async function importProduct(productId: string): Promise<FieldErrors | null> {
  try {
    const result = await ensureDealProduct(productId, productImportDeps());
    if (result.ok) return null;
    return result.error === "not_saved"
      ? { form: PRODUCT_IMPORT_ERRORS.not_saved }
      : { product_id: PRODUCT_IMPORT_ERRORS[result.error] };
  } catch (err) {
    if (err instanceof AliExpressError && err.kind === "invalid_request") {
      return { product_id: PRODUCT_IMPORT_ERRORS.not_found };
    }
    logError("product", err);
    return { form: PRODUCT_IMPORT_ERRORS.unavailable };
  }
}

/**
 * Creates (id null) or updates a deal from the admin form, for useActionState. Bound with the id
 * by the form. On success it redirects to /admin; otherwise it returns the typed values with
 * Hebrew errors so the form keeps what the admin wrote.
 */
export async function saveDealAction(
  id: string | null,
  _prev: DealFormState,
  formData: FormData,
): Promise<DealFormState> {
  await requireAdmin();
  const values = readFormValues(formData);
  if (id !== null && !isDealId(id)) return { values, errors: { form: MISSING_DEAL } };

  const parsed = parseDealForm(values);
  if (!parsed.ok) return { values, errors: parsed.errors };

  if (parsed.input.product_id) {
    const productErrors = await importProduct(parsed.input.product_id);
    if (productErrors) return { values, errors: productErrors };
  }

  try {
    await saveDeal(parsed.input, id ?? undefined);
  } catch (err) {
    if (err instanceof DealValidationError) return { values, errors: err.errors };
    if (err instanceof DealNotFoundError) return { values, errors: { form: MISSING_DEAL } };
    logError("save", err);
    return { values, errors: { form: SAVE_FAILED } };
  }
  revalidateDeals();
  redirect(`/admin?status=${id === null ? "created" : "updated"}`);
}

export interface RowActionState {
  error: string | null;
}

/**
 * Publish / unpublish from the admin list, for useActionState (bound with the id and the new
 * value; the state and form data it also receives are not needed).
 */
export async function setPublishedAction(id: string, published: boolean): Promise<RowActionState> {
  await requireAdmin();
  if (!isDealId(id)) return { error: MISSING_DEAL };
  try {
    await setDealPublished(id, published === true);
  } catch (err) {
    if (err instanceof DealNotFoundError) return { error: MISSING_DEAL };
    logError("publish", err);
    return { error: UPDATE_FAILED };
  }
  revalidateDeals();
  return { error: null };
}

/** Deletes a deal after the confirm step in the admin list. Bound with the id, like above. */
export async function deleteDealAction(id: string): Promise<RowActionState> {
  await requireAdmin();
  if (!isDealId(id)) return { error: MISSING_DEAL };
  try {
    await deleteDeal(id);
  } catch (err) {
    logError("delete", err);
    return { error: "לא הצלחנו למחוק את הדיל. נסו שוב בעוד רגע." };
  }
  revalidateDeals();
  redirect("/admin?status=deleted");
}
