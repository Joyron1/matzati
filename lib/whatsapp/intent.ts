// What a user's message asks for. A message is a command only when the WHOLE text is one, so
// "קופון לאייפון" is still a search. Everything else is a search, exactly like the site's box.
import { MAX_QUERY_LENGTH } from "@/lib/search/pipeline";
import type { SortPreference } from "@/lib/types";

export type Action =
  | { type: "menu" }
  | { type: "help" }
  | { type: "hot" }
  | { type: "coupons" }
  | { type: "sales" }
  | { type: "stop" }
  | { type: "more" }
  | { type: "sort"; sort: SortPreference }
  /** Remove one filter chip of the last search (the chip's own id). */
  | { type: "drop"; chipId: string };

export type Intent =
  { kind: "action"; action: Action } | { kind: "search"; q: string } | { kind: "too_long" };

const SORTS: readonly SortPreference[] = ["best_value", "cheapest", "most_popular"];
// Hebrew points and cantillation marks (U+0591 to U+05C7).
const NIQQUD = new RegExp("[\u0591-\u05C7]", "g");
const CHIP_ID = /^[a-z0-9_:.-]{1,100}$/i;

/** The id a button or list row carries back to us (Meta allows 200-256 characters). */
export function actionId(action: Action): string {
  switch (action.type) {
    case "sort":
      return `sort:${action.sort}`;
    case "drop":
      return `drop:${action.chipId}`;
    default:
      return action.type;
  }
}

/** The action an id stands for; null for an id we never sent (a stale or forged reply). */
export function parseActionId(id: string): Action | null {
  if (id.startsWith("sort:")) {
    const sort = SORTS.find((s) => s === id.slice(5));
    return sort ? { type: "sort", sort } : null;
  }
  if (id.startsWith("drop:")) {
    const chipId = id.slice(5);
    return CHIP_ID.test(chipId) ? { type: "drop", chipId } : null;
  }
  switch (id) {
    case "menu":
    case "help":
    case "hot":
    case "coupons":
    case "sales":
    case "stop":
    case "more":
      return { type: id };
    default:
      return null;
  }
}

/** Lowercase, no niqqud, punctuation and repeated spaces folded: the form phrases are matched in. */
function normalize(text: string): string {
  return text
    .normalize("NFKC")
    .replace(NIQQUD, "")
    .toLowerCase()
    .replace(/[!?.,:;"'׳״()\[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const PHRASES: ReadonlyArray<[Action["type"], readonly string[]]> = [
  [
    "menu",
    [
      "תפריט",
      "התחלה",
      "שלום",
      "היי",
      "הי",
      "אהלן",
      "בוקר טוב",
      "ערב טוב",
      "menu",
      "start",
      "hi",
      "hello",
    ],
  ],
  ["help", ["עזרה", "עזור", "איך זה עובד", "מה אתם עושים", "מה אפשר", "help"]],
  ["hot", ["מוצרים חמים", "חמים", "מה חם", "hot"]],
  ["coupons", ["קופונים", "קופון", "קודים", "קודי הנחה", "קוד הנחה", "coupons"]],
  ["sales", ["מבצעים", "מבצע", "סייל", "סיילים", "לוח מבצעים", "sales"]],
  ["stop", ["עצור", "הפסק", "הפסקה", "stop", "unsubscribe", "ביטול", "הסר"]],
  ["more", ["עוד", "עוד תוצאות", "עוד אפשרויות", "עוד 5", "המשך", "הבא", "more"]],
];

/** Reads one text message. */
export function parseText(text: string): Intent {
  const norm = normalize(text);
  if (!norm) return { kind: "action", action: { type: "menu" } };
  for (const [type, phrases] of PHRASES) {
    if (phrases.includes(norm)) return { kind: "action", action: { type } as Action };
  }
  const q = text.trim().replace(/\s+/g, " ");
  return q.length > MAX_QUERY_LENGTH ? { kind: "too_long" } : { kind: "search", q };
}
