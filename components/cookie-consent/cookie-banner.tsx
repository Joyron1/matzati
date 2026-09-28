"use client";

import Link from "next/link";
import { Cookie } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { btnPrimary, btnSecondary } from "@/components/styles";
import { LEGAL_PATHS } from "@/lib/config/legal";
import { ACCEPT_ALL, NECESSARY_ONLY, type ConsentChoice } from "@/lib/consent/consent";
import styles from "./cookie-consent.module.css";

/** Read by app/globals.css: scroll padding and page padding while the banner is up. */
const BANNER_SPACE_VAR = "--consent-banner-h";

const button = "min-h-11 grow px-2.5 text-sm sm:grow-0 sm:px-4";

/**
 * The first-visit cookie notice: fixed at the bottom, not modal (the page stays usable and
 * nothing traps focus). It comes last in the DOM, after the footer, so Tab reaches it at the end
 * of the page. At most 35% of the screen on phones, well clear of the search composer at the top
 * of the home page: the text is short and the three buttons share one row from 320px (below
 * 370px the first one shows "הכרחיות בלבד", its full name staying in the accessible name), so it
 * fits without scrolling inside. On a phone on its side the text and the buttons sit side by
 * side (cookie-consent.module.css). From sm the fixed box itself is the centered card, so no
 * invisible strip beside it catches clicks meant for the page.
 */
export function CookieBanner({
  onChoose,
  onOpenSettings,
}: {
  onChoose(choice: ConsentChoice): void;
  onOpenSettings(): void;
}) {
  const titleId = useId();
  const ref = useRef<HTMLDivElement>(null);

  // Reserve the banner's space on the page (app/globals.css): the end of the page scrolls above
  // it and an element that gets focus is scrolled clear of it.
  useEffect(() => {
    const banner = ref.current;
    if (!banner) return;
    const root = document.documentElement;
    const update = () => {
      // Its height plus its gap from the bottom edge (from sm); offsetHeight ignores the entrance
      // transform.
      const bottom = Number.parseFloat(getComputedStyle(banner).bottom) || 0;
      root.style.setProperty(BANNER_SPACE_VAR, `${Math.ceil(banner.offsetHeight + bottom)}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(banner);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      root.style.removeProperty(BANNER_SPACE_VAR);
    };
  }, []);

  return (
    <div
      ref={ref}
      role="region"
      aria-labelledby={titleId}
      className={`fixed inset-x-0 bottom-0 z-40 print:hidden sm:inset-x-4 sm:bottom-4 sm:mx-auto sm:max-w-3xl ${styles.bannerIn} ${styles.banner}`}
    >
      <div
        className={`max-h-[35dvh] overflow-y-auto border-t border-line bg-surface px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-soft sm:max-h-[50dvh] sm:rounded-card sm:border sm:p-5 ${styles.card}`}
      >
        <div className={styles.text}>
          <h2 id={titleId} className="flex items-center gap-2 text-[15px] font-bold">
            <Cookie aria-hidden className="size-[18px] shrink-0 text-accent-ink" strokeWidth={2} />
            עוגיות באתר
          </h2>
          {/* What is stored, item by item: /cookies (STORAGE_INVENTORY). */}
          <p className="mt-1 text-sm leading-relaxed text-muted">
            אנחנו שומרים בדפדפן רק את מה שהכרחי לאתר. עוגיות סטטיסטיקה ושיווק לא בשימוש, ונפעיל אותן
            רק אם תאשרו.{" "}
            <Link
              href={LEGAL_PATHS.cookies}
              className="font-medium whitespace-nowrap text-accent-ink underline underline-offset-4 hover:no-underline"
            >
              מדיניות העוגיות
            </Link>
          </p>
        </div>
        {/* The two choices look the same: neither is pushed. */}
        <div className={`mt-3 flex flex-wrap gap-2 ${styles.actions}`}>
          <button
            type="button"
            onClick={() => onChoose(NECESSARY_ONLY)}
            className={`${btnPrimary} ${button}`}
          >
            <span>
              <span className="max-[370px]:sr-only">אישור </span>הכרחיות בלבד
            </span>
          </button>
          <button
            type="button"
            onClick={() => onChoose(ACCEPT_ALL)}
            className={`${btnPrimary} ${button}`}
          >
            אישור הכול
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            aria-haspopup="dialog"
            className={`${btnSecondary} ${button}`}
          >
            הגדרות
          </button>
        </div>
      </div>
    </div>
  );
}
