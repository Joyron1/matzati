"use client";

import { Pause, Play } from "lucide-react";
import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent,
} from "react";
import { sceneTiming, type SceneCard, type SceneSlot } from "./scene-timing";
import styles from "./search-wait.module.css";

// The waiting screen's motion scene, a decorative story of the search in one inline SVG (640x360,
// user units; CSS px in the transforms are user units too). Right to left, the reading direction:
// the query is typed and read by the magnifier and split into chips (step 1); product cards then
// ride a belt, stop under the magnifier and get a verdict above it, a check or a soft cross. The
// first two checks fly into the featured and the second of the three numbered slots, which fill
// as they land (steps 2-3, see scene-timing.ts); later checks head for the third slot, which stays
// pending until the real page arrives. No slot ever shows a winner: the search may still find
// nothing. Hidden under reduced motion; a tap or the pointer makes the magnifier lean and hop.

type Tint = "accentSoft" | "goldSoft" | "surface2";
type Shape = "round" | "box" | "tall";

const TIMING = sceneTiming();

/** How each card looks, in the order of TIMING.cards: the two picks, then the looping stream. */
const LOOKS: readonly { tint: Tint; shape: Shape }[] = [
  // The featured and the second slot fill with the same product the card showed.
  { tint: "goldSoft", shape: "box" },
  { tint: "accentSoft", shape: "round" },
  { tint: "surface2", shape: "tall" },
  { tint: "goldSoft", shape: "round" },
  { tint: "accentSoft", shape: "box" },
  { tint: "surface2", shape: "round" },
  { tint: "accentSoft", shape: "tall" },
  { tint: "goldSoft", shape: "tall" },
];

const TO: Record<SceneSlot, string> = { a: styles.toA, b: styles.toB, c: styles.toC };

const secs = (s: number) => `${Number(s.toFixed(3))}s`;

const SCENE_VARS = {
  "--cycle": secs(TIMING.cycleS),
  "--gap": secs(TIMING.gapS),
  "--belt": secs(TIMING.beltTickS),
  "--glint-at": secs(TIMING.glintAtS),
} as CSSProperties;

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

const cx = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

function ProductShape({ shape }: { shape: Shape }) {
  if (shape === "round")
    return <circle cx={0} cy={-15} r={10} className={styles.accentFill} opacity={0.55} />;
  if (shape === "box")
    return <rect x={-9} y={-24} width={18} height={18} rx={4} className={styles.inkSoft} />;
  return <rect x={-6} y={-27} width={12} height={22} rx={6} className={styles.accentInk} />;
}

