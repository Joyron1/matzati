// The bot: one incoming message in, a short conversation out. It holds no search logic of its own:
// it calls the site's own search, "more" and hot/coupons/sales readers (injected as `deps`, wired
// in app/api/whatsapp/webhook/route.ts), so answers, filters, ranking, caches, budgets and the
// honesty rules are exactly the website's. The LLM never writes anything the site does not.
import { sharedNumbersNote } from "@/components/trust-metrics";
import type { Coupon } from "@/lib/coupons/types";
import type { HotProduct } from "@/lib/hot/select";
import type { MoreResult, SearchPageResult } from "@/lib/search/server";
import type { Deal, FilterChip, SortPreference } from "@/lib/types";
import type { WhatsAppSender } from "./client";
import type { Inbound } from "./inbound";
import { parseActionId, parseText, type Action, type Intent } from "./intent";
import {
  EXPIRED_TEXT,
  HELP_TEXT,
  NO_RESULTS_TEXT,
  SLOW_TEXT,
  STOP_TEXT,
  TOO_LONG_TEXT,
  UNSUPPORTED_TEXT,
  afterResults,
  couponsText,
  failureText,
  hotCard,
  hotIntro,
  menuList,
  optionsList,
  resultCard,
  saleText,
  searchSummary,
  text,
} from "./messages";
import { rateLimitHeaders, userHashOf, type Session, type SessionStore } from "./session";

export interface BotDeps {
  sender: WhatsAppSender;
  sessions: SessionStore;
  /** IP_HASH_SALT: the salt of the user hash. */
  salt: string;
  search(
    input: { q: string; without: string[]; sort?: SortPreference; typed: false },
    headers: Headers,
  ): Promise<SearchPageResult>;
  more(filtersKey: string, page: number, headers: Headers): Promise<MoreResult>;
  hot(): Promise<HotProduct[]>;
  /** Owner coupons valid now. */
  coupons(now: Date): Promise<Coupon[]>;
  nextSale(now: Date): Promise<Deal | null>;
  now(): Date;
  /** After this long without an answer the user gets a "one moment" note (once). */
  slowAfterMs?: number;
  log?(where: string, err: unknown): void;
}

const RESULTS_PER_PAGE = 5;

/** Handles one user message. Never throws: a failure is logged and the user told to retry. */
export async function handleIncoming(msg: Inbound, deps: BotDeps): Promise<void> {
  // A redelivered POST (Meta retries when it does not get a fast 200) must not answer twice.
  if (!(await deps.sessions.claim(msg.id))) return;
  const { sender } = deps;
  const say = (m: Parameters<WhatsAppSender["send"]>[1], quote = false) =>
    sender.send(msg.from, m, quote ? msg.id : undefined);
  try {
    // Read receipt and "typing…", fire and forget: it is a nicety, never a reason to fail.
    void sender.markReadTyping(msg.id).catch(() => undefined);
    const userHash = userHashOf(msg.from, deps.salt);
    const intent = intentOf(msg);
    if (intent.kind === "too_long") return await say(text(TOO_LONG_TEXT), true);
    if (intent.kind === "search") {
      return await runSearch({ q: intent.q, without: [] }, userHash, msg, deps);
    }
    await runAction(intent.action, userHash, msg, deps);
  } catch (err) {
    deps.log?.("whatsapp", err);
    await say(text(failureText("unavailable"))).catch(() => undefined);
  }
}

function intentOf(msg: Inbound): Intent {
  if (msg.kind === "text") return parseText(msg.text);
  if (msg.kind === "action") {
    const action = parseActionId(msg.actionId);
    return action ? { kind: "action", action } : { kind: "action", action: { type: "menu" } };
  }
  return { kind: "action", action: { type: "menu" } };
}

async function runAction(
  action: Action,
  userHash: string,
  msg: Inbound,
  deps: BotDeps,
): Promise<void> {
  const say = (m: Parameters<WhatsAppSender["send"]>[1]) => deps.sender.send(msg.from, m);
  if (msg.kind === "unsupported") return say(text(UNSUPPORTED_TEXT));
  switch (action.type) {
    case "menu":
      return say(menuList());
    case "help":
      return say(text(HELP_TEXT));
    case "stop":
      await deps.sessions.clear(userHash);
      return say(text(STOP_TEXT));
    case "hot": {
      const products = (await deps.hot()).slice(0, RESULTS_PER_PAGE);
      if (!products.length) {
        return say(text("רשימת המוצרים החמים לא זמינה כרגע. נסו שוב בעוד כמה דקות."));
      }
      await say(hotIntro());
      for (const [i, p] of products.entries()) await say(hotCard(p, i + 1));
      return;
    }
    case "coupons":
      return say(text(couponsText(await deps.coupons(deps.now()), deps.now())));
    case "sales":
      return say(text(saleText(await deps.nextSale(deps.now()), deps.now())));
    case "more":
      return runMore(userHash, msg, deps);
    case "sort":
    case "drop": {
      const session = await deps.sessions.get(userHash);
      if (!session) return say(text(EXPIRED_TEXT));
      const without =
        action.type === "drop"
          ? [...new Set([...session.without, action.chipId])]
          : session.without;
      const sort = action.type === "sort" ? action.sort : session.sort;
      return runSearch({ q: session.q, without, ...(sort ? { sort } : {}) }, userHash, msg, deps);
    }
  }
}

