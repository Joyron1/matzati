// The Meta panel's scheduled items (owner request 2026-10-24: cards by day, filtered by kind),
// shared by /admin/meta and its dev preview.
import Link from "next/link";
import { Ban, CalendarClock, CheckCircle2, CircleAlert, Hand, Pencil } from "lucide-react";
import { btnSecondary, btnSm, card } from "@/components/styles";
import type { MetaKind, MetaMedia, Reel } from "@/lib/meta/reels-run";
import { reelTimeLabel, toIsraelLocal } from "@/lib/meta/reels-time";
import { PendingButton } from "../progress";
import { cancelMetaAction } from "./actions";

export const KIND_LABEL: Record<MetaKind, string> = { post: "פוסט", story: "סטורי", reel: "רילז" };

export const kindOf = (r: Reel): MetaKind => r.kind ?? "reel";
export const filesOf = (r: Reel): MetaMedia[] =>
  kindOf(r) === "reel"
    ? r.video_path
      ? [{ path: r.video_path, type: "video" }]
      : []
    : (r.media ?? []);
export const editable = (r: Reel) =>
  r.status === "scheduled" && !r.ig_posted_at && !r.fb_posted_at && !r.notified_at;

export function Network({
  name,
  asked,
  postedAt,
  error,
}: {
  name: string;
  asked: boolean;
  postedAt: string | null;
  error: string | null;
}) {
  if (!asked) return null;
  return (
    <span className="inline-flex items-center gap-1">
      {postedAt ? (
        <CheckCircle2 aria-hidden className="size-4 text-trust" />
      ) : error ? (
        <CircleAlert aria-hidden className="size-4 text-accent" />
      ) : (
        <CalendarClock aria-hidden className="size-4 text-muted" />
      )}
      {name}
      {postedAt ? ": עלה" : error ? `: נכשל (${error})` : ""}
    </span>
  );
}

export function Networks({ r }: { r: Reel }) {
  if (r.manual) {
    const where = [r.instagram ? "אינסטגרם" : null, r.facebook ? "פייסבוק" : null]
      .filter(Boolean)
      .join(" + ");
    return (
      <p className="flex items-center gap-1 text-sm">
        <Hand aria-hidden className="size-4 text-muted" />
        פרסום ידני ב{where}
        {r.notified_at &&
          (r.notify_error ? " · לא נשלח בטלגרם, הקובץ כאן בפאנל" : " · נשלח אליכם בטלגרם")}
      </p>
    );
  }
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
      <Network name="אינסטגרם" asked={r.instagram} postedAt={r.ig_posted_at} error={r.ig_error} />
      <Network name="פייסבוק" asked={r.facebook} postedAt={r.fb_posted_at} error={r.fb_error} />
    </p>
  );
}

export function KindBadge({ r }: { r: Reel }) {
  const kind = kindOf(r);
  const count = filesOf(r).length;
  return (
    <span className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs font-bold text-ink">
      {KIND_LABEL[kind]}
      {kind === "post" && count > 1 ? ` · ${count} תמונות` : ""}
      {r.manual ? " · ידני עם קישור" : ""}
    </span>
  );
}

export function Preview({ file, url }: { file: MetaMedia; url: string | null }) {
  if (!url) return null;
  return file.type === "video" ? (
    <video
      src={url}
      controls
      playsInline
      preload="metadata"
      className="h-44 rounded-lg border border-line bg-black"
    />
  ) : (
    // A signed storage URL: next/image's loader is for AliExpress photos.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt=""
      className="h-44 max-w-44 rounded-lg border border-line bg-surface-2 object-contain"
    />
  );
}

export const KIND_PLURAL: Record<MetaKind, string> = {
  post: "פוסטים",
  story: "סטוריז",
  reel: "רילז",
};

/** The scheduled items by Israel day, soonest first: [heading, items]. */
export function byDay(items: Reel[]): [string, Reel[]][] {
  const days = new Map<string, Reel[]>();
  for (const r of items) {
    const at = new Date(r.scheduled_at);
    const heading = reelTimeLabel(at).split(" בשעה ")[0];
    const key = `${toIsraelLocal(at).slice(0, 10)}|${heading}`;
    days.set(key, [...(days.get(key) ?? []), r]);
  }
  return [...days.entries()].map(([key, list]) => [key.split("|")[1], list]);
}

