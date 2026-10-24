import type { Metadata } from "next";
import type { ReactNode } from "react";
import { requireAdmin } from "@/lib/admin/auth";
import { BRAND } from "@/lib/config/brand";
import { AdminAccount } from "./admin-account";
import { AdminShell } from "./admin-nav";
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
    <AdminShell account={<AdminAccount email={admin.email} signOut={signOutAdmin} />}>
      {children}
    </AdminShell>
  );
}
