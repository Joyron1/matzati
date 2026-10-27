// Development-only preview of the Meta panel (/admin/meta needs a signed-in admin), so it can be
// looked at and screenshotted: the form (its actions are the real ones and run only on submit) and
// made-up scheduled items in the same cards as the panel (?kind= filters them). A 404 in
// production, noindex, disallowed in robots.txt (/dev/).
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdminAccount } from "@/app/admin/admin-account";
import { AdminShell } from "@/app/admin/admin-nav";
import { MetaForm } from "@/app/admin/meta/meta-form";
import {
  calendarHref,
  DayAgenda,
  itemsByDayKey,
  MetaCalendar,
  type CalendarLinks,
} from "@/app/admin/meta/calendar";
import { KindFilter, kindOf } from "@/app/admin/meta/scheduled";
import { card } from "@/components/styles";
import { dayKeyOf, monthOf, parseDay, parseMonth } from "@/lib/meta/calendar";
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
  sample({
    id: "00000000-0000-4000-8000-000000000005",
    kind: "post",
    scheduled_at: "2026-10-29T09:30:00Z",
    media: [{ path: "meta/p5.jpg", type: "image" }],
    caption: "מבצע 11.11 מתקרב: הרשימה שלנו",
  }),
  sample({
    id: "00000000-0000-4000-8000-000000000006",
    kind: "story",
    scheduled_at: "2026-11-03T18:00:00Z",
    media: [{ path: "meta/s2.jpg", type: "image" }],
  }),
  sample({
    id: "00000000-0000-4000-8000-000000000007",
    kind: "post",
    scheduled_at: "2026-10-22T17:00:00Z",
    status: "done",
    caption: "פוסט שכבר עלה",
    media: [{ path: "meta/p6.jpg", type: "image" }],
    ig_posted_at: "2026-10-22T17:01:00Z",
    fb_posted_at: "2026-10-22T17:01:00Z",
  }),
  sample({
    id: "00000000-0000-4000-8000-000000000008",
    kind: "reel",
    scheduled_at: "2026-10-20T17:00:00Z",
    status: "failed",
    video_path: "reels/c.mp4",
    caption: "רילז שנכשל",
    ig_error: "timeout",
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
  const params = await searchParams;
  const kindParam = firstParam(params.kind);
  const kind: MetaKind | null =
    kindParam === "reel" || kindParam === "post" || kindParam === "story" ? kindParam : null;
  const all = kind ? ITEMS.filter((r) => kindOf(r) === kind) : ITEMS;
  const upcoming = ITEMS.filter((r) => r.status === "scheduled");
  const shown = all.filter((r) => r.status === "scheduled");
  const now = new Date();
  const selectedDay = parseDay(firstParam(params.day));
  const month =
    (selectedDay ? parseMonth(selectedDay.slice(0, 7)) : null) ??
    parseMonth(firstParam(params.month)) ??
    monthOf(now);
  const links: CalendarLinks = { basePath: "/dev/meta-preview", kind };
  const previews = new Map(Object.entries(PREVIEWS));
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
        <section id="calendar" className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-bold">
              מתוזמנים <span className="text-muted">({upcoming.length})</span>
            </h2>
            <KindFilter
              items={upcoming}
              current={kind}
              href={(k) => calendarHref({ ...links, kind: k }, { month, day: selectedDay })}
            />
          </div>
          <MetaCalendar
            items={all}
            month={month}
            today={dayKeyOf(now)}
            selected={selectedDay}
            links={links}
            previews={previews}
          />
          <DayAgenda
            day={selectedDay}
            items={selectedDay ? (itemsByDayKey(all).get(selectedDay) ?? []) : []}
            shown={shown}
            kindFilter={kind}
            allHref={calendarHref(links, { month }, "day")}
            previews={previews}
          />
        </section>
      </div>
    </AdminShell>
  );
}
