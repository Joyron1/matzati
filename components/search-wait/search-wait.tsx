"use client";

import {
  Check,
  ChevronLeft,
  Clock,
  Lightbulb,
  ListFilter,
  ListOrdered,
  MessageSquareText,
  PackageSearch,
  PenLine,
  type LucideIcon,
} from "lucide-react";
import { useSearchParams } from "next/navigation";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type ReactNode,
} from "react";
import { SearchComposer } from "@/components/search-composer";
import { card } from "@/components/styles";
import { RESULTS_PER_PAGE } from "@/lib/config/site";
import { formatCount } from "@/lib/format";
import type { FilterChip } from "@/lib/types";
import {
  LAST_STEP,
  PROGRESS_CAP,
  PROGRESS_EASE,
  PROGRESS_EASE_MS,
  RANK_STEP,
  REASSURANCE_TEXT,
  SCAN_STEP,
  WAIT_STEPS,
  currentStep,
  echoQuery,
  nextMarkMs,
  nextTip,
  progressFloor,
  reassuranceAt,
  stepProgress,
  stepStates,
  tipDurationMs,
  type Reassurance,
  type StepState,
  type WaitSignals,
  type WaitStep,
  type WaitStepId,
} from "./schedule";
import { onSettled, type RankedSignal, type SearchSignals } from "./signals";
import styles from "./search-wait.module.css";
import { WAIT_TIPS } from "./tips";
import { WaitScene } from "./wait-scene";

// The /search waiting screen, one per search, shown until its results are complete
// (components/search-view.tsx): the chips we understood once the query is understood, the query, a
// motion scene with a "now" line under it on phones, the steps of the search (see ./schedule.ts
// for what each may claim and when), a progress bar that never completes on its own, and tips.

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

const STEP_ICONS: Record<WaitStepId, LucideIcon> = {
  read: MessageSquareText,
  scan: PackageSearch,
  filter: ListFilter,
  rank: ListOrdered,
  write: PenLine,
};

/** Each step's detail, then why it takes long, then that we are still on it. */
const CAPTION_COUNT = WAIT_STEPS.length + 2;

/** The caption for a moment of the wait: the current step's, or a reassurance once it is slow. */
function captionAt(step: number, reassurance: Reassurance): number {
  if (reassurance === "slower") return CAPTION_COUNT - 1;
  if (reassurance === "slow") return CAPTION_COUNT - 2;
  return step;
}

/** Ticker state of text `index` when `current` is shown (see .ticker in the CSS module). */
function tickerClass(index: number, current: number, previous = current - 1): string {
  if (index === current) return cx(styles.ticker, styles.tickerOn);
  return index === previous ? cx(styles.ticker, styles.tickerPast) : styles.ticker;
}

/** The search bar with the query from the URL, for app/search/loading.tsx. */
export function SearchBarFromUrl() {
  const params = useSearchParams();
  return <SearchComposer variant="bar" defaultValue={echoQuery(params.get("q"))} />;
}

/**
 * The real moments of the search as the wait knows them (./signals.ts), and the time into the
 * wait, re-read only when the schedule changes something (nextMarkMs) or a moment arrives.
 */
function useWaitProgress(signals: SearchSignals) {
  const start = useRef(0);
  const [elapsed, setElapsed] = useState(0);
  const [understoodAtMs, setUnderstoodAt] = useState<number | null>(null);
  const [chips, setChips] = useState<FilterChip[] | null>(null);
  const [ranked, setRanked] = useState<RankedSignal | null>(null);

  useEffect(() => {
    start.current = performance.now();
    const since = () => Math.round(performance.now() - start.current);
    let live = true;
    onSettled(signals.understood, (understood) => {
      if (!live || !understood) return;
      setChips(understood.chips);
      setUnderstoodAt(since());
    });
    onSettled(signals.ranked, (value) => {
      if (!live || !value) return;
      setRanked(value);
      setElapsed(since());
    });
    return () => {
      live = false;
    };
  }, [signals]);

  const state: WaitSignals = {
    understoodAtMs,
    ranked: ranked !== null,
    writing: ranked?.writing === true,
  };
  const now = Math.max(elapsed, understoodAtMs ?? 0);
  const next = nextMarkMs(now, state);
  useEffect(() => {
    if (next === null) return;
    const timer = window.setTimeout(
      () => setElapsed(Math.round(performance.now() - start.current)),
      Math.max(0, next - (performance.now() - start.current)),
    );
    return () => window.clearTimeout(timer);
  }, [next]);

  return { now, state, chips, ranked };
}

