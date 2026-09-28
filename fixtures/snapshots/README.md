# Product-pool snapshots

Every product AliExpress's `product.query` returned for 32 search queries, with the parse that
drove each search. Ranking, type-gate, diversity and fetch-ladder changes (docs/search-quality-plan.md,
items 2 to 6 and 12) can be replayed on these pools offline, in seconds and for free, instead of a
paid eval run. Plan item 1.

Made by `scripts/snapshot-pools.ts` on 2026-09-28, 08:49 to 08:55 UTC.

## Versions

| | At capture |
| --- | --- |
| `PARSE_VERSION` (current code) | 5 |
| `RANKING_VERSION` | 5 |
| `EXPLAIN_VERSION` | 4 (explain was never called) |
| Snapshot format (`format` in each file) | 1 |
| LLM model (live parses) | `claude-haiku-4-5-20251001` |

Each file names the prompt version of its own parse (`parse.parseVersion`): 16 eval queries use the
round-3 recording made with `PARSE_VERSION` 4, so production today (5) may parse them differently.

## Files

- `<id>.json`, one per query. Ids: the eval ids of `scripts/eval-llm.ts`; `ex-1` is the home page
  `FULL_EXAMPLE` and `ex-2` to `ex-9` its 8 `IDEAS` (`components/search-guide.tsx`, in order);
  `live-*` are the 3 queries seen on the live site.
  - `parse`: `source` (`parse_cache`: the production row for `queryKey(q)`, read with one SELECT;
    `recorded`: `fixtures/llm/eval-v3-2026-09-27-subset.json` (v5), else `eval-v3-2026-09-27.json`
    (v4); `live`: one `parseQuery` call made for the snapshot), `parseVersion`, `detail` (row key and
    time, fixture file, or model), `llmCalls` (tokens and cost of a live parse) and `parsed`.
  - `fetch`: the keyword ladder (`keywordLadder`), sort, page size, price bounds, and the steps not
    fetched with the reason.
  - `calls`: one entry per `product.query` call, in order: `step` (`primary-p1`, `primary-p2`,
    `ladder-1`), keywords, page, sort, price bounds, the params as sent (tracking id masked),
    `fetchedAt`, `httpRequests`, `requestId`, `rawCount` (items returned), `parsedCount` (items that
    passed `productSchema`), `skipped`, `totalRecords`, `hasNextPage`, `error`, and `products`: every
    normalized `AliProduct`, one per line, in AliExpress's order.
  - `baseline`: pool statistics and a replay of today's pipeline under `RANKING_VERSION` 5. Stale
    once the ranking changes: `--report` recomputes both with the current code.
- `index.json`: the run ledger (every LLM call and AliExpress request of the set, cost, one row per
  query with its statistics).

What differs from a raw `AliProduct`:

- `promotionLink` is `"<promotion_link omitted>"` when AliExpress sent a link, else `null`. Ranking
  and replay only need to know whether a link came (the pipeline drops products it cannot link),
  the links are about 1,000 characters each, and they expire.
- Every `.env.local` value is masked (`maskEnvValuesDeep`); `lib/fixtures-secrets.test.ts` passes.

## How the pools were fetched

A refresh now first makes exactly the calls the live pipeline would (`nextFetch`), then fills up to
3 calls with page 2 and the broader keyword steps (scripts/snapshot-pools.ts). The set of
2026-09-28 was captured before that, with the pipeline's own call (`queryProducts`: EN titles, ILS,
ship to IL, sort `LAST_VOLUME_DESC`, price bounds in agorot, page size 50) and keyword ladder of
that day, always up to 3 calls per query, whatever passed:

1. page 1 of `keywords_en`;
2. page 2 of `keywords_en`, skipped when `total_record_count` had nothing beyond page 1 (never
   happened);
3. the next ladder step (reduced keywords, else `category_hint`), skipped when there is none (never
   happened); a third ladder step is not fetched (16 queries have one).

All 28 distinct queries got 3 calls: 84 calls, 117 to 149 distinct products per query (3,846 summed
over the queries), 0 items rejected by `productSchema`. Four ids share a query with an eval query and hold a
copy of its snapshot (`sameQueryAs`): `ex-1` = `pair-a`, `ex-2` = `gift-cook`, `ex-4` = `car-holder`,
`ex-5` = `home-nightlight`. Three more pairs sent identical calls (`ex-3`/`home-drawer`,
`ex-6`/`ho-speaker`, `ex-9`/`ho-neck-pillow`): 8 to 63 seconds apart they returned the same ids in
the same order with the same prices and sales, except one `ladder-1` page (49 of 50 shared, 20 at
the same position).

## Per query

"Pool": distinct products in all calls. "Pass": pass every filter with `FILTERS` (90%, 100 sales:
trust, price, type gate, requirements). "Fill only": pass with `FILL_TIER` (95%, 30 sales) but not
`FILTERS`. "Ranked": `rankProducts` length (passers after near-duplicate removal). "Pipeline": a
replay of `fetchAndRank` as of 2026-09-28 over the captured calls: how many calls it makes, how many
products it checks, and how many pass (`rankWithFill`, "Y עברו" on the page).

