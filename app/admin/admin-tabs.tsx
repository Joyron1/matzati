// Tabs of an admin page (owner request 2026-10-24: the settings and Telegram pages were one long
// scroll). Plain links to ?tab=… rendered on the server, so each tab is its own address (a save
// that redirects with ?tab= comes back to it) and they work without JavaScript. The current tab
// has aria-current="page". Equal columns; on a phone the icon sits above the label.
import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export interface AdminTab {
  key: string;
  label: string;
  icon?: LucideIcon;
  /** A number after the label (e.g. items waiting). */
  count?: number;
  /** A small dot: on (green), off (gray), or none. */
  dot?: "on" | "off";
}

export function AdminTabs({
  tabs,
  current,
  base,
  label,
}: {
  tabs: AdminTab[];
  current: string;
  /** The page's path; a tab's address is base?tab=key (the first tab: base alone). */
  base: string;
  label: string;
}) {
  return (
    <nav aria-label={label} className="relative">
      <ul className="grid auto-cols-fr grid-flow-col gap-1 rounded-[10px] bg-surface-2 p-1">
        {tabs.map((t, i) => {
          const on = t.key === current;
          const Icon = t.icon;
          return (
            <li key={t.key} className="min-w-0">
              <Link
                href={i === 0 ? base : `${base}?tab=${t.key}`}
                aria-current={on ? "page" : undefined}
                scroll={false}
                className={`relative flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-lg px-1 text-xs whitespace-nowrap sm:min-h-11 sm:flex-row sm:gap-2 sm:px-4 sm:text-sm ${
                  on
                    ? "bg-surface font-bold text-accent-ink shadow-[0_1px_3px_rgba(0,0,0,0.1)]"
                    : "font-semibold text-muted hover:text-ink"
                }`}
              >
                {Icon && <Icon aria-hidden className="size-[18px] shrink-0" />}
                <span className="flex items-center gap-1 sm:gap-2">
                  {t.label}
                  {t.count !== undefined && (
                    <span
                      className={`grid min-w-5 place-items-center rounded-full px-1 text-[11px] leading-5 font-bold sm:min-w-6 sm:px-1.5 sm:text-xs sm:leading-6 ${
                        on ? "bg-accent text-on-accent" : "bg-line text-ink"
                      }`}
                    >
                      {t.count}
                    </span>
                  )}
                  {t.dot && (
                    <>
                      <span
                        aria-hidden
                        className={`size-2 shrink-0 rounded-full ${t.dot === "on" ? "bg-trust" : "bg-muted/50"}`}
                      />
                      <span className="sr-only">{t.dot === "on" ? "(פעיל)" : "(כבוי)"}</span>
                    </>
                  )}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** A page's title row: the heading, a short line under it, and actions at the end. */
export function AdminHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-1">
        <h1 className="text-3xl font-bold sm:text-4xl">{title}</h1>
        {subtitle && <p className="max-w-prose text-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
