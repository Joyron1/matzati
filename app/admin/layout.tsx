import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { LogOut, ShieldCheck } from "lucide-react";
import { btnSecondary } from "@/components/styles";
import { requireAdmin } from "@/lib/admin/auth";
import { BRAND } from "@/lib/config/brand";
import { AdminNav } from "./admin-nav";
import { signOutAdmin } from "./logout/actions";

// /admin/login lives outside this folder (app/(admin-public)/admin/login), so it is not guarded
// here. Layouts do not re-run on client-side navigation: every admin page and server action must
// still call requireAdmin() itself; this check is the first line, not the only one.
export const metadata: Metadata = {
  title: { default: "ניהול", template: `%s | ניהול | ${BRAND.name}` },
  robots: { index: false, follow: false },
};

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();

  return (
    <>
      <div className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2 sm:px-6">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Link
              href="/admin"
              className="flex min-h-11 items-center gap-2 rounded-full font-semibold text-ink hover:text-accent-ink"
            >
              <ShieldCheck aria-hidden className="size-5 text-accent" />
              ניהול האתר
            </Link>
            <AdminNav />
          </div>
          <div className="flex min-w-0 items-center gap-3">
            <p className="min-w-0 truncate text-sm text-muted">
              <span className="sr-only">מחוברים בתור </span>
              <bdi dir="ltr">{admin.email}</bdi>
            </p>
            <form action={signOutAdmin}>
              <button type="submit" className={`${btnSecondary} h-11 px-4 text-sm`}>
                <LogOut aria-hidden className="size-4 rtl:-scale-x-100" />
                יציאה
              </button>
            </form>
          </div>
        </div>
      </div>
      {children}
    </>
  );
}
