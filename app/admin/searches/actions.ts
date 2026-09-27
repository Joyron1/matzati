"use server";
// Hide a search from the public recent-searches page (/searches), or bring it back. Every action
// checks requireAdmin() itself: actions are reachable by a direct POST, so the guarded /admin
// layout is not enough. The bound query_norm comes from the client, so it is validated here.
import { revalidatePath, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { hideRecentSearch, queryNormSchema, restoreRecentSearch } from "@/lib/recent/queries";
import { RECENT_TAG } from "@/lib/recent/types";

const UNKNOWN_SEARCH = "לא זיהינו את החיפוש הזה. רעננו את הדף ונסו שוב.";

function logError(where: string, err: unknown) {
  // Name and message only. Our errors name missing env keys, never their values.
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  console.error(`[admin-searches] ${where}: ${text.slice(0, 300)}`);
}

/** Everything that shows recent searches: /searches, the home strip and the admin list. */
function revalidateRecent() {
  updateTag(RECENT_TAG);
  revalidatePath("/searches");
  revalidatePath("/");
  revalidatePath("/admin/searches");
}

export interface SearchActionState {
  error: string | null;
}

/**
 * Hides every search with this normalized text, for useActionState (bound with the query_norm;
 * the state and form data it also receives are not needed).
 */
export async function hideSearchAction(queryNorm: string): Promise<SearchActionState> {
  await requireAdmin();
  const parsed = queryNormSchema.safeParse(queryNorm);
  if (!parsed.success) return { error: UNKNOWN_SEARCH };
  try {
    await hideRecentSearch(parsed.data);
  } catch (err) {
    logError("hide", err);
    return { error: "לא הצלחנו להסתיר את החיפוש. נסו שוב בעוד רגע." };
  }
  revalidateRecent();
  redirect("/admin/searches?status=hidden");
}

/** Lists a hidden search again. Bound with the query_norm, like above. */
export async function restoreSearchAction(queryNorm: string): Promise<SearchActionState> {
  await requireAdmin();
  const parsed = queryNormSchema.safeParse(queryNorm);
  if (!parsed.success) return { error: UNKNOWN_SEARCH };
  try {
    await restoreRecentSearch(parsed.data);
  } catch (err) {
    logError("restore", err);
    return { error: "לא הצלחנו להחזיר את החיפוש. נסו שוב בעוד רגע." };
  }
  revalidateRecent();
  redirect("/admin/searches?status=restored");
}
