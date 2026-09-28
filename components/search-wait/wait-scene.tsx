"use client";

import { Pause, Play } from "lucide-react";
import {
  memo,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import {
  sceneTiming,
  slotBoxes,
  slotCenter,
  type SceneCard,
  type SceneTiming,
  type SlotBox,
} from "./scene-timing";
import styles from "./search-wait.module.css";

// The waiting screen's motion scene, a decorative story of the search in one inline SVG (640x360,
// user units; CSS px in the transforms are user units too). Right to left, the reading direction:
// the query is typed and read by the magnifier and split into chips (step 1); product cards then
// ride a belt, stop under the magnifier and get a verdict above it, a check or a soft cross. The
// first checks fly into the result slots one by one, laid out like the results page (the featured
// slot, then one per other result of a page, see scene-timing.ts), each filling as its card lands
// with a card as the results page shows it; later checks head for the last slot, which shows a
// pending draft once the lines are being written and stays pending until the real page arrives.
// No slot ever shows a winner: the search may still find nothing. Hidden under reduced motion; a
// tap or the pointer makes the magnifier lean and hop.

type Tint = "accentSoft" | "goldSoft" | "surface2";
type Shape = "round" | "box" | "tall";

/** How each card looks, in the order of the timing's cards: the picks, then the looping stream. */
const LOOKS: readonly { tint: Tint; shape: Shape }[] = [
  // The slots fill with the same product the card showed.
  { tint: "goldSoft", shape: "box" },
  { tint: "accentSoft", shape: "round" },
  { tint: "surface2", shape: "tall" },
  { tint: "goldSoft", shape: "round" },
  { tint: "accentSoft", shape: "box" },
  { tint: "surface2", shape: "round" },
  { tint: "accentSoft", shape: "tall" },
  { tint: "goldSoft", shape: "tall" },
];

const secs = (s: number) => `${Number(s.toFixed(3))}s`;

const sceneVars = (t: SceneTiming) =>
  ({
    "--cycle": secs(t.cycleS),
    "--gap": secs(t.gapS),
    "--belt": secs(t.beltTickS),
    "--glint-at": secs(t.glintAtS),
  }) as CSSProperties;

const fillAt = (s: number) => ({ "--fill-at": secs(s) }) as CSSProperties;

/** Six dots around a check, thrown outward as it pops. */
const BURST: readonly [number, number][] = [
  [14.72, 8.5],
  [0, 17],
  [-14.72, 8.5],
  [-14.72, -8.5],
  [0, -17],
  [14.72, -8.5],
];

/** How long a tap keeps the scene leaning before it settles back. */
const TAP_HOLD_MS = 1_200;

/** A slot narrower than this draws its card as a tile: the photo above, the lines under it. */
const WIDE_SLOT = 90;

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

function ProductShape({ shape }: { shape: Shape }) {
  if (shape === "round")
    return <circle cx={0} cy={-15} r={10} className={styles.accentFill} opacity={0.55} />;
  if (shape === "box")
    return <rect x={-9} y={-24} width={18} height={18} rx={4} className={styles.inkSoft} />;
  return <rect x={-6} y={-27} width={12} height={22} rx={6} className={styles.accentInk} />;
}

/** A product card drawn around (0, 0), 60x76, on the stream's clock; `to`: its slot's center. */
function Card({
  card,
  tint,
  shape,
  to,
  last,
}: {
  card: SceneCard;
  tint: Tint;
  shape: Shape;
  to: { x: number; y: number } | null;
  /** It heads for the last slot, which stays pending: it lands a little smaller. */
  last: boolean;
}) {
  const pass = card.slot !== null;
  const clock = {
    "--delay": secs(card.delayS),
    "--iter": card.once ? 1 : "infinite",
    ...(to ? { "--to-x": `${to.x}px`, "--to-y": `${to.y}px`, "--to-k": last ? 0.45 : 0.5 } : {}),
  };
  return (
    <g
      className={cx(styles.card, styles.clocked, to ? styles.toSlot : styles.toFail)}
      style={clock as CSSProperties}
    >
      <g className={styles.cardBody}>
        <rect x={-30} y={-38} width={60} height={76} rx={10} className={styles.panel} />
        <rect x={-24} y={-32} width={48} height={38} rx={7} className={styles[tint]} />
        <ProductShape shape={shape} />
        <ellipse cx={0} cy={-3} rx={11} ry={2.2} className={styles.shade} />
        <rect x={-8} y={12} width={32} height={5} rx={2.5} className={styles.inkFaint} />
        <rect x={4} y={21} width={20} height={5} rx={2.5} className={styles.inkFaint} />
        <rect x={6} y={29} width={18} height={6} rx={3} className={styles.inkPrice} />
        {pass && (
          <rect
            x={-33}
            y={-41}
            width={66}
            height={82}
            rx={13}
            className={cx(styles.passRing, styles.clocked)}
          />
        )}
        {/* Above the card, so under the magnifier the verdict sits clear of the glass. */}
        <g transform="translate(0 -58)">
          <g className={styles.badgeK}>
            {pass && (
              <g className={cx(styles.burst, styles.clocked)}>
                {BURST.map(([x, y]) => (
                  <circle key={`${x},${y}`} cx={x} cy={y} r={2.6} className={styles.accentFill} />
                ))}
              </g>
            )}
            <g className={cx(styles.badge, styles.clocked)}>
              {pass ? (
                <>
                  <circle r={13} className={styles.accentFill} />
                  <path d="M-5.5 0.5 L-1.8 4.2 L5.5 -3.6" className={styles.checkMark} />
                </>
              ) : (
                <>
                  <circle r={13} className={styles.crossDisc} />
                  <path d="M-4.5 -4.5 L4.5 4.5 M4.5 -4.5 L-4.5 4.5" className={styles.crossMark} />
                </>
              )}
            </g>
          </g>
        </g>
      </g>
    </g>
  );
}

function Chip({
  x,
  width,
  removable,
  delay,
}: {
  x: number;
  width: number;
  removable: boolean;
  delay: number;
}) {
  const end = x + width;
  return (
    <g className={styles.chip} style={{ transitionDelay: `${delay}s` }}>
      <rect
        x={x}
        y={92}
        width={width}
        height={28}
        rx={14}
        className={removable ? styles.accentSoft : styles.panel}
      />
      <rect
        x={removable ? x + 26 : x + 16}
        y={103}
        width={removable ? end - x - 36 : width - 32}
        height={6}
        rx={3}
        className={removable ? styles.accentInk : styles.inkSoft}
      />
      {removable && (
        <path
          d={`M${x + 9.5} 102.5 L${x + 16.5} 109.5 M${x + 16.5} 102.5 L${x + 9.5} 109.5`}
          className={styles.strokeAccentInk}
        />
      )}
    </g>
  );
}

/** The featured result as the results page shows it: photo, title, the "why" box and price. */
function FeaturedFill() {
  return (
    <>
      <rect x="150" y="26" width="110" height="150" rx="14" className={styles.panel} />
      <rect x="158" y="34" width="94" height="60" rx="10" className={styles.goldSoft} />
      <rect x="193" y="46" width="24" height="24" rx="5" className={styles.inkSoft} />
      <ellipse cx="205" cy="80" rx="17" ry="3" className={styles.shade} />
      <rect x="176" y="102" width="76" height="6" rx="3" className={styles.inkSoft} />
      <rect x="200" y="112" width="52" height="6" rx="3" className={styles.inkSoft} />
      <rect x="158" y="124" width="94" height="28" rx="8" className={styles.accentSoft} />
      <rect x="170" y="131" width="76" height="4.5" rx="2.25" className={styles.accentInk} />
      <rect x="192" y="140" width="54" height="4.5" rx="2.25" className={styles.accentInk} />
      <rect x="214" y="160" width="38" height="9" rx="4.5" className={styles.inkPrice} />
    </>
  );
}

/**
 * Another result in its slot: in a wide slot the photo beside the lines, as a compact card shows
 * them; in a narrow one the photo above. `draft`: the pending draft of the last slot, shapes only.
 */
function CompactFill({ b, draft = false }: { b: SlotBox; draft?: boolean }) {
  const tone = (fill: string) => (draft ? styles.surface2 : fill);
  if (b.w >= WIDE_SLOT) {
    return (
      <>
        {!draft && <rect {...box(b)} rx={12} className={styles.panel} />}
        <rect
          x={b.x + 58}
          y={b.y + 7}
          width={48}
          height={b.h - 14}
          rx={8}
          className={tone(styles.accentSoft)}
        />
        {!draft && (
          <>
            <circle
              cx={b.x + 82}
              cy={b.y + 30}
              r={11}
              className={styles.accentFill}
              opacity={0.55}
            />
            <ellipse cx={b.x + 82} cy={b.y + 48} rx={11} ry={2.2} className={styles.shade} />
          </>
        )}
        <rect
          x={b.x + 14}
          y={b.y + 10}
          width={36}
          height={5}
          rx={2.5}
          className={tone(styles.inkSoft)}
        />
        <rect
          x={b.x + 26}
          y={b.y + 19}
          width={24}
          height={5}
          rx={2.5}
          className={tone(styles.inkSoft)}
        />
        <rect
          x={b.x + 8}
          y={b.y + 32}
          width={42}
          height={4.5}
          rx={2.25}
          className={tone(styles.accentInk)}
        />
        <rect
          x={b.x + 28}
          y={b.y + 46}
          width={22}
          height={7}
          rx={3.5}
          className={tone(styles.inkPrice)}
        />
      </>
    );
  }
  const photoH = b.h * 0.44;
  const mid = b.x + b.w / 2;
  return (
    <>
      {!draft && <rect {...box(b)} rx={10} className={styles.panel} />}
      <rect
        x={b.x + 6}
        y={b.y + 6}
        width={b.w - 12}
        height={photoH}
        rx={6}
        className={tone(styles.accentSoft)}
      />
      {!draft && (
        <>
          <circle
            cx={mid}
            cy={b.y + 6 + photoH / 2}
            r={7}
            className={styles.accentFill}
            opacity={0.55}
          />
          <ellipse cx={mid} cy={b.y + 6 + photoH - 5} rx={8} ry={1.6} className={styles.shade} />
        </>
      )}
      <rect
        x={b.x + b.w - 36}
        y={b.y + photoH + 12}
        width={30}
        height={4.5}
        rx={2.25}
        className={tone(styles.inkSoft)}
      />
      <rect
        x={b.x + 6}
        y={b.y + photoH + 21}
        width={b.w - 12}
        height={4}
        rx={2}
        className={tone(styles.accentInk)}
      />
      <rect
        x={b.x + b.w - 24}
        y={b.y + b.h - 13}
        width={18}
        height={6}
        rx={3}
        className={tone(styles.inkPrice)}
      />
    </>
  );
}

const box = (b: SlotBox) => ({ x: b.x, y: b.y, width: b.w, height: b.h });

interface WaitSceneProps {
  /** Current step of the wait, 0-4 (-1: none, the page is about to show). */
  stage: number;
  /** Results on a page (RESULTS_PER_PAGE): one slot each. */
  slots: number;
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
  className?: string;
}

export const WaitScene = memo(function WaitScene({
  stage,
  slots,
  paused,
  onPausedChange,
  className = "",
}: WaitSceneProps) {
  const ref = useRef<HTMLDivElement>(null);
  const boopRef = useRef<SVGGElement>(null);
  const rippleRef = useRef<SVGCircleElement>(null);
  const frame = useRef(0);
  const release = useRef<number | undefined>(undefined);
  const [offscreen, setOffscreen] = useState(false);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const timing = useMemo(() => sceneTiming(slots), [slots]);
  const boxes = useMemo(() => slotBoxes(slots), [slots]);
  const lastSlot = boxes.length - 1;
  const last = boxes[lastSlot];
  // Stage 4 is writing; a page about to show (-1) keeps the scene where it was.
  const at = stage === -1 ? 4 : stage;

  // Nothing moves while the scene is scrolled away (on phones the steps and tips are below it).
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setOffscreen(!entry.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(
    () => () => {
      cancelAnimationFrame(frame.current);
      window.clearTimeout(release.current);
    },
    [],
  );

  // The scene leans toward the pointer (or a tap), written as CSS variables once per frame. The
  // 3D tilt applies only while it aims (data-aim), so the frame is not a 3D layer at rest.
  function aim(x: number, y: number) {
    const el = ref.current;
    if (!el) return;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty("--mx", x.toFixed(3));
      el.style.setProperty("--my", y.toFixed(3));
      if (x === 0 && y === 0) delete el.dataset.aim;
      else el.dataset.aim = "";
    });
  }

  function aimAt(e: PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const clamp = (v: number) => Math.min(1, Math.max(-1, v));
    aim(
      clamp(((e.clientX - r.left) / r.width) * 2 - 1),
      clamp(((e.clientY - r.top) / r.height) * 2 - 1),
    );
  }

  /** A touch has no hover to end it: the lean settles back a moment after the finger. */
  function holdThenSettle() {
    window.clearTimeout(release.current);
    release.current = window.setTimeout(() => aim(0, 0), TAP_HOLD_MS);
  }

  /** The magnifier bounces and rings once. */
  function boop() {
    boopRef.current?.animate(
      [
        { transform: "scale(1)", easing: "ease-out" },
        { transform: "scale(1.16)", offset: 0.35, easing: "cubic-bezier(0.34, 1.56, 0.64, 1)" },
        { transform: "scale(1)" },
      ],
      { duration: 420 },
    );
    rippleRef.current?.animate(
      [
        { transform: "scale(1)", opacity: 0.5 },
        { transform: "scale(1.3)", opacity: 0 },
      ],
      { duration: 500, easing: "ease-out" },
    );
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    if (paused || !e.isPrimary || (e.target as Element).closest("button")) return;
    aimAt(e);
    boop();
    if (e.pointerType !== "mouse") holdThenSettle();
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (paused || !e.isPrimary) return;
    aimAt(e);
    if (e.pointerType !== "mouse") holdThenSettle();
  }

  return (
    <div
      ref={ref}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      // A touch ends with a pointerleave too; only a mouse that leaves resets the lean at once.
      onPointerLeave={(e) => e.pointerType === "mouse" && aim(0, 0)}
      style={sceneVars(timing)}
      className={cx(
        styles.scene,
        "relative aspect-video overflow-hidden",
        at >= 1 && styles.s1,
        at >= 4 && styles.s4,
        offscreen && styles.offscreen,
        className,
      )}
    >
      <div className={cx(styles.tilt, "absolute inset-0")}>
        <svg
          viewBox="0 0 640 360"
          className={styles.svg}
          aria-hidden
          focusable="false"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className={styles.bgTop} />
              <stop offset="0.85" className={styles.bgBottom} />
            </linearGradient>
            <pattern id={`${id}-dots`} width="22" height="22" patternUnits="userSpaceOnUse">
              <circle cx="3" cy="3" r="1.3" className={styles.dot} />
            </pattern>
            <linearGradient id={`${id}-sweep`} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" className={styles.sweepEdge} />
              <stop offset="0.5" className={styles.sweepMid} />
              <stop offset="1" className={styles.sweepEdge} />
            </linearGradient>
            <linearGradient id={`${id}-floor`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className={styles.floorTop} />
              <stop offset="1" className={styles.floorBottom} />
            </linearGradient>
            <clipPath id={`${id}-lens`}>
              <circle r="51" />
            </clipPath>
            <clipPath id={`${id}-slot-last`}>
              <rect {...box(last)} rx="12" />
            </clipPath>
          </defs>

          <rect x="-40" y="-40" width="720" height="440" fill={`url(#${id}-bg)`} />
          <g className={styles.layerBack}>
            <rect x="-40" y="-40" width="720" height="440" fill={`url(#${id}-dots)`} />
          </g>

          <g className={styles.layerFloor}>
            <rect x="-40" y="291" width="720" height="80" fill={`url(#${id}-floor)`} />
            <rect x="-20" y="284" width="680" height="14" rx="7" className={styles.belt} />
            <g className={styles.ticks}>
              {Array.from({ length: 19 }, (_, k) => (
                <rect
                  key={k}
                  x={-40 + k * 40}
                  y="289"
                  width="18"
                  height="4"
                  rx="2"
                  className={styles.tick}
                />
              ))}
            </g>
          </g>

          {/* The results shelf, laid out like the results: featured at the start, then the rest. */}
          <g className={styles.layerSlots}>
            {boxes.map((b, i) => (
              <rect
                key={`empty-${i}`}
                {...box(b)}
                rx={i === 0 ? 14 : 12}
                className={cx(styles.slotEmpty, i === lastSlot && styles.slotLast)}
              />
            ))}
            {boxes.map((b, i) => {
              const c = slotCenter(b);
              return (
                <text
                  key={`num-${i}`}
                  x={c.x}
                  y={c.y}
                  className={cx(styles.slotNum, i === lastSlot && styles.numLast)}
                  style={b.w < WIDE_SLOT ? { fontSize: 26 } : undefined}
                >
                  {i + 1}
                </text>
              );
            })}

            {boxes.slice(0, lastSlot).map((b, i) => (
              <g key={`fill-${i}`}>
                <rect
                  {...box(b)}
                  rx={i === 0 ? 14 : 12}
                  className={cx(styles.slotRing, i === 0 && styles.ringA)}
                  style={fillAt(timing.fillAtS[i])}
                />
                <g className={styles.slotFill} style={fillAt(timing.fillAtS[i])}>
                  {i === 0 ? <FeaturedFill /> : <CompactFill b={b} />}
                </g>
              </g>
            ))}

            <g className={styles.prep}>
              <CompactFill b={last} draft />
              <g clipPath={`url(#${id}-slot-last)`}>
                <g className={styles.sweep}>
                  <rect
                    x={last.x - 6}
                    y={last.y}
                    width={last.w + 16}
                    height={last.h}
                    fill={`url(#${id}-sweep)`}
                  />
                </g>
              </g>
            </g>
          </g>

          {/* The cards, above the shelf, so a check lands on its slot and hands over to the fill. */}
          <g className={cx(styles.layerFloor, styles.cards)}>
            {timing.cards.map((card, i) => (
              <Card
                key={i}
                card={card}
                {...LOOKS[i % LOOKS.length]}
                to={card.slot === null ? null : slotCenter(boxes[card.slot])}
                last={card.slot === lastSlot}
              />
            ))}
          </g>

          {/* The query, typed and read, then the chips we understood (one fixed, two removable). */}
          <g className={styles.layerQuery}>
            <g className={styles.queryK}>
              <rect x="372" y="30" width="240" height="50" rx="25" className={styles.panel} />
              <circle cx="590" cy="53" r="7" className={styles.strokeMuted} />
              <path d="M595 58 L600 63" className={styles.strokeMuted} />
              <rect
                x="500"
                y="51"
                width="76"
                height="8"
                rx="4"
                className={cx(styles.inkSoft, styles.typed)}
                style={{ animationDelay: "0.15s" }}
              />
              <rect
                x="440"
                y="51"
                width="52"
                height="8"
                rx="4"
                className={cx(styles.inkSoft, styles.typed)}
                style={{ animationDelay: "0.5s" }}
              />
              <rect
                x="396"
                y="51"
                width="36"
                height="8"
                rx="4"
                className={cx(styles.inkSoft, styles.typed)}
                style={{ animationDelay: "0.8s" }}
              />
              <rect x="388" y="44" width="2.5" height="22" rx="1.25" className={styles.caret} />
              <Chip x={524} width={88} removable={false} delay={0.25} />
              <Chip x={430} width={86} removable delay={0.4} />
              <Chip x={350} width={72} removable delay={0.55} />
            </g>
          </g>

          {/* The magnifier, in front of everything; X and Y move on two curves, so it swoops. */}
          <g className={styles.lensAim}>
            <g className={styles.lensX}>
              <g className={styles.lensY}>
                <g className={styles.lensIdle}>
                  <g ref={boopRef}>
                    <path d="M40 40 L70 70" className={styles.handle} />
                    <path d="M35 35 L44 44" className={styles.collar} />
                    <circle r="54" className={styles.glass} />
                    <g clipPath={`url(#${id}-lens)`}>
                      <g transform="rotate(24)">
                        <rect
                          x="-9"
                          y="-70"
                          width="16"
                          height="140"
                          rx="8"
                          className={styles.glint}
                        />
                      </g>
                    </g>
                    <circle r="47" className={styles.glassEdge} />
                    <circle r="54" className={styles.ring} />
                  </g>
                  <circle ref={rippleRef} r="56" className={styles.ripple} />
                </g>
              </g>
            </g>
          </g>
        </svg>
      </div>

      {/* A 44 px target around a quieter 32 px disc. */}
      <button
        type="button"
        aria-pressed={paused}
        aria-label="השהיית האנימציה"
        onClick={() => {
          if (!paused) aim(0, 0);
          onPausedChange(!paused);
        }}
        className="group absolute end-1.5 bottom-1.5 grid size-11 place-items-center rounded-full"
      >
        <span className="grid size-8 place-items-center rounded-full border border-line bg-surface/85 text-muted group-hover:border-accent group-hover:text-ink group-focus-visible:border-accent group-focus-visible:text-ink">
          {paused ? (
            <Play aria-hidden className="size-4" />
          ) : (
            <Pause aria-hidden className="size-4" />
          )}
        </span>
      </button>
    </div>
  );
});