/** הכל / רילז / פוסט / סטורי with counts: links, so a filter is its own address. */
export function KindFilter({ items, current }: { items: Reel[]; current: MetaKind | null }) {
  const count = (k: MetaKind) => items.filter((r) => kindOf(r) === k).length;
  const chips: { key: MetaKind | null; label: string; n: number }[] = [
    { key: null, label: "הכל", n: items.length },
    { key: "reel", label: "רילז", n: count("reel") },
    { key: "post", label: "פוסטים", n: count("post") },
    { key: "story", label: "סטוריז", n: count("story") },
  ];
  return (
    <nav
      aria-label="סינון לפי סוג"
      className="grid w-full auto-cols-fr grid-flow-col gap-1 rounded-[10px] bg-surface-2 p-1 sm:w-auto"
    >
      {chips.map((c) => {
        const on = c.key === current;
        return (
          <Link
            key={c.label}
            href={c.key ? `/admin/meta?kind=${c.key}#upcoming` : "/admin/meta#upcoming"}
            aria-current={on ? "page" : undefined}
            scroll={false}
            className={`flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold whitespace-nowrap ${
              on ? "bg-ink text-invert-ink" : "text-muted hover:text-ink"
            }`}
          >
            {c.label}
            <span className={on ? "opacity-80" : "text-muted"}>{c.n}</span>
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * One scheduled item. On a phone a row: the media small at the side, the text beside it; from sm a
 * card with the media on top at a fixed height.
 */
export function ScheduledCard({
  r,
  previews,
}: {
  r: Reel;
  previews: { file: MetaMedia; url: string | null }[];
}) {
  const kind = kindOf(r);
  const first = previews[0];
  const time = toIsraelLocal(new Date(r.scheduled_at)).slice(11);
  const extra = kind === "post" ? filesOf(r).length - 1 : 0;
  return (
    <li className={`${card} flex overflow-hidden sm:flex-col`}>
      <div className="relative w-28 shrink-0 bg-surface-2 sm:h-56 sm:w-full">
        {first?.url &&
          (first.file.type === "video" ? (
            <video
              src={first.url}
              muted
              playsInline
              controls
              preload="metadata"
              className="size-full bg-black object-contain"
            />
          ) : (
            // A signed storage URL: next/image's loader is for AliExpress photos.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={first.url} alt="" className="size-full object-cover" />
          ))}
        <span className="absolute start-2 top-2 hidden gap-1.5 sm:flex">
          <KindBadge r={r} />
        </span>
        {extra > 0 && (
          <span className="absolute end-2 top-2 rounded-full bg-ink/80 px-2.5 py-0.5 text-xs font-bold text-invert-ink">
            +{extra}
          </span>
        )}
        <span className="absolute end-2 bottom-2 hidden rounded-lg bg-surface/95 px-2.5 py-1 text-sm font-bold text-ink shadow sm:block">
          <bdi dir="ltr">{time}</bdi>
        </span>
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-3">
        <p className="flex flex-wrap items-center gap-2 text-sm font-bold sm:hidden">
          <KindBadge r={r} />
          <bdi dir="ltr">{time}</bdi>
        </p>
        {r.caption ? (
          <p className="line-clamp-3 text-sm whitespace-pre-line text-muted">{r.caption}</p>
        ) : r.link_title ? (
          <p className="line-clamp-2 text-sm text-muted">🔗 {r.link_title}</p>
        ) : null}
        <Networks r={r} />
        {r.prepared_at && <p className="text-xs text-muted">הוכן אצל Meta, מחכה לזמן שלו.</p>}
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          {editable(r) && (
            <Link
              href={`/admin/meta?edit=${r.id}#edit`}
              className={`${btnSecondary} ${btnSm} gap-1.5`}
            >
              <Pencil aria-hidden className="size-4" />
              עריכה
            </Link>
          )}
          <form action={cancelMetaAction}>
            <input type="hidden" name="id" value={r.id} />
            <PendingButton className={`${btnSecondary} ${btnSm} gap-1.5`} busyLabel="מבטלים…">
              <Ban aria-hidden className="size-4" />
              ביטול
            </PendingButton>
          </form>
        </div>
      </div>
    </li>
  );
}
