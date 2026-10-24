// Development-only preview of the Meta panel (/admin/meta needs a signed-in admin), so it can be
// looked at and screenshotted: the form (its actions are the real ones and run only on submit) and
// made-up scheduled items in the same cards as the panel (?kind= filters them). A 404 in
// production, noindex, disallowed in robots.txt (/dev/).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminAccount } from "@/app/admin/admin-account";
import { AdminShell } from "@/app/admin/admin-nav";
import { MetaForm } from "@/app/admin/meta/meta-form";
import { byDay, KindFilter, kindOf, ScheduledCard } from "@/app/admin/meta/scheduled";
import { card } from "@/components/styles";
import type { MetaKind, MetaMedia, Reel } from "@/lib/meta/reels-run";
import { firstParam } from "@/lib/search-url";

export const metadata: Metadata = {
  title: "תצוגה מקדימה: Meta",
  robots: { index: false, follow: false },
};

/** A flat colored placeholder in place of an uploaded image. */
function swatch(color: string, w: number, h: number, text: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" fill="#fff" font-family="sans-serif" font-size="${Math.round(w / 9)}" text-anchor="middle" dominant-baseline="middle">${text}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function sample(o: Partial<Reel> & { id: string; kind: MetaKind; scheduled_at: string }): Reel {
  return {
    video_path: null,
    media: [],
    caption: "",
    facebook: true,
    instagram: true,
    status: "scheduled",
    prepared_at: null,
    fb_video_id: null,
    fb_posted_at: null,
    fb_error: null,
    ig_container_id: null,
    ig_media_id: null,
    ig_posted_at: null,
    ig_error: null,
    created_at: "2026-10-24T10:00:00Z",
    ...o,
  };
}

const ITEMS: Reel[] = [
  sample({
    id: "00000000-0000-4000-8000-000000000001",
    kind: "reel",
    scheduled_at: "2026-10-25T17:00:00Z",
    video_path: "reels/a.mp4",
    cover_path: "meta/c.jpg",
    caption: "המוצר שכולם שואלים עליו השבוע 👀\nמחזיק טלפון מגנטי לרכב",
  }),
  sample({
    id: "00000000-0000-4000-8000-000000000002",
    kind: "post",
    scheduled_at: "2026-10-25T09:00:00Z",
    media: [1, 2, 3, 4].map((n) => ({ path: `meta/p${n}.jpg`, type: "image" as const })),
    caption: "5 מוצרים לבית ב־50 ש״ח ופחות. החליקו לכולם ➡️",
  }),
  sample({
    id: "00000000-0000-4000-8000-000000000003",
    kind: "story",
    scheduled_at: "2026-10-27T16:30:00Z",
    media: [{ path: "meta/s.jpg", type: "image" }],
    manual: true,
    link_title: "אוזניות אלחוטיות עם ביטול רעשים",
    link_url: "https://www.matzati-il.com/go/1005007636277321?src=story",
  }),
  sample({
    id: "00000000-0000-4000-8000-000000000004",
    kind: "reel",
    scheduled_at: "2026-10-29T17:00:00Z",
    video_path: "reels/b.mp4",
    caption: "3 גאדג׳טים למטבח שלא ידעתם שאתם צריכים",
    instagram: false,
  }),
];

const PREVIEWS: Record<string, { file: MetaMedia; url: string | null }[]> = {
  "00000000-0000-4000-8000-000000000001": [
    { file: { path: "meta/c.jpg", type: "image" }, url: swatch("#e2241f", 540, 960, "קאבר") },
  ],
  "00000000-0000-4000-8000-000000000002": [
    { file: { path: "meta/p1.jpg", type: "image" }, url: swatch("#e8590c", 600, 600, "1/4") },
  ],
  "00000000-0000-4000-8000-000000000003": [
    { file: { path: "meta/s.jpg", type: "image" }, url: swatch("#111827", 540, 960, "סטורי") },
  ],
  "00000000-0000-4000-8000-000000000004": [
    { file: { path: "meta/v.jpg", type: "image" }, url: swatch("#007a52", 540, 960, "9:16") },
  ],
};

export default async function MetaPreview({ searchParams }: PageProps<"/dev/meta-preview">) {
  if (process.env.NODE_ENV === "production") notFound();
  const kindParam = firstParam((await searchParams).kind);
  const kind: MetaKind | null =
    kindParam === "reel" || kindParam === "post" || kindParam === "story" ? kindParam : null;
  const shown = kind ? ITEMS.filter((r) => kindOf(r) === kind) : ITEMS;
  return (
    <AdminShell previewPath="/admin/meta" account={<AdminAccount email="owner@example.com" />}>
      <div className="mx-auto max-w-5xl space-y-10 px-4 pt-8 pb-16 sm:px-6 sm:pt-12">
        <div className="space-y-2">
          <h1 className="font-display text-4xl font-bold">פרסום בפייסבוק ובאינסטגרם</h1>
          <p className="max-w-prose text-muted">
            תצוגה מקדימה עם פריטים מומצאים. הכפתורים כאן אמיתיים: אל תלחצו ״ביטול״ או ״תזמון״.
          </p>
        </div>
        <section className={`${card} space-y-4 p-5 sm:p-6`}>
          <h2 className="font-display text-2xl font-bold">תזמון חדש</h2>
          <MetaForm defaultWhen="2026-10-25T20:00" minWhen="2026-10-24T12:00" />
        </section>
        <section id="upcoming" className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-bold">
              מתוזמנים <span className="text-muted">({ITEMS.length})</span>
            </h2>
            <KindFilter items={ITEMS} current={kind} />
          </div>
          <div className="space-y-6">
            {byDay(shown).map(([day, list]) => (
              <section key={day} aria-label={day} className="space-y-3">
                <h3 className="flex items-center gap-2 text-sm font-bold text-muted">
                  {day}
                  <span className="h-px flex-1 bg-line" />
                </h3>
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((r) => (
                    <ScheduledCard key={r.id} r={r} previews={PREVIEWS[r.id] ?? []} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </section>
      </div>
    </AdminShell>
  );
}
