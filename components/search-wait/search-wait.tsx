"use client";

import {
  ChevronLeft,
  Clock,
  LayoutGrid,
  Lightbulb,
  ListFilter,
  MessageSquareText,
  PackageSearch,
  PenLine,
  type LucideIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useId, useState, type CSSProperties, type FocusEvent } from "react";
import { SearchComposer } from "@/components/search-composer";
import { card } from "@/components/styles";
import {
  LAST_STEP,
  PROGRESS_CAP,
  PROGRESS_EASE,
  PROGRESS_EASE_MS,
  REASSURANCE_TEXT,
  SCHEDULE_MARKS_MS,
  WAIT_STEPS,
  echoQuery,
  nextTip,
  reassuranceAt,
  startOffsetMs,
  stepAt,
  stepProgress,
  stepState,
  tipDurationMs,
  type Reassurance,
  type StepState,
  type WaitStep,
  type WaitStepId,
} from "./schedule";
import styles from "./search-wait.module.css";
import { WAIT_TIPS } from "./tips";
import { WaitScene } from "./wait-scene";

// The /search waiting screen (the Suspense fallback of app/search/page.tsx, one per search): the
// query, a motion scene with a "now" line under it on phones, the steps of the search on a
// schedule (see ./schedule.ts for why a schedule and what it may claim), a progress bar that never
// completes on its own, and tips. The results replace everything under the search bar in one go.

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

const STEP_ICONS: Record<WaitStepId, LucideIcon> = {
  read: MessageSquareText,
  scan: PackageSearch,
  filter: ListFilter,
  explain: PenLine,
  prepare: LayoutGrid,
};

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
 * Milliseconds into the wait (plus `offsetMs`), updated only at the moments the schedule changes
 * something on screen (SCHEDULE_MARKS_MS); the bar and the scene move in CSS between them.
 */
function useScheduleTime(offsetMs: number): number {
  const [elapsed, setElapsed] = useState(offsetMs);
  useEffect(() => {
    const timers = SCHEDULE_MARKS_MS.filter((t) => t > offsetMs).map((t) =>
      window.setTimeout(() => setElapsed(t), t - offsetMs),
    );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [offsetMs]);
  return elapsed;
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
}: {
  query: string;
  /** A removed chip or a sort change: the cached parse is reused (see startOffsetMs). */
  reusesParse?: boolean;
}) {
  const offsetMs = startOffsetMs(reusesParse);
  const elapsed = useScheduleTime(offsetMs);
  const step = stepAt(elapsed);
  const reassurance = reassuranceAt(elapsed);
  const caption = captionAt(step, reassurance);
  const [paused, setPaused] = useState(false);
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      // Tall enough that the footer starts below the fold, so it does not jump with the results.
      className={cx(styles.enter, paused && styles.paused, "min-h-dvh space-y-5")}
    >
      <h1 id={headingId}>
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
      </h1>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-start">
        <div className="overflow-hidden rounded-card border border-line bg-surface motion-reduce:hidden lg:col-start-1 lg:row-start-1">
          <WaitScene stage={step} paused={paused} onPausedChange={setPaused} />
          <NowLine step={step} caption={caption} />
        </div>
        <Steps
          step={step}
          caption={caption}
          reassurance={reassurance}
          offsetMs={offsetMs}
          className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-stretch motion-reduce:lg:row-span-1"
        />
        <Tips
          paused={paused}
          className="lg:col-start-1 lg:row-start-2 motion-reduce:lg:row-start-1"
        />
      </div>
    </section>
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
  caption,
  reassurance,
  offsetMs,
  className,
}: {
  step: number;
  caption: number;
  reassurance: Reassurance;
  offsetMs: number;
  className: string;
}) {
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
      <h2 className="font-bold">מה קורה עכשיו</h2>
      <div aria-hidden className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className={styles.bar} style={bar} />
      </div>
      <ol className="mt-5">
        {WAIT_STEPS.map((s, i) => (
          <StepRow key={s.id} step={s} state={stepState(i, step)} last={i === LAST_STEP} />
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
  const Icon = STEP_ICONS[step.id];
  return (
    <li className="flex gap-3" aria-current={state === "current" ? "step" : undefined}>
      <div className="flex flex-col items-center">
        {/* A step the schedule moved past fills in; no check: we cannot know it is done. */}
        <span
          className={cx(
            "relative grid size-9 shrink-0 place-items-center rounded-full",
            state === "past" && "bg-accent text-on-accent",
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
              state === "past" ? "bg-accent" : "bg-line",
            )}
          />
        )}
      </div>
      <p
        className={cx(
          "min-h-9 pt-[7px] text-[15px] leading-snug font-semibold",
          !last && "pb-3",
          state === "past" && "text-ink",
          state === "current" && "text-accent-ink",
          state === "upcoming" && "text-muted",
        )}
      >
        {step.label}
        <span className="sr-only">
          {state === "past" ? " (שלב קודם)" : state === "current" ? " (עכשיו)" : ""}
        </span>
      </p>
    </li>
  );
}

const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function Tips({ paused, className }: { paused: boolean; className: string }) {
  const [tip, setTip] = useState(0);
  // Hovering or focusing the card holds the tip, so it can be read to the end.
  const [hold, setHold] = useState(false);
  const titleId = useId();

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
        <h2 id={titleId} className="font-bold">
          ידעתם?
        </h2>
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
          onClick={() => setTip((i) => nextTip(i, WAIT_TIPS.length))}
          aria-label="הטיפ הבא"
          className="-me-2 grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-ink"
        >
          <ChevronLeft aria-hidden className="size-5" />
        </button>
      </div>
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
