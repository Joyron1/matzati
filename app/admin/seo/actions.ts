"use server";
// Admin mutations for SEO landing pages. Every action checks requireAdmin() itself: actions are
// reachable by a direct POST, so the guarded /admin layout is not enough. Inputs are validated
// here and again in saveSeoPage() right before the service-role write.
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { requireAdmin } from "@/lib/admin/auth";
import {
  deleteSeoPage,
  getSeoPage,
  SEO_TAG,
  SeoPageNotFoundError,
  SeoSlugTakenError,
  SeoValidationError,
  saveSeoPage,
  type SeoPage,
} from "@/lib/seo/queries";
import { ADMIN_CLAIM_WINDOW_MS, type RefreshOutcome } from "@/lib/seo/refresh";
import { seoRefresher, snapshotWritesAllowed } from "@/lib/seo/refresh-server";
import { parseSeoForm, readSeoFormValues, SEO_ERRORS, type SeoFormState } from "@/lib/seo/schema";
import { isValidSlug } from "@/lib/seo/slug";
import { refreshNoteText, shouldRefreshAfterSave } from "@/lib/seo/snapshot";

const MISSING_PAGE = "הדף הזה כבר לא קיים. אולי הוא נמחק בחלון אחר.";
const SAVE_FAILED = "לא הצלחנו לשמור את הדף. נסו שוב בעוד רגע.";

/**
 * The pages whose actions refresh results export maxDuration = 60 (Vercel Hobby's limit); a
 * refresh must be done, retry included, this long after it starts.
 */
const REFRESH_BUDGET_MS = 55_000;

function logError(where: string, err: unknown) {
  // Name and message only. Our errors name missing env keys, never their values.
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[admin-seo] ${where}: ${text.slice(0, 300)}`);
}

/**
 * Everything that shows landing pages: the pages themselves (old and new slug on a rename), the
 * sitemap, the home "חיפושים פופולריים" list and the admin list. The home list reads through
 * SEO_TAG, so no revalidatePath("/"): the home page renders per visit, and expiring its path would
 * drop the cached hot lists it reads too.
 */
function revalidateSeo(slugs: string[]) {
  updateTag(SEO_TAG);
  for (const slug of new Set(slugs)) revalidatePath(`/s/${slug}`);
  revalidatePath("/sitemap.xml");
  revalidatePath("/admin/seo");
}

/** Refreshes a page's stored results (lib/seo/refresh.ts) and revalidates what shows them. */
async function refreshPage(slug: string): Promise<RefreshOutcome> {
  const outcome = await seoRefresher.refresh(slug, {
    claimWindowMs: ADMIN_CLAIM_WINDOW_MS,
    deadline: Date.now() + REFRESH_BUDGET_MS,
  });
  if (outcome.status === "stored") revalidatePath(`/s/${slug}`);
  revalidatePath("/admin/seo");
  return outcome;
}

/**
 * Creates (originalSlug null) or updates a landing page from the admin form, for useActionState.
 * Bound with the original slug by the form. On success it redirects to /admin/seo; otherwise it
 * returns the typed values with Hebrew errors so the form keeps what the admin wrote. A page that
 * is published now (new, or a draft before) or whose query changed gets its results right away:
 * the refresh runs after the response (after()), so the first visitor sees stored results.
 */
export async function saveSeoPageAction(
  originalSlug: string | null,
  _prev: SeoFormState,
  formData: FormData,
): Promise<SeoFormState> {
  await requireAdmin();
  const values = readSeoFormValues(formData);
  if (originalSlug !== null && !isValidSlug(originalSlug)) {
    return { values, errors: { form: MISSING_PAGE } };
  }

  const parsed = parseSeoForm(values);
  if (!parsed.ok) return { values, errors: parsed.errors };

  let saved: SeoPage;
  let previous: SeoPage | null = null;
  try {
    if (originalSlug !== null) {
      // Only to tell whether the page was just published or its query changed.
      previous = await getSeoPage(originalSlug).catch((err: unknown) => {
        logError("read", err);
        return null;
      });
    }
    saved = await saveSeoPage(parsed.input, originalSlug ?? undefined);
  } catch (err) {
    if (err instanceof SeoValidationError) return { values, errors: err.errors };
    if (err instanceof SeoSlugTakenError) return { values, errors: { slug: SEO_ERRORS.slugTaken } };
    if (err instanceof SeoPageNotFoundError) return { values, errors: { form: MISSING_PAGE } };
    logError("save", err);
    return { values, errors: { form: SAVE_FAILED } };
  }
  revalidateSeo(originalSlug ? [originalSlug, saved.slug] : [saved.slug]);
  const refreshing = shouldRefreshAfterSave(previous, saved) && snapshotWritesAllowed();
  if (refreshing) {
    const slug = saved.slug;
    // A callback, not a promise: its revalidatePath runs after the response, where after()
    // applies it (a promise's would be recorded once the action had already answered).
    after(async () => {
      await refreshPage(slug);
    });
  }
  const status = originalSlug === null ? "created" : "updated";
  redirect(`/admin/seo?status=${status}${refreshing ? "-refreshing" : ""}`);
}

export interface SeoRowActionState {
  error: string | null;
}

/** Deletes a landing page after the confirm step in the admin list. Bound with the slug. */
export async function deleteSeoPageAction(slug: string): Promise<SeoRowActionState> {
  await requireAdmin();
  if (!isValidSlug(slug)) return { error: MISSING_PAGE };
  try {
    await deleteSeoPage(slug);
  } catch (err) {
    logError("delete", err);
    return { error: "לא הצלחנו למחוק את הדף. נסו שוב בעוד רגע." };
  }
  revalidateSeo([slug]);
  redirect("/admin/seo?status=deleted");
}

export interface SeoRefreshState {
  /** The result in Hebrew; null before the first click. */
  message: string | null;
  stored: boolean;
}

/** The admin's Hebrew line for a refresh's outcome. */
function refreshMessage(outcome: RefreshOutcome): string {
  switch (outcome.status) {
    case "stored":
      return outcome.count === 1 ? "נשמר מוצר אחד." : `נשמרו ${outcome.count} מוצרים.`;
    case "kept":
      return outcome.note === "changed"
        ? "הדף השתנה בזמן הרענון, ולכן לא נשמר דבר. נסו שוב."
        : refreshNoteText(outcome.note, outcome.hadSnapshot);
    case "failed":
      return `הרענון לא הצליח: ${refreshNoteText(outcome.error, false)}`;
    case "busy":
      return "רענון של הדף הזה רץ עכשיו או התחיל לפני רגע. נסו שוב בעוד דקה או שתיים.";
    case "missing":
      return "הדף לא מפורסם או כבר לא קיים.";
    case "disabled":
      return "רענון שומר תוצאות רק באתר עצמו, לא בסביבת פיתוח או תצוגה מקדימה.";
  }
}

/**
 * "רענון עכשיו" in the admin list: the same refresh as the cron's (a fresh search, stored only
 * when at least as good; a refresh of the page already running on this server is joined).
 * Bound with the slug.
 */
export async function refreshSeoPageAction(slug: string): Promise<SeoRefreshState> {
  await requireAdmin();
  if (!isValidSlug(slug)) return { message: MISSING_PAGE, stored: false };
  const outcome = await refreshPage(slug);
  return { message: refreshMessage(outcome), stored: outcome.status === "stored" };
}
