// Device connector fit (CLAUDE.md §6.5; docs/search-quality-wave-a.md "Device connectors"): a
// search for a cable, charger or adapter for a device whose port is known wants a plug that fits
// that port. Sellers name every iPhone in every cable title ("USB C To Lightnin Cable For iPhone 15
// 14 13 12", live run 2026-09-28), so a requirement such as "iphone 15" lets through Lightning
// cables an iPhone 15 (USB-C) cannot take. Pure: no I/O, no LLM.
import type { ParsedQuery, SearchFilters } from "@/lib/search/filters";
import { tokenize } from "./match";

/** Device ports the rule knows. */
export type Connector = "usbc" | "lightning";

/** One device family whose port is known. */
export interface DevicePort {
  /** What the row covers, for tests and docs. */
  device: string;
  /** The device in the search's words, lowercased: the parse's English or its Hebrew labels. */
  pattern: RegExp;
  port: Connector;
}

const IPHONE = "(?:iphone|אייפון|איפון)\\s?-?";

/**
 * Devices whose port is known: iPhone 15 (2023) and every iPhone since (16, 16e, 17, Air, and their
 * Plus, Pro and Pro Max) have USB-C; iPhone 5 to 14 and every SE have Lightning. A search that
 * names devices of both ports ("iphone 14 or 15") gets no rule. Add a row per device family, and a
 * PORT_RULES entry for a port not listed yet.
 */
export const DEVICE_PORTS: readonly DevicePort[] = [
  {
    device: "iPhone 15 and newer (15, 16, 16e, 17, Air; Plus, Pro, Pro Max)",
    pattern: new RegExp(`${IPHONE}(?:1[5-9]|[2-9]\\d)(?!\\d)|${IPHONE}air(?![a-z])`),
    port: "usbc",
  },
  {
    device: "iPhone 5 to 14 and every SE",
    pattern: new RegExp(`${IPHONE}(?:[5-9]|1[0-4])(?!\\d)|${IPHONE}(?:se|xr|xs|x)(?![a-z])`),
    port: "lightning",
  },
];

/** Where a title puts each connector it names (see titleConnectors). */
export interface TitleConnectors {
  /**
   * Plugs at the device end: after "to" ("USB C To Lightning", "Type C to Type C/USB Lightning")
   * or right before a cable noun ("Lightning Cable", "USB Type C Fast Charging Cable"). A socket
   * ("Lightning Female") is never a plug.
   */
  ends: Set<Connector>;
  /** The same connector at both ends: "USB-C to USB-C", "C to C". */
  bothEnds: Set<Connector>;
  /** Every connector the title names as a plug, at either end. */
  named: Set<Connector>;
  /** Connectors the title calls male ("Type C Male to Lightning Female"): an adapter's plug. */
  males: Set<Connector>;
}

interface PortRule {
  /** The title plugs another connector into the device. */
  wrongEnd: (t: TitleConnectors) => boolean;
  /**
   * The title also offers the device's own connector: a listing of several cables or a
   * multi-head cable. Such a title is only moved down.
   */
  ownEnd: (t: TitleConnectors) => boolean;
  /**
   * The shopper's own Hebrew labels name the other connector, so they asked for it (a Lightning
   * adapter for an iPhone 15 lets old accessories plug in): no rule.
   */
  askedFor?: RegExp;
}

const PORT_RULES: Readonly<Record<Connector, PortRule>> = {
  // "USB-C to Lightning" names USB-C only as the charger's end.
  usbc: {
    wrongEnd: (t) => t.ends.has("lightning"),
    ownEnd: (t) => t.ends.has("usbc"),
    askedFor: /lightning|לייטנ/i,
  },
  // "USB-C cable for iPhone 14" usually means USB-C to Lightning: only USB-C at both ends is wrong.
  lightning: {
    wrongEnd: (t) => t.bothEnds.has("usbc"),
    ownEnd: (t) => t.named.has("lightning"),
  },
};