| id | query | parse | pool | pass | fill only | ranked | pipeline calls | checked | passed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gift-cook | מתנה לאבא שאוהב לבשל עד 200 ש״ח | recorded v5 | 149 | 3 | 0 | 2 | 3 | 149 | 2 |
| kids-toy | צעצוע לילד בן 3 שמלמד צבעים | recorded v4 | 146 | 21 | 0 | 16 | 1 | 49 | 6 |
| car-holder | מחזיק טלפון לרכב עם טעינה אלחוטית | recorded v4 | 140 | 34 | 0 | 23 | 1 | 50 | 10 |
| home-drawer | מארגן מגירות למטבח | recorded v4 | 149 | 33 | 0 | 28 | 1 | 49 | 15 |
| tech-charger | מטען מהיר 65W לטלפון ולמחשב נייד | recorded v5 | 145 | 0 | 0 | 0 | 3 | 145 | 0 |
| price-watch | שעון חכם עם דופק בפחות מ־150 שקל | recorded v4 | 139 | 16 | 0 | 15 | 1 | 49 | 6 |
| typo-earbuds | אוזניות בלוטות לריצה עמידות למיים | recorded v4 | 135 | 18 | 1 | 17 | 1 | 49 | 9 |
| slang-mouse | משהו שווה לגיימינג, עכבר שקט שלא מרעיש | recorded v4 | 144 | 35 | 0 | 24 | 1 | 50 | 13 |
| kids-bottle | בקבוק מים לגן שלא נוזל | recorded v4 | 133 | 9 | 7 | 6 | 1 | 49 | 6 |
| home-nightlight | מנורת לילה לחדר ילדים עם חיישן תנועה | recorded v4 | 147 | 5 | 3 | 5 | 1 | 50 | 3 |
| price-range-bag | תיק גב לטיולים בין 80 ל־200 ש״ח עמיד למים | recorded v4 | 133 | 48 | 2 | 37 | 1 | 49 | 20 |
| cheapest-cable | הכי זול: כבל USB-C לאייפון 15 | recorded v4 | 140 | 60 | 0 | 36 | 1 | 50 | 19 |
| pair-a | אוזניות לריצה, עמידות למים, עד 100 ש״ח | parse_cache v5 | 148 | 3 | 0 | 3 | 1 | 50 | 3 |
| pair-a2 | אוזניות ריצה עמידות במים עד 100 שקל | recorded v4 | 126 | 8 | 0 | 7 | incomplete | 76 | 2 |
| pair-b2 | מעמד לפלאפון לאוטו עם טעינה אלחוטית | recorded v4 | 147 | 32 | 0 | 22 | 1 | 50 | 10 |
| ho-neck-pillow | כרית לצוואר לטיסות ארוכות | recorded v5 | 148 | 69 | 0 | 55 | 1 | 50 | 26 |
| ho-gift-garden | מתנה לסבתא שאוהבת לגנן עד 120 ש״ח | recorded v4 | 120 | 14 | 0 | 13 | 1 | 50 | 7 |
| ho-powerbank | סוללת גיבוי קטנה לטלפון 10000 מיליאמפר | recorded v4 | 120 | 67 | 0 | 57 | 1 | 48 | 32 |
| ho-slippers | נעלי בית חמות לחורף | recorded v4 | 120 | 31 | 3 | 24 | 1 | 50 | 11 |
| ho-speaker | רמקול בלוטוס עמיד למים לים בין 50 ל־150 שקל | recorded v4 | 117 | 48 | 0 | 27 | 1 | 49 | 13 |
| ex-1 | אוזניות לריצה, עמידות למים, עד 100 ש״ח | = pair-a | 148 | 3 | 0 | 3 | 1 | 50 | 3 |
| ex-2 | מתנה לאבא שאוהב לבשל עד 200 ש״ח | = gift-cook | 149 | 3 | 0 | 2 | 3 | 149 | 2 |
| ex-3 | מארגנים למגירות במטבח | live v5 | 148 | 33 | 0 | 28 | 1 | 49 | 15 |
| ex-4 | מחזיק טלפון לרכב עם טעינה אלחוטית | = car-holder | 140 | 34 | 0 | 23 | 1 | 50 | 10 |
| ex-5 | מנורת לילה לחדר ילדים עם חיישן תנועה | = home-nightlight | 147 | 5 | 3 | 5 | 1 | 50 | 3 |
| ex-6 | רמקול בלוטות׳ עמיד למים בין 50 ל־150 ש״ח | live v5 | 117 | 48 | 0 | 27 | 1 | 49 | 13 |
| ex-7 | שעון חכם עם מד דופק עד 150 ש״ח | live v5 | 135 | 16 | 0 | 14 | 1 | 49 | 6 |
| ex-8 | תיק גב עמיד למים לטיולים | live v5 | 126 | 38 | 0 | 28 | 1 | 50 | 9 |
| ex-9 | כרית צוואר לטיסות ארוכות | live v5 | 148 | 69 | 0 | 55 | 1 | 50 | 26 |
| live-soundbar | סאונד בר | parse_cache v5 | 148 | 10 | 0 | 9 | 2 | 100 | 9 |
| live-drawer-organizer | מארגן למגירות, עד 100 ש״ח | parse_cache v5 | 147 | 25 | 0 | 24 | 1 | 49 | 14 |
| live-sonic-doll | בובת סוניק לילד | parse_cache v5 | 131 | 0 | 4 | 0 | 2 | 87 | 3 (all fill) |

