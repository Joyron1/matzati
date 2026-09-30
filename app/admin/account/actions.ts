"use server";

import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin/auth";
import { ADMIN_ACCOUNT_PATH, newPasswordError } from "@/lib/admin/rules";
import { authClient } from "@/lib/supabase/ssr";

export interface PasswordFormState {
  error: string | null;
}

/** Supabase Auth's refusals of a new password, in Hebrew; anything else is "try again later". */
const SUPABASE_ERRORS: Record<string, string> = {
  same_password: "זו כבר הסיסמה של החשבון. בחרו סיסמה אחרת.",
  weak_password: "הסיסמה חלשה מדי. בחרו סיסמה ארוכה יותר, עם אותיות, ספרות וסימנים.",
  reauthentication_needed: "כדי לשנות סיסמה צריך להיכנס מחדש. צאו, היכנסו ונסו שוב.",
};

/**
 * Sets the signed-in admin's password (the first time, after a magic link, or a change). Checked
 * by requireAdmin again, then by the password rules (lib/admin/rules.ts), then by Supabase Auth.
 * The password is never logged.
 */
export async function changePasswordAction(
  _prev: PasswordFormState,
  formData: FormData,
): Promise<PasswordFormState> {
  await requireAdmin();
  const password = formData.get("password");
  const confirm = formData.get("confirm");
  const invalid = newPasswordError(password, confirm);
  if (invalid) return { error: invalid };

  try {
    const supabase = await authClient();
    const { error } = await supabase.auth.updateUser({ password: password as string });
    if (error) {
      console.error(
        `[admin-account] ${error.name} code=${error.code ?? "-"} status=${error.status ?? "-"}`,
      );
      return {
        error:
          SUPABASE_ERRORS[error.code ?? ""] ?? "לא הצלחנו לשמור את הסיסמה. נסו שוב בעוד כמה דקות.",
      };
    }
  } catch (err) {
    const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`[admin-account] ${text.slice(0, 200)}`);
    return { error: "לא הצלחנו לשמור את הסיסמה. נסו שוב בעוד כמה דקות." };
  }
  redirect(`${ADMIN_ACCOUNT_PATH}?status=password-saved`);
}
