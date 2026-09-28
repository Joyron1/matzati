"use server";
// The newsletter's server actions: the footer's sign-up form (useActionState; without JavaScript
// the form posts and the page renders with the returned state) and the unsubscribe page's confirm
// button. Both are public (no sign-in): every input is validated here, the sign-up is rate
// limited per IP, and neither answer reveals whether an address is on the list.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { deployEnv } from "@/lib/env";
import { serviceClient } from "@/lib/supabase/server";
import type { NewsletterFormState } from "./consent";
import { subscribe, unsubscribe } from "./subscribe";
import { UNSUBSCRIBE_PATH } from "./token";

/** The footer form's action. The previous state is not used: every submission stands alone. */
export async function subscribeToNewsletter(
  _prev: NewsletterFormState,
  formData: FormData,
): Promise<NewsletterFormState> {
  return subscribe(formData, {
    db: serviceClient,
    headers: await headers(),
    salt: process.env.IP_HASH_SALT ?? "",
    now: new Date(),
    env: deployEnv(),
  });
}

/**
 * The unsubscribe page's confirm button: unsubscribes, then shows the result on a URL without the
 * token (a 303 without JavaScript). After a database failure it returns to the same token.
 */
export async function unsubscribeFromNewsletter(formData: FormData): Promise<never> {
  const outcome = await unsubscribe(formData, { db: serviceClient });
  if (outcome === "error") {
    const token = String(formData.get("token"));
    redirect(`${UNSUBSCRIBE_PATH}?token=${encodeURIComponent(token)}&status=error`);
  }
  redirect(`${UNSUBSCRIBE_PATH}?status=${outcome}`);
}
