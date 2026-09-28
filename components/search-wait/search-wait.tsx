"use client";

import {
  Check,
  ChevronLeft,
  Clock,
  LayoutGrid,
  Lightbulb,
  ListFilter,
  ListOrdered,
  MessageSquareText,
  PackageSearch,
  type LucideIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useState,
  type CSSProperties,
  type FocusEvent,
} from "react";
import { SearchComposer } from "@/components/search-composer";
import { card } from "@/components/styles";
import {
  LAST_STEP,
  PROGRESS_CAP,
  PROGRESS_EASE,
  PROGRESS_EASE_MS,
  REASSURANCE_TEXT,
  SCHEDULE_MARKS_MS,
  UNDERSTOOD_STEPS,
  WAIT_STEPS,
  echoQuery,
  nextTip,
  reassuranceAt,
  startOffsetMs,
  stepAt,
  stepProgress,
  stepState,
  tipDurationMs,
  understoodOffsetMs,
  type Reassurance,
  type StepState,
  type WaitStep,
  type WaitStepId,
} from "./schedule";
import styles from "./search-wait.module.css";
import { WAIT_TIPS } from "./tips";
import { WaitScene } from "./wait-scene";

// The /search waiting screen: the query, a motion scene with a "now" line under it on phones, the
// steps of the search on a schedule (see ./schedule.ts for why a schedule and what it may claim),
// a progress bar that never completes on its own, and tips. The results page streams (item 15), so
// there are two waits per search, both Suspense fallbacks of app/search/page.tsx: one until the
// query is understood, with room kept for the chips, and one under the chips until the products
// show, which marks understanding as done and goes on where the first one was (handover).

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

const STEP_ICONS: Record<WaitStepId, LucideIcon> = {
  read: MessageSquareText,
  scan: PackageSearch,
  filter: ListFilter,
  rank: ListOrdered,
  prepare: LayoutGrid,
};

/**
 * The wait of one search on screen: when it started and which tip it shows, so the wait under the
 * chips goes on from there instead of starting over. One search at a time; a wait under the chips
 * takes it over only right after the one before it left (HANDOVER_MS), never from an older search.
 */
interface Handover {
  key: string;
  startedAt: number;
  tip: number;
  endedAt: number | null;
}
let handover: Handover | null = null;
const HANDOVER_MS = 1_500;

/** Where the wait before the chips had got to, and its tip; null when there was none just now. */
function takeHandover(key: string): { elapsed: number; tip: number } | null {
  const before = handover;
  handover = null;
  if (!before || before.key !== key || before.endedAt === null) return null;
  const now = Date.now();
  if (now - before.endedAt > HANDOVER_MS) return null;
  return { elapsed: now - before.startedAt, tip: before.tip };
}

/** Each step's detail, then why it takes long, then that we are still on it. */
const CAPTIONS = [
  ...WAIT_STEPS.map((s) => s.detail),
  REASSURANCE_TEXT.slow,
  REASSURANCE_TEXT.slower,
];

/** The caption for a moment of the wait; it only moves forward, like the schedule. */
function captionAt(step: number, reassurance: Reassurance): number {
  if (reassurance === "slower") return CAPTIONS.length - 1;
  if (reassurance === "slow") return CAPTIONS.length - 2;
  return step;
}

/** Ticker state of text `index` when `current` is shown (see .ticker in the CSS module). */
function tickerClass(index: number, current: number, previous = current - 1): string {
  if (index === current) return cx(styles.ticker, styles.tickerOn);
  return index === previous ? cx(styles.ticker, styles.tickerPast) : styles.ticker;
}

/**
 * Milliseconds into the wait (from `offsetMs`), updated only at the moments the schedule changes
 * something on screen (SCHEDULE_MARKS_MS); the bar and the scene move in CSS between them. The
 * offset only grows (a handover), so the time is the later of it and the last mark reached.
 */