export function SearchWait({
  query,
  signals,
  slots = RESULTS_PER_PAGE,
}: {
  query: string;
  /** The search's real moments (app/search/page.tsx). */
  signals: SearchSignals;
  /** Results on a page: the scene draws one slot for each. */
  slots?: number;
}) {
  const { now, state, chips, ranked } = useWaitProgress(signals);
  const states = stepStates(now, state);
  const current = currentStep(now, state);
  // With nothing current (the page is about to show), the lines say where the search got to.
  const shownStep = current === -1 ? RANK_STEP : current;
  const reassurance = reassuranceAt(now);
  const caption = captionAt(shownStep, reassurance);
  const [paused, setPaused] = useState(false);
  const headingId = useId();

  const captions = [
    ...WAIT_STEPS.map((s) =>
      s.id === "write" && ranked ? <WriteCaption key={s.id} ranked={ranked} /> : s.detail,
    ),
    REASSURANCE_TEXT.slow,
    REASSURANCE_TEXT.slower,
  ];

  return (
    <section
      aria-labelledby={headingId}
      // Tall enough that the footer starts below the fold, so it does not jump with the results.
      className={cx(styles.enter, paused && styles.paused, "min-h-dvh")}
    >
      <UnderstoodChips chips={chips} />
      <div className="space-y-5">
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
            <WaitScene stage={current} slots={slots} paused={paused} onPausedChange={setPaused} />
            <NowLine step={shownStep} caption={caption} captions={captions} />
          </div>
          <Steps
            states={states}
            step={shownStep}
            current={current}
            caption={caption}
            captions={captions}
            reassurance={reassurance}
            floor={progressFloor(state)}
            announceChips={current === SCAN_STEP ? chips : null}
            className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-stretch motion-reduce:lg:row-span-1"
          />
          <Tips
            paused={paused}
            className="lg:col-start-1 lg:row-start-2 motion-reduce:lg:row-start-1"
          />
        </div>
      </div>
    </section>
  );
}

/** The write step's caption once the products are ranked: the counts the results page shows. */
function WriteCaption({ ranked }: { ranked: Pick<RankedSignal, "checked" | "passed"> }) {
  return (
    <>
      בדקנו <bdi dir="ltr">{formatCount(ranked.checked)}</bdi> מוצרים ו־
      <bdi dir="ltr">{formatCount(ranked.passed)}</bdi> עברו את הסינון. עכשיו כותבים לכל מוצר שנציג
      משפט קצר על הסיבה שבחרנו בו.
    </>
  );
}

/** Keeps the room of the longest write caption (four-digit counts), so nothing moves when it comes. */
const WRITE_SIZER = <WriteCaption ranked={{ checked: 9_999, passed: 999 }} />;

// Same colors as the "הבנתי ככה" chips of the results page, smaller: nothing here is clickable.
const CHIP = "inline-flex h-9 shrink-0 items-center rounded-full px-3.5 text-sm font-semibold";
const chipColors = (chip: FilterChip) =>
  chip.removable ? "bg-accent-soft text-accent-ink" : "border border-line bg-surface text-ink";

/**
 * "הבנתי ככה": the chips the query was understood as, once it is (the results page shows the same
 * chips above its results). Until then, shapes where they will be. One row, laid out as the chips
 * usually wrap (on phones the label takes a row of its own, from sm the chips share its row), so
 * the wait does not move when they arrive; a chip past the row's end fades out there (the results
 * page shows them all).
 */
function UnderstoodChips({ chips }: { chips: FilterChip[] | null }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span aria-hidden={!chips} className="w-full text-sm font-semibold text-muted sm:w-auto">
        הבנתי ככה:
      </span>
      {chips ? (
        <ul
          aria-label="מה הבנו מהחיפוש"
          className="flex h-11 min-w-0 flex-1 items-center gap-2 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_2.5rem)]"
        >
          {chips.map((chip, i) => (
            <li
              key={chip.id}
              style={{ transitionDelay: `${i * 70}ms` }}
              className={cx(
                CHIP,
                chipColors(chip),
                "transition duration-300 ease-out starting:scale-90 starting:opacity-0",
              )}
            >
              {chip.label_he}
            </li>
          ))}
        </ul>
      ) : (
        <span aria-hidden className="flex h-11 items-center gap-2">
          {["w-24", "w-20", "w-16"].map((width) => (
            <span
              key={width}
              className={`h-9 ${width} rounded-full bg-surface-2 motion-safe:animate-pulse`}
            />
          ))}
        </span>
      )}
    </div>
  );
}