async function runSearch(
  input: { q: string; without: string[]; sort?: SortPreference },
  userHash: string,
  msg: Inbound,
  deps: BotDeps,
): Promise<void> {
  const say = (m: Parameters<WhatsAppSender["send"]>[1], quote = false) =>
    deps.sender.send(msg.from, m, quote ? msg.id : undefined);
  // A slow search (a fresh AliExpress fetch takes 10-25 s) gets one "one moment" note.
  let notified: Promise<void> | null = null;
  const timer = setTimeout(() => {
    notified = say(text(SLOW_TEXT)).catch(() => undefined);
  }, deps.slowAfterMs ?? 7_000);
  let result: SearchPageResult;
  try {
    result = await deps.search({ ...input, typed: false }, rateLimitHeaders(userHash));
  } finally {
    clearTimeout(timer);
  }
  if (notified) await notified;
  if (!result.ok) return say(text(failureText(result.error, result.retryAfterSec)));

  const r = result.response;
  const session: Session = {
    q: input.q,
    without: input.without,
    ...(input.sort ? { sort: input.sort } : {}),
    filtersKey: r.filters_key ?? null,
    page: 0,
    moreAvailable: r.more_available,
    shownSort: r.sort,
  };
  // Remembering is a nicety ("עוד", sorts): if the store is down the user still gets the results.
  await remember(userHash, session, deps);

  const chips: readonly FilterChip[] = r.chips;
  if (r.results.length === 0) {
    await say(
      text(
        `${NO_RESULTS_TEXT}\n\n${searchSummary({ checked: r.checked_count, passed: r.passed_count, chips, page: 0 })}`,
      ),
      true,
    );
    if (chips.some((c) => c.removable)) {
      await say(optionsList({ chips, sort: r.sort, moreAvailable: false }));
    }
    return;
  }
  await say(
    text(searchSummary({ checked: r.checked_count, passed: r.passed_count, chips, page: 0 })),
    true,
  );
  for (const [i, p] of r.results.entries()) {
    await say(resultCard(p, i + 1, sharedNumbersNote(p.shared_numbers)));
  }
  await say(
    afterResults({
      moreAvailable: r.more_available,
      sort: r.sort,
      summary: "רוצים עוד אפשרויות או סדר אחר?",
    }),
  );
  if (chips.some((c) => c.removable)) {
    await say(optionsList({ chips, sort: r.sort, moreAvailable: r.more_available }));
  }
}

async function remember(userHash: string, session: Session, deps: BotDeps): Promise<void> {
  try {
    await deps.sessions.set(userHash, session);
  } catch (err) {
    deps.log?.("whatsapp_session", err);
  }
}

async function runMore(userHash: string, msg: Inbound, deps: BotDeps): Promise<void> {
  const say = (m: Parameters<WhatsAppSender["send"]>[1]) => deps.sender.send(msg.from, m);
  const session = await deps.sessions.get(userHash);
  if (!session || !session.filtersKey) return say(text(EXPIRED_TEXT));
  if (!session.moreAvailable) {
    return say(
      text("זה כל מה שעבר את הסינון שלנו לחיפוש הזה. אפשר להסיר סינון או לנסח חיפוש חדש."),
    );
  }
  const page = session.page + 1;
  const out = await deps.more(session.filtersKey, page, rateLimitHeaders(userHash));
  if (!out.ok) {
    return say(
      text(
        out.error === "not_found"
          ? EXPIRED_TEXT
          : failureText(out.error, "retryAfterSec" in out ? out.retryAfterSec : undefined),
      ),
    );
  }
  await remember(userHash, { ...session, page, moreAvailable: out.more_available }, deps);
  await say(
    text(
      `מקומות ${page * RESULTS_PER_PAGE + 1}–${page * RESULTS_PER_PAGE + out.results.length}. ההשוואות בכל חמישייה הן בתוך החמישייה.`,
    ),
  );
  for (const [i, p] of out.results.entries()) {
    await say(resultCard(p, page * RESULTS_PER_PAGE + i + 1, sharedNumbersNote(p.shared_numbers)));
  }
  await say(
    afterResults({
      moreAvailable: out.more_available,
      sort: session.shownSort ?? "best_value",
      summary: "רוצים עוד אפשרויות או סדר אחר?",
    }),
  );
}
