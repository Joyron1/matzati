import type { Metadata } from "next";
import { requireAdmin } from "@/lib/admin/auth";
import { firstParam } from "@/lib/search-url";
import { StatusMessage } from "../status-message";
import { ChangePasswordForm } from "./password-form";

export const metadata: Metadata = {
  title: "חשבון", // the admin layout adds "| ניהול | <brand>"
  robots: { index: false, follow: false },
};

const STATUS: Record<string, string> = {
  "password-saved": "הסיסמה נשמרה. מעכשיו אפשר להיכנס עם האימייל והסיסמה.",
};

/**
 * "חשבון": the signed-in admin's password (set it the first time after a magic link, or change
 * it). Who may enter is ADMIN_EMAILS in Vercel; this page only sets the password of this account.
 */
export default async function AdminAccountPage({ searchParams }: PageProps<"/admin/account">) {
  const admin = await requireAdmin();
  const statusKey = firstParam((await searchParams).status);
  const status = Object.hasOwn(STATUS, statusKey) ? STATUS[statusKey] : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 pt-8 pb-16 sm:px-6 sm:pt-12">
      <div className="space-y-2">
        <h1 className="font-display text-3xl">חשבון</h1>
        <p className="leading-relaxed text-muted">
          מחוברים בתור <bdi dir="ltr">{admin.email}</bdi>. כאן קובעים את הסיסמה לכניסה לניהול.
          הסיסמה נשמרת מוצפנת אצל Supabase ואף אחד, גם לא אנחנו, לא יכול לקרוא אותה.
        </p>
      </div>
      {status && <StatusMessage>{status}</StatusMessage>}
      <ChangePasswordForm email={admin.email} />
    </div>
  );
}