/**
 * Connector-bound products, by the nouns of the search's product terms, and how their titles are
 * read (connectorFit). A cable plugs into the device: one whose only plug is the other connector
 * is not the product. A charger's own port is not the phone's (the wrong part is usually a
 * bundled cable), so a mismatch only moves it down. An adapter's "X to Y" names its ends in
 * either order ("USB-C to Lightning Adapter" plugs USB-C into the phone), so only "male" says
 * which end is its plug, and a mismatch only moves it down. In a term, a cable wins ("charger
 * cable"); the first term that names one decides. Anything else (a case, a screen protector) is
 * not connector-bound.
 */
const PRODUCT_KINDS = [
  ["cable", new Set(["cable", "cord", "wire"])],
  ["charger", new Set(["charger"])],
  ["adapter", new Set(["adapter", "adaptor", "converter", "dongle"])],
] as const;

type ProductKind = (typeof PRODUCT_KINDS)[number][0];

/**
 * The search as ranking gets it. The product chip's label (a ParsedQuery field) is read when the
 * caller has it: it is part of the results cache key (canonicalFilters), like each requirement's.
 */
type ConnectorFilters = Pick<SearchFilters, "keywords_en" | "product_terms"> &
  Partial<Pick<SearchFilters, "requirements">> &
  Partial<Pick<ParsedQuery, "product_he">>;

/** The connector-bound product the search is for (PRODUCT_KINDS), or null. */
function productKind(f: ConnectorFilters): ProductKind | null {
  for (const term of f.product_terms) {
    const words = tokenize(term);
    const kind = PRODUCT_KINDS.find(([, nouns]) => words.some((w) => nouns.has(w)));
    if (kind) return kind[0];
  }
  return null;
}

/** The Hebrew labels the shopper sees as chips: the product and each requirement. */
const hebrewLabels = (f: ConnectorFilters) =>
  [f.product_he ?? "", ...(f.requirements ?? []).map((r) => r.he)].join(" ");

/**
 * The port of the device the search is for (DEVICE_PORTS), from the parse's English and its Hebrew
 * labels; null when it names none, or devices of different ports.
 */
export function searchedPort(f: ConnectorFilters): Connector | null {
  const text = [
    f.keywords_en,
    ...f.product_terms,
    ...(f.requirements ?? []).flatMap((r) => [r.en, ...r.alt]),
    hebrewLabels(f),
  ]
    .join(" | ")
    .toLowerCase();
  const ports = new Set(DEVICE_PORTS.filter((d) => d.pattern.test(text)).map((d) => d.port));
  return ports.size === 1 ? [...ports][0] : null;
}

/** Words that continue a list of connectors: "to Type C/USB Lightning", "Micro USB Type C". */
const LIST_WORDS = new Set(["usb", "a", "and", "or", "plus", "micro", "male", "dual"]);
/** Words between "to" and the connector: "to iPhone Lightning", "to Apple 8 Pin". */
const TO_FILLER = new Set(["apple", "iphone"]);
/** Nouns that make the connectors right before them the cable's plug. */
const CABLE_WORDS = new Set(["cable", "cord", "wire", "line", "dataline", "charger"]);
/** Words that may stand between those connectors and the noun: "Type C Fast Charging Cable". */
const CABLE_MODIFIERS = new Set(["fast", "charging", "charge", "quick", "super", "data", "sync"]);
/** Most tokens a list of connectors after "to" is read for. */
const LIST_REACH = 6;

/** The connector at token `i` and how many tokens it spans, or null. */
function connectorAt(w: readonly string[], i: number): { c: Connector; n: number } | null {
  const t = w[i];
  if (t === "usbc") return { c: "usbc", n: 1 };
  // "C to C": a bare "c" next to "to".
  if (t === "c" && (w[i - 1] === "to" || w[i + 1] === "to")) return { c: "usbc", n: 1 };
  // "Lightnin" is a real title's spelling (live run 2026-09-28).
  if (t === "lightning" || t === "lightnin" || t === "8pin") return { c: "lightning", n: 1 };
  if (t === "8" && w[i + 1] === "pin") return { c: "lightning", n: 2 };
  // Only right after "to": "Type C to iOS", "USB C to Lighting" (a misspelling that also means lamps).
  if ((t === "ios" || t === "lighting") && w[i - 1] === "to") return { c: "lightning", n: 1 };
  return null;
}

