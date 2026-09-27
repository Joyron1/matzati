import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LockKeyhole } from "lucide-react";
import { card } from "@/components/styles";
import { getAdminUser } from "@/lib/admin/auth";
import { ADMIN_HOME_PATH, LOGIN_ERROR_MESSAGES, loginErrorFromParam } from "@/lib/admin/rules";
import { LoginForm } from "./login-form";

// In a route group outside app/admin, so the guarded admin layout (requireAdmin) does not wrap it.
export const metadata: Metadata = {
  title: "כניסה לניהול",
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (await getAdminUser()) redirect(ADMIN_HOME_PATH);

  const error = loginErrorFromParam((await searchParams).error);

  return (
    <div className="mx-auto max-w-md px-4 pb-16 pt-10 sm:pt-16">
      <section className={`${card} p-6 sm:p-8`} aria-labelledby="admin-login-title">
        <span className="grid size-12 place-items-center rounded-full bg-accent-soft text-accent-ink">
          <LockKeyhole aria-hidden className="size-6" />
        </span>
        <h1 id="admin-login-title" className="mt-4 font-display text-3xl">
          כניסה לניהול
        </h1>
        <p className="mt-2 leading-relaxed text-muted">
          כתבו את כתובת האימייל שלכם ונשלח אליה קישור כניסה. אין צורך בסיסמה.
        </p>
        <LoginForm notice={error ? LOGIN_ERROR_MESSAGES[error] : null} />
      </section>
    </div>
  );
}