function useScheduleTime(offsetMs: number): number {
  const [mark, setMark] = useState(0);
  useEffect(() => {
    const timers = SCHEDULE_MARKS_MS.filter((t) => t > offsetMs).map((t) =>
      window.setTimeout(() => setMark(t), t - offsetMs),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [offsetMs]);
  return Math.max(offsetMs, mark);
}

/** The search bar with the query from the URL, for app/search/loading.tsx. */
export function SearchBarFromUrl() {
  const params = useSearchParams();
  return <SearchComposer variant="bar" defaultValue={echoQuery(params.get("q"))} />;
}

interface SearchWaitScreenProps {
  query: string;
  /** Development preview: the bar looks the same but cannot start a search. */
  demo?: boolean;
}

/** The search bar exactly as the results page renders it, then the wait (the dev preview). */
export function SearchWaitScreen({ query, demo = false }: SearchWaitScreenProps) {
  const bar = <SearchComposer variant="bar" defaultValue={query} />;
  return (
    <>
      {demo ? <div inert>{bar}</div> : bar}
      <SearchWait query={query} />
    </>
  );
}

export function SearchWait({
  query,
  reusesParse = false,
  understood = false,
  continues = false,
  waitKey = "",
}: {
  query: string;
  /** A removed chip or a sort change: the cached parse is reused (see startOffsetMs). */
  reusesParse?: boolean;
  /**
   * The query is understood and its chips show above: the wait under them, which marks that step
   * done (UNDERSTOOD_STEPS) and takes over from the wait before it.
   */
  understood?: boolean;
  /** The wait before the chips was on screen: this one goes on without its entrance. */
  continues?: boolean;
  /** Ties the two waits of one search (the page's search URL). */
  waitKey?: string;
}) {
  const base = understood ? understoodOffsetMs(null) : startOffsetMs(reusesParse);
  const [offsetMs, setOffsetMs] = useState(base);
  const [firstTip, setFirstTip] = useState(0);
  const elapsed = useScheduleTime(offsetMs);
  const step = stepAt(elapsed);
  const reassurance = reassuranceAt(elapsed);
  const caption = captionAt(step, reassurance);
  const [paused, setPaused] = useState(false);
  const headingId = useId();
  const Heading = understood ? "h2" : "h1";
  // The tip shown, for the wait under the chips to go on from (the wait before them only).
  const recordTip = useCallback(
    (tip: number) => {
      if (!understood && handover?.key === waitKey) handover.tip = tip;
    },
    [understood, waitKey],
  );

  // The wait before the chips hands over its start and tip; the wait under them takes them, one
  // turn after it shows (the server rendered it from `base`, so the first render must match).
  useEffect(() => {
    if (!understood) {
      const entry: Handover = { key: waitKey, startedAt: Date.now() - base, tip: 0, endedAt: null };
      handover = entry;
      return () => {
        entry.endedAt = Date.now();
      };
    }
    const before = takeHandover(waitKey);
    if (!before) return;
    const timer = window.setTimeout(() => {
      setOffsetMs(understoodOffsetMs(before.elapsed));
      setFirstTip(before.tip);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [understood, waitKey, base]);

  return (
    <section
      aria-labelledby={headingId}
      // Tall enough that the footer starts below the fold, so it does not jump with the results.
      className={cx(!continues && styles.enter, paused && styles.paused, "min-h-dvh")}
    >
      {!understood && <ChipsPlaceholder />}
      <div className="space-y-5">
        <Heading id={headingId}>
          <span className="flex items-center gap-2.5 text-[15px] font-semibold text-accent-ink">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full bg-accent" />
            מחפשים בשבילכם
            {query && <span className="sr-only">:</span>}
          </span>
          {/* The bar right above holds the whole query; on phones one line keeps the scene up. */}
          {query && (
            <span className="mt-1 line-clamp-1 font-display text-xl leading-snug text-balance text-ink [overflow-wrap:anywhere] sm:mt-1.5 sm:line-clamp-2 sm:text-[2rem]">
              <bdi>{query}</bdi>
            </span>
          )}
        </Heading>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
          <div className="overflow-hidden rounded-card border border-line bg-surface motion-reduce:hidden lg:col-start-1 lg:row-start-1">
            <WaitScene stage={step} paused={paused} onPausedChange={setPaused} />
            <NowLine step={step} caption={caption} />
          </div>
          <Steps
            step={step}
            done={understood ? UNDERSTOOD_STEPS : 0}
            caption={caption}
            reassurance={reassurance}
            offsetMs={offsetMs}
            headingLevel={understood ? "h3" : "h2"}
            className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-stretch motion-reduce:lg:row-span-1"
          />
          <Tips
            key={firstTip}
            firstTip={firstTip}
            onTip={recordTip}
            paused={paused}
            headingLevel={understood ? "h3" : "h2"}
            className="lg:col-start-1 lg:row-start-2 motion-reduce:lg:row-start-1"
          />
        </div>
      </div>
    </section>
  );
}

/**
 * Where the chips show once the query is understood ("הבנתי ככה"), laid out as they usually wrap,
 * so the wait does not move down when they arrive above it: on phones the chips rarely fit beside
 * the label and start a row of their own (components/filter-chips.tsx), from sm they share its
 * row. Nothing to read: hidden from assistive tech, which the steps tell what is happening.
 */
function ChipsPlaceholder() {
  return (
    <div aria-hidden className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="w-full text-sm font-semibold text-muted sm:w-auto">הבנתי ככה:</span>
      <span className="flex gap-2">
        {["w-24", "w-20", "w-16"].map((width) => (
          <span
            key={width}
            className={`h-11 ${width} rounded-full bg-surface-2 motion-safe:animate-pulse`}
          />
        ))}
      </span>
    </div>
  );
}

function CaptionText({ index }: { index: number }) {
  return (
    <>
      {index >= WAIT_STEPS.length && (
        <Clock aria-hidden className="me-1.5 inline size-4 align-[-3px]" />
      )}
      {CAPTIONS[index]}
    </>
  );
}

/**
 * Phones and tablets: what is happening now, right under the scene like a video caption (the step
 * list is below the fold there). Hidden from assistive tech: the step list's status says it.
 */
function NowLine({ step, caption }: { step: number; caption: number }) {
  return (
    <div aria-hidden className="border-t border-line px-4 py-3 lg:hidden">
      <div className="grid">
        {WAIT_STEPS.map((s, i) => {
          const Icon = STEP_ICONS[s.id];
          return (
            <p
              key={s.id}
              className={cx(
                tickerClass(i, step),
                "col-start-1 row-start-1 flex gap-2 text-base leading-snug font-semibold text-accent-ink",
              )}
            >
              <Icon className="mt-0.5 size-[18px] shrink-0" />
              {s.label}
            </p>
          );
        })}
      </div>
      <div className="mt-1 grid ps-[26px]">
        {CAPTIONS.map((_, i) => (
          <p
            key={i}
            className={cx(
              tickerClass(i, caption),
              "col-start-1 row-start-1 text-sm leading-relaxed text-muted",
            )}
          >
            <CaptionText index={i} />
          </p>
        ))}
      </div>
    </div>
  );
}

function Steps({
  step,
  done,
  caption,
  reassurance,
  offsetMs,
  className,
  headingLevel,
}: {
  step: number;
  /** Steps known to be done (stepState). */
  done: number;
  caption: number;
  reassurance: Reassurance;
  offsetMs: number;
  className: string;
  headingLevel: "h2" | "h3";
}) {
  const Heading = headingLevel;
  // The one live region: the current step, and why it takes long once it does.
  const status =
    reassurance === "none"
      ? WAIT_STEPS[step].label
      : `${WAIT_STEPS[step].label}. ${REASSURANCE_TEXT[reassurance]}`;
  // One CSS animation to the cap (the bar's width), started where the wait starts; under reduced
  // motion a fixed width per step (--p-step, a share of the capped bar).
  const bar = {
    width: `${PROGRESS_CAP * 100}%`,
    animationDuration: `${PROGRESS_EASE_MS}ms`,
    animationTimingFunction: `cubic-bezier(${PROGRESS_EASE.join(", ")})`,
    animationDelay: `${-offsetMs}ms`,
    "--p-step": stepProgress(step) / PROGRESS_CAP,
  } as CSSProperties;

  return (
    <div className={cx(card, "flex flex-col p-5 sm:p-6", className)}>
      <Heading className="font-bold">מה קורה עכשיו</Heading>
      <div aria-hidden className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className={styles.bar} style={bar} />
      </div>
      <ol className="mt-5">
        {WAIT_STEPS.map((s, i) => (
          <StepRow key={s.id} step={s} state={stepState(i, step, done)} last={i === LAST_STEP} />
        ))}
      </ol>
      {/* Beside the scene on desktop (under it, the now line says this) and under reduced motion. */}
      <div className="mt-auto hidden pt-4 lg:block motion-reduce:block">
        {/* Every caption stacked in one cell: the box keeps the height of the longest. */}
        <div className="grid rounded-2xl bg-accent-soft px-4 py-3 text-sm leading-relaxed text-accent-ink">
          {CAPTIONS.map((_, i) => (
            <p
              key={i}
              aria-hidden={i !== caption}
              className={cx(tickerClass(i, caption), "col-start-1 row-start-1")}
            >
              <CaptionText index={i} />
            </p>
          ))}
        </div>
      </div>
      <p role="status" className="sr-only">
        {status}
      </p>
    </div>
  );
}

function StepRow({ step, state, last }: { step: WaitStep; state: StepState; last: boolean }) {
  // A check only for a step the page knows is done (the chips show); a step the schedule moved
  // past fills in without one: we cannot know it is done.
  const Icon = state === "done" ? Check : STEP_ICONS[step.id];
  const filled = state === "done" || state === "past";
  return (
    <li className="flex gap-3" aria-current={state === "current" ? "step" : undefined}>
      <div className="flex flex-col items-center">
        <span
          className={cx(
            "relative grid size-9 shrink-0 place-items-center rounded-full",
            filled && "bg-accent text-on-accent",
            state === "current" && "bg-accent-soft text-accent-ink",
            state === "upcoming" && "border border-line bg-surface text-muted",
          )}
        >
          <Icon aria-hidden className="size-[18px]" />
          {state === "current" && (
            <span
              aria-hidden
              // A slowly turning arc; a still, full ring under reduced motion.
              className="absolute -inset-1 animate-spin rounded-full border-2 border-accent border-s-transparent border-b-transparent [animation-duration:2.4s] motion-reduce:animate-none motion-reduce:border-s-accent motion-reduce:border-b-accent"
            />
          )}
        </span>
        {!last && (
          <span
            aria-hidden
            className={cx(
              "my-1 min-h-2 w-0.5 flex-1 rounded-full",
              filled ? "bg-accent" : "bg-line",
            )}
          />
        )}
      </div>
      <p
        className={cx(
          "min-h-9 pt-[7px] text-[15px] leading-snug font-semibold",
          !last && "pb-3",
          filled && "text-ink",
          state === "current" && "text-accent-ink",
          state === "upcoming" && "text-muted",
        )}
      >
        {step.label}
        <span className="sr-only">{STEP_STATE_TEXT[state]}</span>
      </p>
    </li>
  );
}

/** How a screen reader hears each step's state, after its label. */
const STEP_STATE_TEXT: Record<StepState, string> = {
  done: " (הושלם)",
  past: " (שלב קודם)",
  current: " (עכשיו)",
  upcoming: "",
};

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Tips({
  firstTip,
  onTip,
  paused,
  className,
  headingLevel,
}: {
  /** The tip to start from (the wait before the chips handed it over). */
  firstTip: number;
  /** Told about every tip shown, so a handover can go on from it. */
  onTip: (tip: number) => void;
  paused: boolean;
  className: string;
  headingLevel: "h2" | "h3";
}) {
  const [tip, setTip] = useState(firstTip);
  // A tip the "הטיפ הבא" button brought is read out; tips that turn on their own are not, so the
  // wait never talks over the step announcements.
  const [announced, setAnnounced] = useState("");
  // Hovering or focusing the card holds the tip, so it can be read to the end.
  const [hold, setHold] = useState(false);
  const titleId = useId();
  const Heading = headingLevel;

  useEffect(() => onTip(tip), [tip, onTip]);

  // Each tip stays long enough to read. Under reduced motion nothing turns on its own (there is
  // no scene, so no pause button); "הטיפ הבא" still does.
  useEffect(() => {
    if (paused || hold || prefersReducedMotion()) return;
    const timer = window.setTimeout(
      () => setTip((i) => nextTip(i, WAIT_TIPS.length)),
      tipDurationMs(WAIT_TIPS[tip]),
    );
    return () => window.clearTimeout(timer);
  }, [tip, paused, hold]);

  function onBlur(e: FocusEvent<HTMLElement>) {
    if (!e.currentTarget.contains(e.relatedTarget)) setHold(false);
  }

  const previous = (tip - 1 + WAIT_TIPS.length) % WAIT_TIPS.length;

  return (
    <section
      aria-labelledby={titleId}
      onPointerEnter={() => setHold(true)}
      onPointerLeave={() => setHold(false)}
      onFocus={() => setHold(true)}
      onBlur={onBlur}
      className={cx(card, "p-4 sm:p-5", className)}
    >
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-gold-soft text-ink">
          <Lightbulb aria-hidden className="size-[18px]" />
        </span>
        <Heading id={titleId} className="font-bold">
          ידעתם?
        </Heading>
        <span aria-hidden className="ms-auto flex gap-1.5">
          {WAIT_TIPS.map((_, i) => (
            <span
              key={i}
              className={cx("size-1.5 rounded-full", i === tip ? "bg-accent" : "bg-line")}
            />
          ))}
        </span>
        <button
          type="button"
          onClick={() => {
            const next = nextTip(tip, WAIT_TIPS.length);
            setTip(next);
            setAnnounced(WAIT_TIPS[next]);
          }}
          aria-label="הטיפ הבא"
          className="-me-2 grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
        >
          <ChevronLeft aria-hidden className="size-5" />
        </button>
      </div>
      <p role="status" className="sr-only">
        {announced}
      </p>
      <div className="mt-1 grid [--ticker-y:4px]">
        {WAIT_TIPS.map((text, i) => (
          <p
            key={i}
            aria-hidden={i !== tip}
            className={cx(
              tickerClass(i, tip, previous),
              "col-start-1 row-start-1 text-[15px] leading-relaxed text-ink",
            )}
          >
            {text}
          </p>
        ))}
      </div>
    </section>
  );
}
