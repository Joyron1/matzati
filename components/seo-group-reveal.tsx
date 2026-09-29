"use client";

import { Plus } from "lucide-react";
import {
  Children,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { placesLabel } from "@/lib/seo/places";
import { btnLg, btnSecondary } from "./styles";

const subscribeNever = () => () => {};

/** How near the viewport's bottom the button's row counts as reached. */
const REACH_PX = 160;

/** True once hydrated in a browser; false in the server HTML and during hydration. */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribeNever,
    () => true,
    () => false,
  );
}

interface GroupRevealProps {
  /** One child per group, in order: every one is in the server HTML. */
  children: ReactNode;
  /** Products per group, in the same order. */
  counts: number[];
}

/**
 * The SEO landing page's groups of five (lib/seo/results.ts), shown one more at a time: every
 * group is rendered on the server, so crawlers and visitors without JS get them all; once the page
 * is hydrated, only the first shows, and the next one appears each time the visitor reaches the
 * bottom of the list (an IntersectionObserver on the button's row) or presses "עוד 5 מוצרים",
 * which also works where the observer does not. Focus stays where it is (the new cards appear
 * above the button), a polite status says how many were added, and once every group shows the
 * button leaves and the footer is right after the list.
 */
export function GroupReveal({ children, counts }: GroupRevealProps) {
  const groups = Children.toArray(children);
  const hydrated = useHydrated();
  const [visible, setVisible] = useState(1);
  const [announcement, setAnnouncement] = useState("");
  const sentinel = useRef<HTMLDivElement>(null);
  const wrappers = useRef<(HTMLDivElement | null)[]>([]);
  // The last group opened by the button: the button leaves, so focus moves to that group.
  const [focusGroup, setFocusGroup] = useState<number | null>(null);

  const shown = hydrated ? Math.min(visible, groups.length) : groups.length;
  const more = hydrated && shown < groups.length;
  const next = counts[shown] ?? 0;
  const shownProducts = counts.slice(0, shown).reduce((a, b) => a + b, 0);
  const total = counts.reduce((a, b) => a + b, 0);

  function reveal(fromButton = false) {
    if (shown >= groups.length) return;
    const first = shownProducts + 1;
    setVisible(shown + 1);
    if (fromButton && shown + 1 === groups.length) setFocusGroup(shown);
    setAnnouncement(
      `נוספו ${next === 1 ? "מוצר אחד" : `${next} מוצרים`}, ${placesLabel(first, next)}.`,
    );
  }

  const onVisible = useEffectEvent(() => reveal());

  useEffect(() => {
    if (focusGroup !== null) wrappers.current[focusGroup]?.focus();
  }, [focusGroup]);

  // While groups are left: one more group each time the visitor arrives at the bottom of the list
  // (the button's row within REACH_PX of the viewport's bottom, or scrolled past it at once with
  // End or a fling), not one per scroll event. The observer tells when the row comes near; the
  // scroll listener catches a jump past it, which an observer does not report.
  useEffect(() => {
    const el = sentinel.current;
    if (!more || !el) return;
    const near = () => el.getBoundingClientRect().top < window.innerHeight + REACH_PX;
    // Where the row is now (on load, or right after a group appeared above it) is no arrival:
    // only a scroll that brings it near is, so groups never open one after another on their own.
    let reached = near();
    const measure = () => {
      const now = near();
      if (now && !reached) onVisible();
      reached = now;
    };
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const observer =
      typeof IntersectionObserver === "undefined"
        ? null
        : new IntersectionObserver(measure, { rootMargin: `0px 0px ${REACH_PX}px 0px` });
    observer?.observe(el);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
    };
  }, [more, shown]);

  return (
    <div className="space-y-10">
      {groups.map((group, i) => (
        <div
          key={i}
          ref={(el) => {
            wrappers.current[i] = el;
          }}
          hidden={i >= shown}
          tabIndex={focusGroup === i ? -1 : undefined}
          className="rounded-card outline-offset-4"
        >
          {group}
        </div>
      ))}
      <div ref={sentinel} className="flex flex-col items-center gap-2">
        {more && (
          <>
            <button
              type="button"
              onClick={() => reveal(true)}
              className={`${btnSecondary} ${btnLg} w-full sm:w-auto`}
            >
              <Plus aria-hidden className="size-5" />
              {next === 1 ? "עוד מוצר אחד" : `עוד ${next} מוצרים`}
            </button>
            <p className="text-sm text-muted">
              מוצגים <bdi dir="ltr">{shownProducts}</bdi> מתוך <bdi dir="ltr">{total}</bdi>.
            </p>
          </>
        )}
        <p role="status" className="sr-only">
          {announcement}
        </p>
      </div>
    </div>
  );
}
