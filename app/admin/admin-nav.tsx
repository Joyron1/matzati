"use client";

// The admin's navigation (design 9, owner request 2026-10-24). From lg: a sticky sidebar on the
// start side (the right, RTL) with every admin page in groups. Below lg: a top bar whose menu button
// opens the same list as a side sheet from the right (a native modal <dialog>: focus in and back,
// Escape, the backdrop and any link close it), and a bottom bar with the most used pages for the
// thumb plus "עוד", which opens the same sheet. Client only for the active state (usePathname). The
// current page gets aria-current="page"; a page inside a section (e.g. /admin/deals/new under
// "דילים") marks its section with aria-current="true".
import {
  BarChart3,
  Clapperboard,
  ExternalLink,
  FileSearch,
  Mail,
  Menu,
  MoreHorizontal,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Tag,
  TicketPercent,
  UserRound,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type NavLink = { href: string; label: string; icon: LucideIcon; section: readonly string[] };

const GROUPS: { title: string; links: NavLink[] }[] = [
  {
    title: "תוכן באתר",
    links: [
      { href: "/admin", label: "דילים", icon: Tag, section: ["/admin", "/admin/deals"] },
      {
        href: "/admin/coupons",
        label: "קופונים",
        icon: TicketPercent,
        section: ["/admin/coupons"],
      },
      { href: "/admin/seo", label: "עמודי SEO", icon: FileSearch, section: ["/admin/seo"] },
    ],
  },
  {
    title: "ערוצים",
    links: [
      { href: "/admin/agents", label: "טלגרם", icon: Send, section: ["/admin/agents"] },
      { href: "/admin/reels", label: "רילז", icon: Clapperboard, section: ["/admin/reels"] },
      { href: "/admin/newsletter", label: "ניוזלטר", icon: Mail, section: ["/admin/newsletter"] },
    ],
  },
  {
    title: "ביצועים",
    links: [
      { href: "/admin/revenue", label: "הכנסות", icon: Wallet, section: ["/admin/revenue"] },
      { href: "/admin/stats", label: "נתונים", icon: BarChart3, section: ["/admin/stats"] },
      { href: "/admin/searches", label: "חיפושים", icon: Search, section: ["/admin/searches"] },
    ],
  },
  {
    title: "מערכת",
    links: [
      { href: "/admin/settings", label: "הגדרות", icon: Settings, section: ["/admin/settings"] },
      { href: "/admin/account", label: "חשבון", icon: UserRound, section: ["/admin/account"] },
    ],
  },
];

const ALL = GROUPS.flatMap((g) => g.links);
/** The bottom bar's pages (the daily ones); everything is in the sheet behind "עוד". */
const THUMB = ["/admin/agents", "/admin/reels", "/admin/revenue", "/admin"].map((href) =>
  ALL.find((l) => l.href === href)!,
);

const within = (pathname: string, base: string) =>
  base === "/admin" ? pathname === base : pathname === base || pathname.startsWith(`${base}/`);

function currentOf(pathname: string, link: NavLink): "page" | true | undefined {
  if (pathname === link.href) return "page";
  return link.section.some((b) => within(pathname, b)) || undefined;
}

function NavList({ pathname }: { pathname: string }) {
  return (
    <div className="space-y-5">
      {GROUPS.map((group) => (
        <div key={group.title}>
          <p className="px-3 pb-1.5 text-xs font-bold tracking-wide text-muted">{group.title}</p>
          <ul className="space-y-0.5">
            {group.links.map((link) => {
              const current = currentOf(pathname, link);
              const Icon = link.icon;
              return (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    aria-current={current}
                    className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] font-semibold ${
                      current ? "bg-accent-soft text-accent-ink" : "text-ink hover:bg-surface-2"
                    }`}
                  >
                    <Icon
                      aria-hidden
                      className={`size-5 shrink-0 ${current ? "text-accent" : "text-muted"}`}
                    />
                    {link.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function Brand() {
  return (
    <Link href="/admin" className="flex min-h-11 items-center gap-2 font-bold text-ink">
      <span className="grid size-8 place-items-center rounded-lg bg-gradient-to-l from-cta-from to-cta-to text-white">
        <ShieldCheck aria-hidden className="size-[18px]" />
      </span>
      ניהול האתר
    </Link>
  );
}

const toSite = (
  <Link
    href="/"
    className="flex min-h-11 items-center gap-2 rounded-lg px-3 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-ink"
  >
    <ExternalLink aria-hidden className="size-4" />
    לאתר
  </Link>
);

/**
 * The admin frame: sidebar from lg, top bar, sheet and bottom bar below lg. `account` (the signed-in
 * address and the sign-out form, rendered on the server) sits at the end of the sidebar and the sheet.
 */
export function AdminShell({
  account,
  children,
  previewPath,
}: {
  account: ReactNode;
  children: ReactNode;
  /** The dev preview's stand-in for the address (it is served under /dev). */
  previewPath?: string;
}) {
  const realPath = usePathname() ?? "";
  const pathname = previewPath ?? realPath;
  const sheet = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const sheetId = useId();
  const here = ALL.find((l) => currentOf(pathname, l));

  useEffect(() => {
    if (sheet.current?.open) sheet.current.close();
  }, [realPath]);

  const openSheet = () => {
    sheet.current?.showModal();
    setOpen(true);
  };
  const sheetButton = {
    "aria-haspopup": "dialog" as const,
    "aria-expanded": open,
    "aria-controls": sheetId,
    onClick: openSheet,
  };
  const thumbHere = THUMB.some((l) => currentOf(pathname, l));

  return (
    <div data-admin-shell className="min-h-dvh bg-surface-2/60 lg:flex">
      {/* Sidebar (lg+) */}
      <aside className="hidden w-64 shrink-0 border-e border-line bg-surface lg:block">
        <div className="sticky top-0 flex h-dvh flex-col gap-4 overflow-y-auto p-4">
          <Brand />
          <nav aria-label="ניווט בניהול" className="flex-1">
            <NavList pathname={pathname} />
          </nav>
          <div className="space-y-2 border-t border-line pt-3">
            {toSite}
            {account}
          </div>
        </div>
      </aside>

      {/* Top bar (below lg) */}
      <div className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-surface ps-1 pe-3 lg:hidden">
        <button
          type="button"
          aria-label="תפריט הניהול"
          {...sheetButton}
          className="grid size-11 place-items-center rounded-lg text-ink hover:bg-surface-2"
        >
          <Menu aria-hidden className="size-6" />
        </button>
        <p className="min-w-0 flex-1 truncate font-bold text-ink">
          <span className="text-muted">ניהול</span>
          {here && (
            <span aria-hidden className="text-muted">
              {" "}
              ·{" "}
            </span>
          )}
          {here?.label}
        </p>
        <Link
          href="/"
          aria-label="לאתר"
          className="grid size-11 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
        >
          <ExternalLink aria-hidden className="size-5" />
        </Link>
      </div>

      <div className="min-w-0 flex-1 pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-12">
        {children}
      </div>

      {/* Bottom bar (below lg) */}
      <nav
        aria-label="ניווט מהיר בניהול"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(0,0,0,0.04)] lg:hidden"
      >
        <ul className="grid h-16 grid-cols-5">
          {THUMB.map((link) => {
            const current = currentOf(pathname, link);
            const Icon = link.icon;
            return (
              <li key={link.href}>
                <Link
                  href={link.href}
                  aria-current={current}
                  className={`flex h-full flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
                    current ? "text-accent" : "text-muted hover:text-ink"
                  }`}
                >
                  <Icon aria-hidden className="size-[22px]" strokeWidth={current ? 2.4 : 2} />
                  {link.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              {...sheetButton}
              className={`flex h-full w-full flex-col items-center justify-center gap-1 text-[11px] font-semibold ${
                !thumbHere && here ? "text-accent" : "text-muted hover:text-ink"
              }`}
            >
              <MoreHorizontal aria-hidden className="size-[22px]" />
              עוד
            </button>
          </li>
        </ul>
      </nav>

      {/* The sheet (below lg) */}
      <dialog
        ref={sheet}
        id={sheetId}
        aria-label="תפריט הניהול"
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) sheet.current?.close();
          else if ((e.target as Element).closest("a")) sheet.current?.close();
        }}
        className="mobile-menu fixed inset-y-0 start-0 end-auto m-0 h-dvh max-h-none w-[min(20rem,86vw)] max-w-none overflow-hidden bg-surface p-0 text-ink shadow-soft backdrop:bg-ink/45 lg:hidden"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-line ps-3 pe-1">
            <Brand />
            <button
              type="button"
              aria-label="סגירת התפריט"
              onClick={() => sheet.current?.close()}
              className="grid size-11 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink"
            >
              <X aria-hidden className="size-6" />
            </button>
          </div>
          <nav
            aria-label="כל עמודי הניהול"
            className="flex-1 overflow-y-auto overscroll-contain p-3"
          >
            <NavList pathname={pathname} />
          </nav>
          <div className="space-y-2 border-t border-line p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            {toSite}
            {account}
          </div>
        </div>
      </dialog>
    </div>
  );
}