function CaptionText({ index, captions }: { index: number; captions: ReactNode[] }) {
  return (
    <>
      {index >= WAIT_STEPS.length && (
        <Clock aria-hidden className="me-1.5 inline size-4 align-[-3px]" />
      )}
      {captions[index]}
    </>
  );
}

/** Every caption stacked in one grid cell (and the write step's longest), so the box never moves. */
function CaptionStack({
  caption,
  captions,
  className,
  hideOthers = false,
}: {
  caption: number;
  captions: ReactNode[];
  className: string;
  /** Hide the captions not shown from assistive tech (the phone line is hidden as a whole). */
  hideOthers?: boolean;
}) {
  return (
    <div className={cx("grid", className)}>
      <p aria-hidden className="invisible col-start-1 row-start-1">
        {WRITE_SIZER}
      </p>
      {captions.map((_, i) => (
        <p
          key={i}
          aria-hidden={hideOthers ? i !== caption : undefined}
          className={cx(tickerClass(i, caption), "col-start-1 row-start-1")}
        >
          <CaptionText index={i} captions={captions} />
        </p>
      ))}
    </div>
  );
}

/**
 * Phones and tablets: what is happening now, right under the scene like a video caption (the step
 * list is below the fold there). Hidden from assistive tech: the step list's status says it.
 */
function NowLine({
  step,
  caption,
  captions,
}: {
  step: number;
  caption: number;
  captions: ReactNode[];
}) {
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
      <CaptionStack
        caption={caption}
        captions={captions}
        className="mt-1 ps-[26px] text-sm leading-relaxed text-muted"
      />
    </div>
  );
}

function Steps({
  states,
  step,
  current,
  caption,
  captions,
  reassurance,
  floor,
  announceChips,
  className,
}: {
  states: StepState[];
  /** The step the lines describe. */
  step: number;
  /** The current step, -1 for none. */
  current: number;
  caption: number;
  captions: ReactNode[];
  reassurance: Reassurance;
  /** The least the bar shows (progressFloor). */
  floor: number;
  /** Said once with the first step after the query is understood. */
  announceChips: FilterChip[] | null;
  className: string;
}) {
  // The one live region: the current step, with what we understood when it first comes, and why
  // it takes long once it does. Nothing new is said while the page is about to show.
  const understood = announceChips?.length
    ? `הבנו: ${announceChips.map((c) => c.label_he).join(", ")}. `
    : "";
  const label = current === -1 ? "" : `${understood}${WAIT_STEPS[step].label}`;
  const status =
    reassurance === "none" || !label ? label : `${label}. ${REASSURANCE_TEXT[reassurance]}`;
  // One CSS animation to the cap (the bar's width), from when the wait shows; under reduced motion
  // a fixed width per step (--p-step, a share of the capped bar). The floor layer rises with the
  // search's real moments.
  const bar = {
    width: `${PROGRESS_CAP * 100}%`,
    animationDuration: `${PROGRESS_EASE_MS}ms`,
    animationTimingFunction: `cubic-bezier(${PROGRESS_EASE.join(", ")})`,
    "--p-step": stepProgress(step) / PROGRESS_CAP,
  } as CSSProperties;

  return (
    <div className={cx(card, "flex flex-col p-5 sm:p-6", className)}>
      <h2 className="font-bold">מה קורה עכשיו</h2>
      <div aria-hidden className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className={styles.bar} style={bar} />
        <div className={styles.floor} style={{ transform: `scaleX(${floor})` }} />
      </div>
      <ol className="mt-5">
        {WAIT_STEPS.map((s, i) => (
          <StepRow key={s.id} step={s} state={states[i]} last={i === LAST_STEP} />
        ))}
      </ol>
      {/* Beside the scene on desktop (under it, the now line says this) and under reduced motion. */}
      <div className="mt-auto hidden pt-4 lg:block motion-reduce:block">
        <CaptionStack
          caption={caption}
          captions={captions}
          hideOthers
          className="rounded-2xl bg-accent-soft px-4 py-3 text-sm leading-relaxed text-accent-ink"
        />
      </div>
      <p role="status" className="sr-only">
        {status}
      </p>
    </div>
  );
}

function StepRow({ step, state, last }: { step: WaitStep; state: StepState; last: boolean }) {
  // A check only for a step a real moment of the search proved done; a step the schedule moved
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

function Tips({ paused, className }: { paused: boolean; className: string }) {
  const [tip, setTip] = useState(0);
  // A tip the "הטיפ הבא" button brought is read out; tips that turn on their own are not, so the
  // wait never talks over the step announcements.
  const [announced, setAnnounced] = useState("");
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
