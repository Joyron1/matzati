// Which messages in the search group are product searches (owner request 2026-10-25: anything
// else is deleted). Two steps: these free rules first, then (for what they let through) one short
// yes/no call to the cheap model (classify.ts). Pure, tested.

/** The longest message taken as a search (the site takes 200; a search is a line, not a story). */
export const MAX_SEARCH_CHARS = 150;

export type RuleVerdict =
  { kind: "check"; query: string } | { kind: "reject"; reason: RejectReason };

export type RejectReason =
  | "empty"
  | "too_short"
  | "too_long"
  | "link"
  | "mention"
  | "phone"
  | "no_letters"
  | "command"
  | "chat";

/** Greetings, thanks and chat that are never a product (whole message, punctuation aside). */
const CHAT = new Set([
  "שלום",
  "היי",
  "הי",
  "הלו",
  "אהלן",
  "תודה",
  "תודה רבה",
  "תודה!",
  "מה נשמע",
  "מה קורה",
  "מה המצב",
  "בוקר טוב",
  "ערב טוב",
  "לילה טוב",
  "שבוע טוב",
  "שבת שלום",
  "סבבה",
  "אחלה",
  "מעולה",
  "יפה",
  "וואו",
  "אמן",
  "כן",
  "לא",
  "אוקיי",
  "אוקי",
  "בסדר",
  "חחח",
  "חחחח",
  "lol",
  "ok",
  "hi",
  "hello",
  "thanks",
]);

const URL_RE = /(https?:\/\/|www\.|t\.me\/|\b[a-z0-9-]+\.(com|co\.il|net|org|io|ly|me)\b)/i;
const MENTION_RE = /(^|\s)@\w{3,}/;
// 7+ digits in a row (spaces or dashes allowed): a phone or an id, never a product.
const PHONE_RE = /(\d[\s-]?){7,}/;
const LETTER_RE = /[\p{L}]/u;

export function ruleVerdict(raw: string | undefined | null): RuleVerdict {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return { kind: "reject", reason: "empty" };
  if (text.startsWith("/")) return { kind: "reject", reason: "command" };
  if (URL_RE.test(text)) return { kind: "reject", reason: "link" };
  if (MENTION_RE.test(text)) return { kind: "reject", reason: "mention" };
  if (PHONE_RE.test(text)) return { kind: "reject", reason: "phone" };
  if (!LETTER_RE.test(text)) return { kind: "reject", reason: "no_letters" };
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (letters < 2) return { kind: "reject", reason: "too_short" };
  if (text.length > MAX_SEARCH_CHARS) return { kind: "reject", reason: "too_long" };
  const bare = text
    .replace(/[\p{P}\p{S}\p{Extended_Pictographic}]/gu, "")
    .trim()
    .toLowerCase();
  if (CHAT.has(bare) || /^ח{3,}$/.test(bare)) return { kind: "reject", reason: "chat" };
  return { kind: "check", query: text };
}

/** The short note the bot replies with before deleting a message that is not a search. */
export function rejectNote(reason: RejectReason | "not_product"): string {
  if (reason === "too_long") {
    return `🔎 כאן כותבים רק מה מחפשים, בשורה אחת (עד ${MAX_SEARCH_CHARS} תווים). למשל: ״אוזניות לריצה עד 100 ש״ח״`;
  }
  if (reason === "link" || reason === "mention" || reason === "phone") {
    return "🔎 בקבוצה הזו אין קישורים, תיוגים או מספרים. כתבו רק מה אתם מחפשים, למשל: ״מטען מהיר לאייפון״";
  }
  return "🔎 הקבוצה הזו רק לחיפוש מוצרים: כתבו מה אתם מחפשים, למשל ״תיק גב לטיולים עמיד למים״";
}