/** A product card drawn around (0, 0), 60x76, on the stream's clock. */
function Card({ card, tint, shape }: { card: SceneCard; tint: Tint; shape: Shape }) {
  const pass = card.slot !== null;
  const clock = { "--delay": secs(card.delayS), "--iter": card.once ? 1 : "infinite" };
  return (
    <g
      className={cx(styles.card, styles.clocked, card.slot ? TO[card.slot] : styles.toFail)}
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

interface WaitSceneProps {
  /** Current step of the schedule, 0-4. */
  stage: number;
  paused: boolean;
  onPausedChange: (paused: boolean) => void;
  className?: string;
}

export const WaitScene = memo(function WaitScene({
  stage,
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
      style={SCENE_VARS}
      className={cx(
        styles.scene,
        "relative aspect-video overflow-hidden",
        stage >= 1 && styles.s1,
        stage >= 2 && styles.s2,
        stage >= 3 && styles.s3,
        stage >= 4 && styles.s4,
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
            <clipPath id={`${id}-slot-c`}>
              <rect x="26" y="106" width="114" height="70" rx="12" />
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

          {/* The "3 results" shelf, laid out like the results: featured at the start, two compact. */}
          <g className={styles.layerSlots}>
            <rect x="150" y="26" width="110" height="150" rx="14" className={styles.slotEmpty} />
            <rect x="26" y="26" width="114" height="70" rx="12" className={styles.slotEmpty} />
            <rect
              x="26"
              y="106"
              width="114"
              height="70"
              rx="12"
              className={cx(styles.slotEmpty, styles.slotC)}
            />
            <text x="205" y="101" className={styles.slotNum}>
              1
            </text>
            <text x="83" y="61" className={styles.slotNum}>
              2
            </text>
            <text x="83" y="141" className={cx(styles.slotNum, styles.num3)}>
              3
            </text>

            <rect
              x="150"
              y="26"
              width="110"
              height="150"
              rx="14"
              className={cx(styles.slotRing, styles.ringA)}
              style={fillAt(TIMING.fillAtS.a)}
            />
            <g className={styles.slotFill} style={fillAt(TIMING.fillAtS.a)}>
              <rect x="150" y="26" width="110" height="150" rx="14" className={styles.panel} />
              <rect x="158" y="34" width="94" height="60" rx="10" className={styles.goldSoft} />
              <rect x="193" y="46" width="24" height="24" rx="5" className={styles.inkSoft} />
              <ellipse cx="205" cy="80" rx="17" ry="3" className={styles.shade} />
              <rect x="176" y="102" width="76" height="6" rx="3" className={styles.inkSoft} />
              <rect x="200" y="112" width="52" height="6" rx="3" className={styles.inkSoft} />
              <rect
                x="158"
                y="124"
                width="94"
                height="28"
                rx="8"
                className={cx(styles.accentSoft, styles.whyBox)}
              />
              <rect
                x="170"
                y="131"
                width="76"
                height="4.5"
                rx="2.25"
                className={cx(styles.accentInk, styles.why, styles.why1)}
              />
              <rect
                x="192"
                y="140"
                width="54"
                height="4.5"
                rx="2.25"
                className={cx(styles.accentInk, styles.why, styles.why2)}
              />
              <rect x="214" y="160" width="38" height="9" rx="4.5" className={styles.inkPrice} />
            </g>

            <rect
              x="26"
              y="26"
              width="114"
              height="70"
              rx="12"
              className={styles.slotRing}
              style={fillAt(TIMING.fillAtS.b)}
            />
            <g className={styles.slotFill} style={fillAt(TIMING.fillAtS.b)}>
              <rect x="26" y="26" width="114" height="70" rx="12" className={styles.panel} />
              <rect x="84" y="33" width="48" height="56" rx="8" className={styles.accentSoft} />
              <circle cx="108" cy="56" r="11" className={styles.accentFill} opacity={0.55} />
              <ellipse cx="108" cy="74" rx="11" ry="2.2" className={styles.shade} />
              <rect x="40" y="36" width="36" height="5" rx="2.5" className={styles.inkSoft} />
              <rect x="52" y="45" width="24" height="5" rx="2.5" className={styles.inkSoft} />
              <rect
                x="34"
                y="58"
                width="42"
                height="4.5"
                rx="2.25"
                className={cx(styles.accentInk, styles.why, styles.why3)}
              />
              <rect x="54" y="72" width="22" height="7" rx="3.5" className={styles.inkPrice} />
            </g>

            <g className={styles.prep}>
              <rect x="84" y="113" width="48" height="56" rx="8" className={styles.surface2} />
              <rect x="40" y="118" width="36" height="5" rx="2.5" className={styles.surface2} />
              <rect x="52" y="127" width="24" height="5" rx="2.5" className={styles.surface2} />
              <rect x="34" y="140" width="42" height="4.5" rx="2.25" className={styles.surface2} />
              <rect x="54" y="152" width="22" height="7" rx="3.5" className={styles.surface2} />
              <g clipPath={`url(#${id}-slot-c)`}>
                <g className={styles.sweep}>
                  <rect x="20" y="106" width="130" height="70" fill={`url(#${id}-sweep)`} />
                </g>
              </g>
            </g>
          </g>

          {/* The cards, above the shelf, so a check lands on its slot and hands over to the fill. */}
          <g className={cx(styles.layerFloor, styles.cards)}>
            {TIMING.cards.map((card, i) => (
              <Card key={i} card={card} {...LOOKS[i % LOOKS.length]} />
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