/** Where the title puts each connector it names (TitleConnectors). */
export function titleConnectors(title: string): TitleConnectors {
  const w = tokenize(title);
  const ends = new Set<Connector>();
  const bothEnds = new Set<Connector>();
  const named = new Set<Connector>();
  const males = new Set<Connector>();
  const marked = (i: number, n: number, gender: string) =>
    w[i - 1] === gender || w[i + n] === gender;
  const socket = (i: number, n: number) => marked(i, n, "female");

  for (let i = 0; i < w.length; i++) {
    const at = connectorAt(w, i);
    if (at && !socket(i, at.n)) named.add(at.c);
    if (at && marked(i, at.n, "male")) males.add(at.c);
  }

  // After "to": the plug at the device end, and every connector listed with it.
  for (let t = 0; t < w.length; t++) {
    if (w[t] !== "to") continue;
    let first: Connector | null = null;
    let j = t + 1;
    if (TO_FILLER.has(w[j])) j++;
    for (let read = 0; j < w.length && read < LIST_REACH; read++) {
      const at = connectorAt(w, j);
      if (at) {
        if (!socket(j, at.n)) {
          ends.add(at.c);
          first ??= at.c;
        }
        j += at.n;
      } else if (LIST_WORDS.has(w[j])) j++;
      else break;
    }
    let s = t - 1;
    if (w[s] === "male" || w[s] === "female") s--;
    // The connector that ends at token s: "USB C", "C", or the two tokens of "8 Pin".
    const two = connectorAt(w, s - 1);
    const source = two?.n === 2 ? two.c : connectorAt(w, s)?.c;
    if (source && first === source) bothEnds.add(source);
  }

  // A list of connectors right before a cable noun: "USB Type C Cable", "Lightning Charger".
  for (let i = 0; i < w.length;) {
    const at = connectorAt(w, i);
    if (!at) {
      i++;
      continue;
    }
    const run: Connector[] = [];
    let j = i;
    while (j < w.length) {
      const next = connectorAt(w, j);
      if (next) {
        if (!socket(j, next.n)) run.push(next.c);
        j += next.n;
      } else if (LIST_WORDS.has(w[j])) j++;
      else break;
    }
    let k = j;
    while (k < j + 2 && CABLE_MODIFIERS.has(w[k])) k++;
    if (CABLE_WORDS.has(w[k])) for (const c of run) ends.add(c);
    i = j;
  }
  return { ends, bothEnds, named, males };
}

/**
 * - "fits": no rule applies, or the title plugs in the device's own connector (or names none);
 * - "doubtful": it plugs in another connector but also offers the device's own (a listing of
 *   several cables, "Type C to Type C/USB Lightning"), or the search is for a charger or an
 *   adapter (PRODUCT_KINDS): moved after the others (lib/ranking/rank.ts);
 * - "wrong": a cable whose only plug at the device end is another connector ("USB C To Lightning
 *   Cable For iPhone 15 14 13" for an iPhone 15): not the product (lib/ranking/type-gate.ts).
 */
export type ConnectorFit = "fits" | "doubtful" | "wrong";

/**
 * Whether the title's plug fits the port of the device the search is for (searchedPort). Only for
 * a search for a cable, charger or adapter (PRODUCT_KINDS). The device's port is a fact the parse
 * cannot change: a parse that asks for a "usb-c to lightning cable" for an iPhone 15 (live run
 * 2026-09-28, where the shopper wrote "כבל USB-C לאייפון 15") gets USB-C cables, unless the
 * shopper's own Hebrew labels name the other connector (PortRule.askedFor).
 */
export function connectorFit(title: string, f: ConnectorFilters): ConnectorFit {
  const port = searchedPort(f);
  if (!port) return "fits";
  const kind = productKind(f);
  if (!kind) return "fits";
  const rule = PORT_RULES[port];
  if (rule.askedFor?.test(hebrewLabels(f))) return "fits";
  const found = titleConnectors(title);
  // An adapter's plug is only what the title calls male.
  const t =
    kind === "adapter" ? { ...found, ends: found.males, bothEnds: new Set<Connector>() } : found;
  if (!rule.wrongEnd(t)) return "fits";
  return kind === "cable" && !rule.ownEnd(t) ? "wrong" : "doubtful";
}
