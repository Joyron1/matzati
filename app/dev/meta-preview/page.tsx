// Development-only preview of the Meta panel form (/admin/meta needs a signed-in admin), so it
// can be looked at and screenshotted. Its actions are the real ones and run only on submit. A 404 in
// production, noindex, disallowed in robots.txt (/dev/).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarClock, CheckCircle2 } from "lucide-react";
import { AdminAccount } from "@/app/admin/admin-account";
import { AdminShell } from "@/app/admin/admin-nav";
import { MetaForm } from "@/app/admin/meta/meta-form";
import { btnSecondary, btnSm, card } from "@/components/styles";

export const metadata: Metadata = {
  title: "תצוגה מקדימה: Meta",
  robots: { index: false, follow: false },
};

const SAMPLE = [
  {
    when: "יום ראשון 25.10 בשעה 20:00",
    caption: "המוצר שכולם שואלים עליו השבוע 👀\nמחזיק טלפון מגנטי לרכב...",
  },
  { when: "יום שלישי 27.10 בשעה 20:00", caption: "5 מוצרים לבית ב־50 ש״ח ופחות..." },
];

export default function MetaPreview() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <AdminShell previewPath="/admin/meta" account={<AdminAccount email="owner@example.com" />}>
      <div className="mx-auto max-w-4xl space-y-10 px-4 pt-8 pb-16 sm:px-6 sm:pt-12">
        <div className="space-y-2">
          <h1 className="font-display text-4xl">פרסום בפייסבוק ובאינסטגרם</h1>
          <p className="max-w-prose text-muted">
            מעלים באנר, תמונות או סרטון, כותבים כיתוב, בוחרים רשתות וזמן. המערכת מפרסמת בזמן: פוסט
            (תמונה או קרוסלה), סטורי או רילז. אפשר לבטל עד שזה עולה.
          </p>
        </div>
        <section className={`${card} space-y-4 p-5 sm:p-6`}>
          <h2 className="font-display text-2xl">תזמון חדש</h2>
          <MetaForm defaultWhen="2026-10-25T20:00" minWhen="2026-10-24T12:00" />
        </section>
        <section className="space-y-4">
          <h2 className="font-display text-2xl">
            מתוזמנים <span className="text-muted">(2)</span>
          </h2>
          <ul className="space-y-3">
            {SAMPLE.map((s) => (
              <li key={s.when} className={`${card} flex flex-wrap gap-4 p-4`}>
                <div className="grid h-44 w-24 place-items-center rounded-xl bg-ink text-xs text-bg">
                  9:16
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="font-bold">{s.when}</p>
                  <p className="text-sm whitespace-pre-line text-muted">{s.caption}</p>
                  <p className="flex flex-wrap gap-x-4 text-sm">
                    <span className="inline-flex items-center gap-1">
                      <CalendarClock aria-hidden className="size-4 text-muted" />
                      אינסטגרם
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <CheckCircle2 aria-hidden className="size-4 text-accent-ink" />
                      פייסבוק
                    </span>
                  </p>
                  <button type="button" className={`${btnSecondary} ${btnSm}`}>
                    ביטול
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AdminShell>
  );
}