The "pipeline" columns above are from the capture day (fetch rule and ranking of `RANKING_VERSION`
5). `--report` and `npm run eval:offline` recompute them with the current code.

Known gaps (2026-09-28, after plan item 5 changed the fetch rule):

- The live fetch policy (`nextFetch`, lib/search/fetch-policy.ts) asks 4 queries for calls these
  snapshots do not hold, so their offline replay is "incomplete": `home-nightlight` and `ex-5`
  ("motion sensor night light" p1), `live-sonic-doll` ("sonic plush" p1) and `tech-charger`
  ("65w charger" p1). The next refresh captures them (3 calls, $0; follow-up steps may add 1 or 2).
- The home page examples changed after the capture: `ex-1` still holds the earbuds example (it is
  `pair-a`'s query) while `FULL_EXAMPLE` is now the smartwatch query (`ex-7`), and the ideas at
  `ex-7` and `ex-8` are now the power bank (`ho-powerbank`'s query) and the house slippers
  (`ho-slippers`'s). The script maps examples by position, and it reuses a saved parse only when the
  saved query text is the same, so the next refresh parses the new texts (up to 3 LLM calls) or
  copies the matching eval snapshot.
- A snapshot is one moment: prices, sales and even the set of products move. Compare rankings within
  one snapshot set, not across refreshes.

## Offline eval and labels

`npm run eval:offline` replays every snapshot through a fetch policy and the current ranking code
(scripts/eval-offline.ts; `--compare`, `--against`, `--renormalize`, `--detail`). Reports are saved
here as `report-<name>.json`; `report-baseline-r5.json` is the pipeline before wave A.

`labels/<id>.json` holds 3,419 judgments (exact, reasonable, weak, wrong) of every product that
passes the trust thresholds and the price bounds, the type gate ignored. They were written by
agents judging as buyers from each title, category and price (2026-09-28), not by a person, and
they wait for the owner's review; docs/search-quality-wave-a.md lists the pairs of queries whose
labels disagree. Rules the labellers applied the same way everywhere: a product of the right type
that lacks a stated requirement is "weak"; parts and accessories are "wrong"; twin snapshots
(`sameQueryAs`, and `ex-9` / `ho-neck-pillow`, `ex-4` / `car-holder`) carry identical labels.

## Refresh (monthly)

```
# Which parse each query uses and the most calls a run can make (reads only):
NODE_OPTIONS=--experimental-websocket npx tsx --env-file=.env.local scripts/snapshot-pools.ts --plan
# One query first, then the rest (the second run resumes and skips it):
NODE_OPTIONS=--experimental-websocket npx tsx --env-file=.env.local scripts/snapshot-pools.ts --only ex-3
NODE_OPTIONS=--experimental-websocket npx tsx --env-file=.env.local scripts/snapshot-pools.ts
# Statistics of the saved snapshots under the current ranking code (no API calls, no env):
npx tsx scripts/snapshot-pools.ts --report
```

- A refresh keeps each query's saved parse when the saved query text is the same, so it makes no
  LLM call ($0) and the new pools stay comparable with the old ones. It costs up to 84 AliExpress calls, which are free but share the app
  key's rate limit with the live site: run at a quiet hour. `--reparse` goes back to parse_cache,
  then the recordings, then live parses (after a `PARSE_VERSION` bump; up to 8 LLM calls, about
  $0.002 each).
- Hard caps per UTC day, whatever the flags: 8 LLM calls (retries included) and 100 AliExpress HTTP
  requests (one retry after an ApiCallLimit ban, counted). Requests are at least 1.6 s apart. A run
  on the same day resumes: saved ids are skipped (`--force` redoes them) and earlier calls count
  against the caps.
- New or renamed home page examples are read from `components/search-guide.tsx` at run time, and the
  eval queries from `scripts/eval-llm.ts` (read as text: importing that script starts a paid run).
  The 3 live queries are listed in the script.

## Cost of this set

| | Calls | Cost |
| --- | --- | --- |
| LLM (live parses of `ex-3`, `ex-6` to `ex-9`; no retries) | 5 | $0.01006 (1,515 to 1,535 input and 80 to 114 output tokens each) |
| AliExpress `product.query` | 86 HTTP requests: the 84 calls in the files, plus 2 from a first `ex-3` run that was redone to add page 2. No ApiCallLimit, no errors | $0 |

No database writes: one SELECT on `parse_cache` per run (service role).
